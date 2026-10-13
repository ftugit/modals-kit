// Модульные тесты серверного приёма (lib/form/server.ts): без сети, на Request/FormData.
import { describe as suite, expect, test, vi } from 'vitest'
import { buildEnvelope, createAppSource, defineForm, makeFieldSugar } from './index'
import { v } from './validators'
import { createFormHandler, MemoryIdempotencyStore, storeIdempotency, windowThrottle, type IdempotencyStore } from './server'
import { memoryStore } from '../cache/index'
import { check, CheckRegistry } from './async'
import { evaluate } from './submit'
import { formRenderer } from './messages-order'

const field = makeFieldSugar()
const base = defineForm({ id: 'probe', fields: { name: field.text({}) } })

const envelopeOf = (extra: Record<string, unknown> = {}, d = base) =>
  buildEnvelope({
    formId: d.id, revision: d.revision, instance: `${d.id}:new`,
    submissionId: crypto.randomUUID(), ...extra,
  }, d.policy)

const post = (entries: Record<string, string>, headers: Record<string, string> = {}) =>
  new Request('http://x/form', {
    method: 'POST', body: new URLSearchParams(entries),
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
  })

suite('переход после успеха (F17)', () => {
  const redirectOf = async (target: string) => {
    const h = createFormHandler({ description: base, execute: (c) => { c.commit(); return { redirect: target } } })
    return (await h(post({ ...envelopeOf(), name: 'a' }))).result.redirect
  }

  test('чужой хост не проходит ни в каком написании', async () => {
    for (const evil of ['//evil.com', '/\\evil.com', '/\t/evil.com', '/\n/evil.com', '\\/evil.com',
                        'https://evil.com', 'evil.com', '/\\/evil.com'])
      expect(await redirectOf(evil), JSON.stringify(evil)).toBeUndefined()
  })

  test('свой путь отдаётся нормализованным', async () => {
    expect(await redirectOf('/ok')).toBe('/ok')
    expect(await redirectOf('/a/b?x=1#h')).toBe('/a/b?x=1#h')
    expect(await redirectOf('/%2F%2Fevil.com')).toBe('/%2F%2Fevil.com')
  })
})

suite('сбой вне execute', () => {
  test('текст исключения не уходит клиенту, но доступен телеметрии', async () => {
    const seen: Record<string, unknown>[] = []
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    const h = createFormHandler({
      description: base,
      source: { resolve: async () => { throw new Error('ECONNREFUSED 10.0.0.5:5432 user=app') }, revision: async () => 1 },
      observe: (e) => { seen.push(e) },
      execute: (c) => { c.commit(); return {} },
    })
    const r = await h(post({ ...envelopeOf(), name: 'a' }))
    quiet.mockRestore()
    expect(r.status).toBe(500)
    expect(r.result.errors.map((e) => e.code)).toEqual(['handler.failed'])
    expect(JSON.stringify(r.result)).not.toContain('ECONNREFUSED')
    expect(String(seen[0]?.['failure'])).toContain('ECONNREFUSED')
  })
})

suite('частота (F18)', () => {
  const req = (ip = '1.1.1.1') => ({ request: new Request('http://x/', { headers: { 'x-real-ip': ip } }) })

  test('без ключа ограничитель не создаётся: подделываемого умолчания нет', () => {
    expect(() => windowThrottle({ limit: 1, windowMs: 1000 } as never)).toThrow(/key обязателен/)
  })

  test('лимит считается по заданному ключу', async () => {
    const t = windowThrottle({ limit: 2, windowMs: 1000, key: (r) => r.headers.get('x-real-ip')! }, () => 0)
    // Контракт Throttle.check — значение ИЛИ промис: await покрывает оба.
    expect((await t.check(req())).allowed).toBe(true)
    expect((await t.check(req())).allowed).toBe(true)
    expect(await t.check(req())).toEqual({ allowed: false, retryAfterMs: 1000 })
    expect((await t.check(req('2.2.2.2'))).allowed).toBe(true)
  })

  test('окна без попаданий удаляются: память не растёт с числом разовых ключей', () => {
    let now = 0
    const t = windowThrottle({ limit: 5, windowMs: 1000, key: (r) => r.headers.get('x-real-ip')! }, () => now)
    for (let i = 0; i < 500; i++) t.check(req(`10.0.${i >> 8}.${i & 255}`))
    expect(t.size).toBe(500)
    now = 1500
    t.check(req('9.9.9.9'))
    expect(t.size).toBe(1)
  })
  test('контекст запроса из handle доходит до ключа: окно на адрес клиента', async () => {
    type Ev = { getClientAddress(): string }
    const seen: (Ev | undefined)[] = []
    const throttle = windowThrottle<Ev>({
      limit: 1, windowMs: 60_000,
      key: (_r, event) => { seen.push(event); return event!.getClientAddress() },
    })
    const h = createFormHandler<unknown, Ev>({
      description: base, throttle, execute: (c) => { c.commit(); return {} },
    })
    const ev = (ip: string): Ev => ({ getClientAddress: () => ip })
    const a = ev('1.1.1.1')
    expect((await h(post({ ...envelopeOf(), name: 'a' }), 'fetch', a)).status).toBe(200)
    expect((await h(post({ ...envelopeOf(), name: 'a' }), 'fetch', a)).status).toBe(429)
    expect((await h(post({ ...envelopeOf(), name: 'a' }), 'fetch', ev('2.2.2.2'))).status).toBe(200)
    expect(seen[0]).toBe(a)
  })

  test('без event ключ получает undefined — бросающий ключ даёт отказ, а не общее окно', async () => {
    const throttle = windowThrottle<{ getClientAddress(): string }>({
      limit: 100, windowMs: 60_000, key: (_r, event) => event!.getClientAddress(),
    })
    const h = createFormHandler({ description: base, throttle, execute: (c) => { c.commit(); return {} } })
    const r = await h(post({ ...envelopeOf(), name: 'a' }))
    expect(r.result.ok).toBe(false)
    expect(throttle.size).toBe(0)
  })
})

suite('идемпотентность: параллельный повтор (F19)', () => {
  const gate = () => { let open!: () => void; const p = new Promise<void>((r) => { open = r }); return { p, open } }

  test('параллельный дубль не выполняется второй раз; поздний повтор получает первый результат', async () => {
    let runs = 0
    const g = gate()
    const h = createFormHandler({
      description: base, idempotency: new MemoryIdempotencyStore(),
      execute: async (c) => { runs++; await g.p; c.commit(); return { data: runs } },
    })
    const env = envelopeOf()
    const first = h(post({ ...env, name: 'a' }))
    const second = await h(post({ ...env, name: 'a' }))
    expect(second.status).toBe(409)
    expect(second.result.errors.map((e) => e.code)).toEqual(['submission.in-flight'])
    expect(second.result.outcome).toBe('not-applied')
    g.open()
    const done = await first
    expect(done.status).toBe(200)
    expect(second.result.submissionId).toBe(done.result.submissionId)
    const late = await h(post({ ...env, name: 'a' }))
    expect(late.result.data).toBe(1)
    expect(runs).toBe(1)
  })

  test('«не применено» снимает бронь: исправленная отправка с тем же id выполняется', async () => {
    const store = new MemoryIdempotencyStore()
    let attempt = 0
    const h = createFormHandler({
      description: base, idempotency: store,
      execute: (c) => {
        if (++attempt === 1) c.fail([{ id: 'x', code: 'name.taken', message: 'занято', origin: 'server' } as never])
        c.commit(); return {}
      },
    })
    const env = envelopeOf()
    expect((await h(post({ ...env, name: 'a' }))).result.outcome).toBe('not-applied')
    expect((await h(post({ ...env, name: 'b' }))).result.outcome).toBe('committed')
  })

  test('память: просроченные записи вычищаются', () => {
    let now = 0
    const store = new MemoryIdempotencyStore(() => now)
    for (let i = 0; i < 100; i++) store.reserve(`id-${i}` as never, 1000)
    expect(store.size).toBe(100)
    now = 61_000
    expect(store.reserve('fresh' as never, 1000)).toEqual({ status: 'reserved' })
    expect(store.size).toBe(1)
  })

  test('storeIdempotency поверх memoryStore: параллельный дубль — 409, поздний повтор — прежний результат', async () => {
    let runs = 0
    const g = gate()
    const h = createFormHandler({
      description: base, idempotency: storeIdempotency(memoryStore().scope('form')),
      execute: async (c) => { runs++; await g.p; c.commit(); return { data: runs } },
    })
    const env = envelopeOf()
    const first = h(post({ ...env, name: 'a' }))
    const second = await h(post({ ...env, name: 'a' }))
    expect(second.status).toBe(409)
    g.open()
    expect((await first).status).toBe(200)
    expect((await h(post({ ...env, name: 'a' }))).result.data).toBe(1)
    expect(runs).toBe(1)
  })

  test('storeIdempotency: «не применено» снимает бронь, результат — нет', async () => {
    const kv = memoryStore()
    const store = storeIdempotency(kv)
    expect(await store.reserve!('k1' as never, 1000)).toEqual({ status: 'reserved' })
    await store.release!('k1' as never)
    expect(kv.get('k1')).toBeUndefined()
    await store.reserve!('k2' as never, 1000)
    await store.put('k2' as never, { ok: true, status: 200, outcome: 'committed', errors: [] } as never, 1000)
    await store.release!('k2' as never)
    expect(await store.get('k2' as never)).toMatchObject({ outcome: 'committed' })
  })

  test('storeIdempotency без атомарного add — ошибка при подключении', () => {
    const plain = { get: () => undefined, set: () => {}, delete: () => {} }
    expect(() => storeIdempotency(plain as never)).toThrow(/атомарным add/)
  })

  test('reserve без release — ошибка конфигурации', () => {
    const bad: IdempotencyStore = { get: () => undefined, put: () => {}, reserve: () => ({ status: 'reserved' }) }
    expect(() => createFormHandler({ description: base, idempotency: bad, execute: () => ({}) })).toThrow(/вместе/)
  })
})

suite('поля из источника (F16)', () => {
  const make = () => {
    let loads = 0
    const store = {
      load: async () => { loads++; return [{ name: 'color', input: 'text' as const, label: 'Цвет', rules: [{ rule: 'pattern', arg: 'e164' }] }] },
      currentVersion: async () => 1,
    }
    const h = createFormHandler({
      description: base, source: createAppSource({ probe: base }, store),
      execute: (c) => { c.commit(); return { data: c.values } },
    })
    return { h, loads: () => loads }
  }
  const sent = (extra: Record<string, string>) => post({ ...envelopeOf({ specVersion: 1 }), name: 'a', ...extra })

  test('поле из рантайма принимается, источник поднимается один раз', async () => {
    const { h, loads } = make()
    const r = await h(sent({ u_color: '+79991234567' }))
    expect(r.status).toBe(200)
    expect((r.result.data as Record<string, unknown>)['u_color']).toBe('+79991234567')
    expect(loads()).toBe(1)
  })

  test('правила поля из источника действуют на сервере', async () => {
    const { h } = make()
    // required у «свежего» поля в первом круге не навязывается (source.ts) — проверяем шаблон
    expect((await h(sent({ u_color: '+79991234567' }))).result.ok).toBe(true)
    const r = await h(sent({ u_color: 'red' }))
    expect(r.result.ok).toBe(false)
    expect(r.result.errors.map((e) => e.path)).toContain('u_color')
  })

  test('поле, которого нет ни в базе, ни в источнике, по-прежнему отказ', async () => {
    const { h } = make()
    const r = await h(sent({ u_color: '+79991234567', u_other: 'x' }))
    expect(r.status).toBe(400)
    expect(r.result.errors[0]).toMatchObject({ code: 'request.unexpected-field', params: { name: 'u_other' } })
  })
})

suite('порядок словарей (F55): форма → приложение → пакет', () => {
  const required = defineForm({
    id: 'probe-texts',
    fields: { name: field.text({ validate: [v.required()] }) },
    messages: { required: 'текст формы' },
  })
  const textOf = async (app: Record<string, string>, d = required) => {
    const h = createFormHandler({ description: d, messages: app, execute: (c) => { c.commit(); return {} } })
    const r = await h(post({ ...envelopeOf({}, d), name: '' }))
    return r.result.errors.find((e) => e.path === 'name')?.message
  }

  test('словарь формы сильнее словаря приложения', async () => {
    expect(await textOf({ required: 'текст приложения' })).toBe('текст формы')
  })

  test('приложение — для кодов, которых нет в словаре формы', async () => {
    const bare = defineForm({ id: 'probe-texts-2', fields: { name: field.text({ validate: [v.required()] }) } })
    expect(await textOf({ required: 'текст приложения' }, bare)).toBe('текст приложения')
  })
})

suite('свой текст ошибки (F56): валидатор → поле → форма «поле:код» → форма → приложение', () => {
  // Сервер и браузер считают текст одним путём: сверяем обе стороны на каждом случае.
  const textsOf = async (d: ReturnType<typeof defineForm>, app: Record<string, string> = {}) => {
    const values = { age: '15', kids: '-1' }
    const h = createFormHandler({ description: d, messages: app, execute: (c) => { c.commit(); return {} } })
    const server = (await h(post({ ...envelopeOf({}, d), ...values }))).result.errors
    const client = evaluate(new URLSearchParams(values), d, {
      render: formRenderer(d.messages, app, d.policy.interpolate), instance: `${d.id}:new`, requireEnvelope: false,
    }).errors
    const pick = (list: readonly { path?: string; message?: string }[]) =>
      Object.fromEntries(list.filter((e) => e.path).map((e) => [e.path, e.message]))
    expect(pick(client)).toEqual(pick(server))
    return pick(server)
  }
  let n = 0
  const form = (fields: Record<string, ReturnType<typeof field.number>>, messages?: Record<string, string>) =>
    defineForm({ id: `f56-${++n}`, fields, messages })

  test('словарь формы по коду — на все поля сразу (как было)', async () => {
    const d = form({ age: field.number({ validate: [v.minValue(18)] }), kids: field.number({ validate: [v.minValue(0)] }) },
      { minValue: 'форма {min}' })
    expect(await textsOf(d)).toEqual({ age: 'форма 18', kids: 'форма 0' })
  })

  test('1) текст в поле: только это поле, соседи — по словарю', async () => {
    const d = form({
      age: field.number({ validate: [v.minValue(18)], messages: { minValue: 'Вам должно быть {min}' } }),
      kids: field.number({ validate: [v.minValue(0)] }),
    }, { minValue: 'форма {min}' })
    expect(await textsOf(d)).toEqual({ age: 'Вам должно быть 18', kids: 'форма 0' })
  })

  test('2) ключ «поле:код» в словаре формы', async () => {
    const d = form({ age: field.number({ validate: [v.minValue(18)] }), kids: field.number({ validate: [v.minValue(0)] }) },
      { 'age:minValue': 'Вам должно быть {min}', minValue: 'форма {min}' })
    expect(await textsOf(d)).toEqual({ age: 'Вам должно быть 18', kids: 'форма 0' })
  })

  test('3) текст в валидаторе сильнее поля и словаря; атрибуты разметки те же', async () => {
    const own = v.minValue(18).message('валидатор {min}')
    const d = form({
      age: field.number({ validate: [own], messages: { minValue: 'поле {min}' } }),
      kids: field.number({ validate: [v.minValue(0)] }),
    }, { 'age:minValue': 'ключ {min}', minValue: 'форма {min}' })
    expect(await textsOf(d)).toEqual({ age: 'валидатор 18', kids: 'форма 0' })
    expect(own.describe?.()).toEqual(v.minValue(18).describe?.())
    expect(own.message?.('ещё раз {min}')).toBeTypeOf('function')
  })

  test('поле сильнее ключа «поле:код» формы; именованная ссылка реестра несёт свой текст', async () => {
    const d = form({
      age: field.number({ validate: [v.minValue(18)], messages: { minValue: 'поле {min}' } }),
      kids: field.number({ validate: [{ name: 'minValue', arg: 0, message: 'реестр {min}' }] }),
    }, { 'age:minValue': 'ключ {min}' })
    expect(await textsOf(d)).toEqual({ age: 'поле 18', kids: 'реестр 0' })
  })

  test('порядок словарей F55 сохраняется: «поле:код» приложения не перебивает код формы', async () => {
    const d = form({ age: field.number({ validate: [v.minValue(18)] }), kids: field.number({ validate: [v.minValue(0)] }) },
      { minValue: 'форма {min}' })
    expect(await textsOf(d, { 'age:minValue': 'приложение {min}' })).toEqual({ age: 'форма 18', kids: 'форма 0' })
  })

  test('асинхронная проверка: check(…).message() и «поле:код» — на сервере', async () => {
    const checks = new CheckRegistry().register('taken', async () => ({ code: 'x.taken', params: { who: 'a@b' } }))
    const d = defineForm({
      id: 'f56-async',
      fields: {
        a: field.text({ validate: [check('taken').message('{who} занят')] }),
        b: field.text({ validate: [check('taken')] }),
      },
      messages: { 'b:x.taken': 'поле b: {who}' },
    })
    const h = createFormHandler({ description: d, checks, execute: (c) => { c.commit(); return {} } })
    const r = await h(post({ ...envelopeOf({}, d), a: '1', b: '2' }))
    const by = Object.fromEntries(r.result.errors.map((e) => [e.path, e.message]))
    expect(by).toEqual({ a: 'a@b занят', b: 'поле b: a@b' })
  })
})

suite('ctx.fail принимает issues Standard Schema (ошибки БД без импорта lib/db)', () => {
  const run = async (issues: unknown[], d = base) => {
    const h = createFormHandler({ description: d, execute: (c) => c.fail(issues as never) })
    return (await h(post({ ...envelopeOf({}, d), name: 'a' }))).result
  }

  test('код из issue — текст из словаря пакета, ошибка под полем по path', async () => {
    const r = await run([{ message: 'Value already exists', path: ['name'], code: 'unique' }])
    expect(r.ok).toBe(false)
    expect(r.errors.map((e) => [e.path, e.code, e.message, e.origin])).toEqual([['name', 'unique', 'Это значение уже занято', 'server']])
  })

  test('свой текст (template) сильнее словарей; параметры подставляются', async () => {
    const r = await run([{ message: 'Слаг — не длиннее 10', path: ['name'], code: 'maxLength', params: { max: 10 }, template: 'Слаг — не длиннее {max}' }])
    expect(r.errors[0]?.message).toBe('Слаг — не длиннее 10')
  })

  test('текст поля формы «поле:код» сильнее пакета; без path — общая ошибка; без кода — текст как есть', async () => {
    const d = defineForm({ id: 'probe2', fields: { name: field.text({ messages: { unique: 'Имя уже занято' } }) } })
    const r = await run([
      { message: 'Value already exists', path: ['name'], code: 'unique' },
      { message: 'Value already exists', code: 'unique', params: { fields: ['a', 'b'] } },
      { message: 'что-то своё', path: ['name'] },
    ], d)
    const by = r.errors.map((e) => [e.path ?? '*', e.code, e.message])
    expect(by).toContainEqual(['name', 'unique', 'Имя уже занято'])
    expect(by).toContainEqual(['*', 'unique', 'Это значение уже занято'])
    expect(by).toContainEqual(['name', 'schema', 'что-то своё'])
  })

  test('обычные FormError проходят как раньше', async () => {
    const r = await run([{ id: 'x', code: 'name.taken', message: 'занято', path: 'name', origin: 'server' }])
    expect(r.errors.map((e) => [e.path, e.message])).toEqual([['name', 'занято']])
  })
})
