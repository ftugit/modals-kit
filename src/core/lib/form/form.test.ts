// Модульные тесты ядра: без фреймворка, без DOM, без сети.
import { describe as suite, expect, test } from 'vitest'
import {
  checkStale, compileFieldSpec, createRegistry, defineForm,
  fieldLinkState,
  evaluate, fieldSetHash, FormDefinitionError,
  makeRenderer, normalizeErrors, projectAttrs, en,
  assertQueuedProtocol, hasError, invalidFromFor,
  applyHandler, split, makeFieldSugar, normalizeService, policyWith, QueuedWithoutProtocolError,
  SubmitMachine,
  type ErrorContext, type FieldSpec, type FormError, type Result,
} from './index'

import { newSubmission, runSubmit } from './submit'

const render = makeRenderer([en])
const field = makeFieldSugar()
const v = (await import('./validators')).v
const { strengthOf } = await import('./strength')

const SUB = '0192f3c1-4b8e-7c2a-9d1f-6e5a4b3c2d10'
const envelope = (id = 'signup', rev = 1, intent = 'submit') => ({
  __form_id: id, __form_rev: String(rev), __form_instance: `${id}:new`,
  __form_submission: SUB, intent,
})
const body = (values: Record<string, string>, env = envelope()) => {
  const fd = new FormData()
  for (const [k, x] of Object.entries({ ...env, ...values })) fd.set(k, x)
  return fd
}

suite('SubmitMachine', () => {
  test('queue действительно передаёт слот следующей отправке', async () => {
    const machine = new SubmitMachine('queue')
    const first = await machine.acquire(1, 'submit', 'first')
    expect(first.go).toBe(true)
    if (!first.go) return

    let acquired = false
    const secondPromise = machine.acquire(1, 'submit', 'second').then((x) => {
      acquired = x.go
      return x
    })
    await Promise.resolve()
    expect(acquired).toBe(false)

    machine.finish(first.submission)
    const second = await secondPromise
    expect(second.go).toBe(true)
    expect(acquired).toBe(true)
  })
})

const signup = defineForm({
  id: 'signup',
  actions: [
    { id: 'submit', validate: 'full' },
    { id: 'save-draft', validate: 'partial', relax: ['required'] },
  ],
  fields: {
    email: field.email({ validate: [v.required(), v.maxLength(320)] }),
    age: field.number({ validate: [v.minValue(18)] }),
    agree: field.checkbox({ validate: [v.required()] }),
  },
})

suite('описание и ограничения', () => {
  test('дефектное описание не объявляется', () => {
    expect(() => defineForm({ id: 'bad', fields: { a: field.checkbox({ validate: [v.minLength(3)] }) } }))
      .toThrow(FormDefinitionError)
  })

  test('противоречие границ ловится', () => {
    expect(() => defineForm({ id: 'bad', fields: { a: field.number({ validate: [v.minValue(120), v.maxValue(18)] }) } }))
      .toThrow(/больше/)
  })

  test('пустой список действий — отказ при объявлении, а не TypeError на POST', () => {
    expect(() => defineForm({ id: 'no-actions', fields: { a: field.text({}) }, actions: [] }))
      .toThrow(/actions не может быть пустым/)
  })

  test('имя проверяется посегментно', () => {
    expect(() => defineForm({ id: 'bad', fields: { Aa: field.text({}) } })).toThrow(/сегмент/)
    expect(() => defineForm({ id: 'ok', fields: { 'items.r1.qty': field.number({}) } })).not.toThrow()
  })

  test('атрибуты выводит тип, а не центральная таблица', () => {
    expect(signup.attrsOf('email').attrs).toMatchObject({ type: 'email', required: true, maxlength: 320 })
    expect(signup.attrsOf('age').attrs).toMatchObject({ type: 'number', min: 18, step: 'any' })
  })

  test('правило без вида даёт opaque и названную причину', () => {
    const d = defineForm({ id: 'x', fields: { p: field.text({ validate: [v.sameAs('q')] }) } })
    expect(d.attrsOf('p').skipped[0]!.kind).toBe('opaque')
    expect(d.attrsOf('p').skipped[0]!.why).toMatch(/сравнивать/)
  })

  test('исключающая граница атрибутом не становится', () => {
    const d = defineForm({ id: 'x', fields: { n: field.number({ validate: [v.minValue(18, true)] }) } })
    expect(d.attrsOf('n').attrs['min']).toBeUndefined()
    expect(d.attrsOf('n').skipped[0]!.why).toMatch(/исключающая/)
  })

  test('неизвестный или сломанный именованный валидатор — дефект описания, а не молчание', () => {
    expect(() => defineForm({ id: 'bad', fields: { a: field.text({ validate: [{ name: 'missing' }] }) } }))
      .toThrow(/валидатор не зарегистрирован/)
    expect(() => defineForm({ id: 'bad', fields: { a: field.text({ validate: [{ name: 'pattern', arg: { source: '[' } }] }) } }))
      .toThrow(/Invalid regular expression|SyntaxError|Unterminated/)
    expect(() => defineForm({ id: 'bad', fields: { a: field.text({ validate: [{ name: 'minLength', arg: -1 }] }) } }))
      .toThrow(/неотрицательное/)
  })

  test('именованные встроенные file-валидаторы регистрируются тем же путём', () => {
    const d = defineForm({
      id: 'upload',
      fields: {
        doc: field.file({ validate: [{ name: 'accept', arg: ['.pdf'] }, { name: 'maxSize', arg: 1024 }] }),
      },
    })
    expect(d.attrsOf('doc').attrs).toMatchObject({ type: 'file', accept: '.pdf' })
    expect(d.attrsOf('doc').skipped.some((x) => x.kind === 'maxSize')).toBe(true)
  })

  test('лимиты описания применяются к help и pattern source', () => {
    const limited = policyWith({ limits: { helpLength: 4, patternLength: 4 } })
    expect(() => defineForm({
      id: 'bad-help', policy: limited,
      fields: { a: field.text({ help: 'слишком длинно' }) },
    })).toThrow(/подсказка слишком длинная/)
    expect(() => defineForm({
      id: 'bad-pattern', policy: limited,
      fields: { a: field.text({ validate: [v.pattern({ source: '[a-z]+' })] }) },
    })).toThrow(/шаблон длиннее предела/)
  })

  test('числовой step сверяется от min так же, как HTML constraint validation', () => {
    const d = defineForm({ id: 'stepn', fields: { n: field.number({ validate: [v.minValue(18), v.step(5)] }) } })
    expect(d.attrsOf('n').attrs).toMatchObject({ type: 'number', min: 18, step: 5 })
    expect(evaluate(body({ n: '18' }, envelope('stepn')), d, { render }).errors).toHaveLength(0)
    expect(evaluate(body({ n: '23' }, envelope('stepn')), d, { render }).errors).toHaveLength(0)
    expect(evaluate(body({ n: '20' }, envelope('stepn')), d, { render }).errors[0]!.code).toBe('step')
  })

  test('дробные числа без step-валидатора не блокируются HTML step=1', () => {
    const d = defineForm({ id: 'decimal', fields: { n: field.number({ validate: [v.minValue(0)] }) } })
    expect(d.attrsOf('n').attrs).toMatchObject({ type: 'number', min: 0, step: 'any' })
    expect(evaluate(body({ n: '1.5' }, envelope('decimal')), d, { render }).errors).toHaveLength(0)
  })

  test('ядро не обещает HTML-атрибуты, которые браузер игнорирует на данном input', () => {
    const d = defineForm({
      id: 'native',
      fields: {
        c: field.color({ validate: [v.required(), v.pattern({ source: '#[0-9a-fA-F]{6}' })] }),
        h: field.hidden({ validate: [v.required(), v.maxLength(8)] }),
        r: field.range({ validate: [v.required(), v.minValue(1), v.maxValue(5)] }),
      },
    })

    expect(d.attrsOf('c').attrs).toMatchObject({ type: 'color' })
    expect(d.attrsOf('c').attrs['required']).toBeUndefined()
    expect(d.attrsOf('c').attrs['pattern']).toBeUndefined()
    expect(d.attrsOf('c').skipped.map((x) => x.kind)).toEqual(expect.arrayContaining(['required', 'pattern']))

    expect(d.attrsOf('h').attrs).toMatchObject({ type: 'hidden' })
    expect(d.attrsOf('h').attrs['required']).toBeUndefined()
    expect(d.attrsOf('h').attrs['maxlength']).toBeUndefined()

    expect(d.attrsOf('r').attrs).toMatchObject({ type: 'range', min: 1, max: 5, step: 'any' })
    expect(d.attrsOf('r').attrs['required']).toBeUndefined()
  })

  test('otp и switch: свои атрибуты разметки, значения — как у текста и флажка', () => {
    const d = defineForm({
      id: 'modes',
      fields: {
        code: field.otp({ validate: [v.required(), v.maxLength(6), v.pattern({ source: '\\d{6}' })] }),
        on: field.switch({ validate: [v.required()] }),
      },
    })
    expect(d.attrsOf('code').attrs).toMatchObject({
      type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code',
      required: true, maxlength: 6, pattern: '\\d{6}',
    })
    expect(d.attrsOf('on').attrs).toMatchObject({ type: 'checkbox', role: 'switch', value: 'on', required: true })

    const okRes = evaluate(body({ code: '123456', on: 'on' }, envelope('modes')), d, { render })
    expect(okRes.errors).toHaveLength(0)
    expect(okRes.values).toMatchObject({ code: '123456', on: true })
    const bad = evaluate(body({ code: '12ab56' }, envelope('modes')), d, { render })
    expect(bad.errors.map((e) => `${e.path}:${e.code}`)).toEqual(expect.arrayContaining(['code:pattern', 'on:required']))
  })

  test('variant доходит до описания и не меняет разметку поля', () => {
    const d = defineForm({
      id: 'variants',
      fields: {
        plain: field.password({ validate: [v.minLength(10)] }),
        meter: field.password({ variant: 'strength', validate: [v.minLength(10)] }),
      },
    })
    expect(d.byName.meter.variant).toBe('strength')
    expect(d.byName.plain.variant).toBeUndefined()
    const strip = (a: Record<string, unknown>) => { const { name: _n, id: _i, ...rest } = a; return rest }
    expect(strip(d.attrsOf('meter').attrs)).toEqual(strip(d.attrsOf('plain').attrs))
  })

  test('integer не ставит опасный step=1 при дробном min', () => {
    const d = defineForm({ id: 'intmin', fields: { n: field.number({ validate: [v.minValue(18.5), v.integer()] }) } })
    expect(d.attrsOf('n').attrs).toMatchObject({ type: 'number', min: 18.5, step: 'any' })
    expect(d.attrsOf('n').skipped.some((x) => x.kind === 'step' && /дробным min/.test(x.why))).toBe(true)
    expect(evaluate(body({ n: '19' }, envelope('intmin')), d, { render }).errors).toHaveLength(0)
    expect(evaluate(body({ n: '19.5' }, envelope('intmin')), d, { render }).errors[0]!.code).toBe('integer')
  })

  test('time/datetime не получают HTML default step=60 без явного step-валидатора', () => {
    const time = defineForm({ id: 'timeform', fields: { t: field.time({ validate: [] }) } })
    expect(time.attrsOf('t').attrs).toMatchObject({ type: 'time', step: 'any' })
    expect(evaluate(body({ t: '12:00:30' }, envelope('timeform')), time, { render }).errors).toHaveLength(0)
  })

  test('date/time step работает с тем же base, который попадёт в HTML', () => {
    const date = defineForm({ id: 'dateform', fields: { d: field.date({ validate: [v.minDate('2024-01-01'), v.step(2, 'day')] }) } })
    expect(date.attrsOf('d').attrs).toMatchObject({ type: 'date', min: '2024-01-01', step: 2 })
    expect(evaluate(body({ d: '2024-01-03' }, envelope('dateform')), date, { render }).errors).toHaveLength(0)
    expect(evaluate(body({ d: '2024-01-02' }, envelope('dateform')), date, { render }).errors[0]!.code).toBe('step')

    const time = defineForm({ id: 'timeform2', fields: { t: field.time({ validate: [v.minDate('12:00'), v.step(15, 'second')] }) } })
    expect(time.attrsOf('t').attrs).toMatchObject({ type: 'time', min: '12:00', step: 15 })
    expect(evaluate(body({ t: '12:00:30' }, envelope('timeform2')), time, { render }).errors).toHaveLength(0)
    expect(evaluate(body({ t: '12:00:31' }, envelope('timeform2')), time, { render }).errors[0]!.code).toBe('step')
  })

  test('серверный decode не принимает даты и время, которые HTML input тоже не примет', () => {
    const date = defineForm({ id: 'datebad', fields: { d: field.date({}) } })
    expect(evaluate(body({ d: '2024-02-31' }, envelope('datebad')), date, { render }).errors[0]!.code).toBe('type.date')

    const time = defineForm({ id: 'timebad', fields: { t: field.time({}) } })
    expect(evaluate(body({ t: '25:00' }, envelope('timebad')), time, { render }).errors[0]!.code).toBe('type.time')

    const dateTime = defineForm({ id: 'dtbad', fields: { dt: field['datetime-local']({}) } })
    expect(evaluate(body({ dt: '2024-02-31T10:00' }, envelope('dtbad')), dateTime, { render }).errors[0]!.code).toBe('type.datetime')
  })

  test('свой тип регистрируется и проецирует свои виды', () => {
    const registry = createRegistry()
    registry.registerType({
      kind: 'rating', inputs: ['rating'], multiple: false, empty: null,
      decode: (e) => ({ ok: true, value: Number(e[0] ?? 0) }),
      encode: () => undefined,
      constraints: { minMagnitude: (c) => ({ min: (c as { value: number }).value }) },
      attrs: () => ({ type: 'range' }),
      degradation: { withoutJs: 'ползунок' },
    })
    const d = defineForm({
      id: 'r', registry,
      fields: { mark: { kind: 'rating', input: 'rating', validators: [v.minValue(1)] } as never },
    })
    expect(d.attrsOf('mark').attrs).toMatchObject({ type: 'range', min: 1 })
  })

  test('реестры независимы', () => {
    const a = createRegistry(), b = createRegistry()
    a.registerPattern('inn', '\\d{10}')
    expect(a.pattern('inn')).toBe('\\d{10}')
    expect(b.pattern('inn')).toBeUndefined()
  })
})

suite('разбор и проверка', () => {
  test('число разбирается по правилу HTML, а не по Number()', () => {
    const ev = evaluate(body({ email: 'a@b.io', age: '+20', agree: 'on' }), signup, { render })
    expect(ev.errors.map((e) => e.code)).toContain('type.number')
  })

  test('структурная ошибка подавляет правила поверх мусора', () => {
    const ev = evaluate(body({ email: 'a@b.io', age: 'abc', agree: 'on' }), signup, { render })
    expect(ev.errors.filter((e) => e.path === 'age').map((e) => e.code)).toEqual(['type.number'])
  })

  test('действие снимает вид ограничения данными', () => {
    const full = evaluate(body({}), signup, { render })
    const draft = evaluate(body({}, envelope('signup', 1, 'save-draft')), signup, { render })
    expect(full.errors.some((e) => e.code === 'required')).toBe(true)
    expect(draft.errors.some((e) => e.code === 'required')).toBe(false)
  })

  test('конверт проверяется строго', () => {
    const fd = body({})
    fd.delete('__form_submission')
    expect(evaluate(fd, signup, { render }).fatal?.code).toBe('envelope.invalid')
  })

  test('порядок ошибок стабилен', () => {
    const mk = (path: string, code: string): FormError => ({ id: '', code, path, origin: 'core' })
    const out = normalizeErrors([mk('b', 'x'), mk('a', 'y'), mk('b', 'x')], render)
    expect(out.map((e) => e.path)).toEqual(['a', 'b'])
  })

  test('код ошибки step имеет встроенное сообщение', () => {
    expect(render('step', { step: 5 })).toBe('Step 5')
  })
})

suite('показ ошибок', () => {
  const facts: FormError[] = [
    { id: '1', code: 'required', message: 'Обязательное поле', path: 'email', origin: 'core' },
    { id: '2', code: 'form.stale', message: 'Устарело', origin: 'server' },
  ]
  const ctx: ErrorContext = { from: 'fetch', intent: 'submit', outcome: 'not-applied' }

  test('без обработчика показ равен факту', () => {
    expect(applyHandler(facts, ctx).errors).toEqual(facts)
  })

  test('стирание пути уводит всё в общий блок', () => {
    const shown = applyHandler(facts, ctx, (list) => list.map((e) => ({ ...e, path: undefined })))
    expect(split(shown.errors).common).toHaveLength(2)
    expect(Object.keys(split(shown.errors).byField)).toHaveLength(0)
  })

  test('удаление считается и сообщается', () => {
    const shown = applyHandler(facts, ctx, (list) => list.filter((e) => e.path !== 'email'))
    expect(shown.removed).toBe(1)
  })

  test('подсветка по факту переживает удаление текста', () => {
    const shown = applyHandler(facts, ctx, (list) => list.filter((e) => e.path !== 'email'))
    expect(hasError('email', facts, shown.errors, 'fact')).toBe(true)
    expect(hasError('email', facts, shown.errors, 'shown')).toBe(false)
  })

  test('пометка silent гасит подсветку на любом уровне', () => {
    const quiet: FormError[] = [{ ...facts[0]!, silent: true }]
    expect(hasError('email', quiet, quiet, 'fact')).toBe(false)
  })

  test('уровень поля перебивает уровень формы', () => {
    const d = defineForm({
      id: 'x', invalidFrom: 'fact',
      fields: { a: field.text({ invalidFrom: 'shown' }), b: field.text({}) },
    })
    expect(invalidFromFor('a', d)).toBe('shown')
    expect(invalidFromFor('b', d)).toBe('fact')
  })
})

suite('чужие службы', () => {
  const instruction = {
    id: 'psp',
    parse: ({ body: b }: { status: number; body: unknown }) => {
      const x = b as { violations?: { attr?: string; rule?: string; text?: string }[] } | null
      if (!x?.violations) return null
      return x.violations.map((r) => ({ code: r.rule, field: r.attr, message: r.text }))
    },
    aliases: { pan: 'card' },
    codeAliases: { TOO_BIG: 'amount' },
    messages: { LUHN: 'Банк не принял карту' },
  }

  test('имена службы переводятся в наши', () => {
    const [e] = normalizeService({ status: 200, instruction,
      body: { violations: [{ attr: 'pan', rule: 'LUHN', text: 'nope' }] } })
    expect(e).toMatchObject({ path: 'card', code: 'external.LUHN', message: 'Банк не принял карту' })
    expect(e!.source).toMatchObject({ field: 'pan' })
  })

  test('код указывает на поле, когда поля нет', () => {
    const [e] = normalizeService({ status: 200, instruction,
      body: { violations: [{ rule: 'TOO_BIG', text: 'x' }] } })
    expect(e!.path).toBe('amount')
  })

  test('нераспознанный формат не даёт тишины', () => {
    const [e] = normalizeService({ status: 502, instruction, body: '<html>' })
    expect(e!.code).toBe('service.502')
  })
})

suite('поля из рантайма', () => {
  test('функции в спецификации запрещены', () => {
    const r = compileFieldSpec({ name: 'x', input: 'text', label: 'X', validate: () => null } as never)
    expect(r.ok).toBe(false)
  })

  test('variant: строка проходит, не строка — дефект', () => {
    const r = compileFieldSpec({ name: 'x', input: 'password', label: 'X', variant: 'strength' })
    expect(r.ok && r.field.variant).toBe('strength')
    expect(compileFieldSpec({ name: 'x', input: 'password', label: 'X', variant: 1 } as never).ok).toBe(false)
  })

  test('имя проверяется до префикса', () => {
    for (const name of ['__proto__', 'a.b', 'Aa'])
      expect(compileFieldSpec({ name, input: 'text', label: 'X' }).ok).toBe(false)
  })

  test('произвольный шаблон запрещён по умолчанию', () => {
    const spec: FieldSpec = { name: 'x', input: 'text', label: 'X', rules: [{ rule: 'pattern', arg: '\\d+' }] }
    expect(compileFieldSpec(spec).ok).toBe(false)
    expect(compileFieldSpec(spec, { allowCustomPattern: true }).ok).toBe(true)
  })

  test('вложенный квантификатор отклоняется даже при разрешении', () => {
    const spec: FieldSpec = { name: 'x', input: 'text', label: 'X', rules: [{ rule: 'pattern', arg: '(a+)+' }] }
    expect(compileFieldSpec(spec, { allowCustomPattern: true }).ok).toBe(false)
  })
})

suite('устаревание', () => {
  test('совпадение ревизии и состава — не рассинхрон', () => {
    expect(checkStale(signup, { revision: 1, fieldSetHash: fieldSetHash(signup) }, {}))
      .toEqual({ stale: false })
  })

  test('рассинхрон переносит значения и называет отброшенные', () => {
    const verdict = checkStale(signup, { revision: 99 }, { email: 'a@b.io', gone: 'x' })
    expect(verdict.stale).toBe(true)
    if (!verdict.stale) return
    expect(verdict.carried).toEqual({ email: 'a@b.io' })
    expect(verdict.dropped).toEqual(['gone'])
  })
})

suite('исход', () => {
  // Без outcome: каждый тест задаёт свой исход поверх базы.
  const base: Omit<Result, 'outcome'> = { v: 1, formId: 'f', instance: 'f:new', submissionId: SUB, ok: true,
                 status: 200, errors: [], values: {}, revision: 1, from: 'fetch' }

  test('queued без протокола — ошибка разработки', () => {
    expect(() => assertQueuedProtocol({ ...base, outcome: 'queued' }))
      .toThrow(QueuedWithoutProtocolError)
    expect(() => assertQueuedProtocol({
      ...base, outcome: 'queued', data: { pollUrl: '/p', statusUrl: '/s' },
    })).not.toThrow()
  })
})

suite('политика', () => {
  test('ключи конверта переопределяются', () => {
    const policy = policyWith({ envelopeKeys: { id: 'f_id' } })
    const d = defineForm({ id: 'p', policy, fields: { a: field.text({}) } })
    const fd = new FormData()
    fd.set('f_id', 'p'); fd.set('__form_rev', '1')
    fd.set('__form_instance', 'p:new'); fd.set('__form_submission', SUB)
    expect(evaluate(fd, d, { render }).fatal).toBeUndefined()
  })

  test('подстановка заменяется', () => {
    const upper = makeRenderer([{ required: 'нужно {what}' }], (t, p) =>
      t.replace(/\{(\w+)\}/g, (_, k) => String(p[k]).toUpperCase()))
    expect(upper('required', { what: 'поле' })).toBe('нужно ПОЛЕ')
  })
})

suite('проекция атрибутов', () => {
  test('тип, не знающий вида, называет причину', () => {
    const registry = createRegistry()
    const type = registry.types.get('checkbox')
    const { skipped } = projectAttrs(type, [{ kind: 'minLength', value: 3 }], { input: 'checkbox', name: 'a', constraints: [{ kind: 'minLength', value: 3 }], attrs: {} })
    expect(skipped[0]!.why).toMatch(/не знает вида/)
  })
})

suite('сложность пароля', () => {
  const val = v
  const check = (value: string, need: Parameters<typeof val.strength>[0] = 'good') =>
    val.strength(need)(value, { path: 'p', values: {} })

  test('повторённое слово с цифрой не считается надёжным', () => {
    expect(strengthOf('testtest1').level).not.toBe('strong')
    expect(check('testtest1')).not.toBeNull()
  })

  test('знаки не мешают, а помогают', () => {
    expect(check('Tr0ub4dour&3')).toBeNull()
    expect(strengthOf('Tr0ub4dour&3').level).toBe('strong')
  })

  test('повтор куска распознаётся', () => {
    expect(strengthOf('abcabcabcabc').notes).toContain('repeat')
  })

  test('подряд идущие символы штрафуются', () => {
    expect(strengthOf('abcdefgh').notes).toContain('sequence')
  })

  test('известная основа обрушивает оценку', () => {
    expect(strengthOf('password123').notes).toContain('common')
    expect(check('password123', 'fair')).not.toBeNull()
  })

  test('требуемый уровень задаётся при подключении', () => {
    const value = 'korova7!'
    const fair = val.strength('fair')(value, { path: 'p', values: {} })
    const strong = val.strength('strong')(value, { path: 'p', values: {} })
    expect(fair).toBeNull()
    expect(strong).not.toBeNull()
  })

  test('в разметку уходит только нижняя граница длины', () => {
    const d = defineForm({ id: 'pw', fields: { p: field.password({ validate: [val.strength('strong')] }) } })
    expect(d.attrsOf('p').attrs['minlength']).toBe(12)
    expect(d.attrsOf('p').attrs['pattern']).toBeUndefined()
    expect(d.attrsOf('p').skipped.map((s) => s.kind)).toContain('opaque')
  })

  test('оценка заменяется своей', () => {
    const always = val.strength('strong', { score: () => ({ bits: 999, level: 'strong', notes: [] }) })
    expect(always('123', { path: 'p', values: {} })).toBeNull()
  })

  test('пустое значение проверяет обязательность, а не сложность', () => {
    expect(check('')).toBeNull()
  })
})

/* ── выключенное поле: контракт ядра ───────────────────────────────── */

suite('поле знает, что оно выключено', () => {
  test('сахар несёт disabled и reason в черновик', () => {
    const d = field.text({ label: 'Код', disabled: true, reason: 'нужна роль' })
    expect(d.disabled).toBe(true)
    expect(d.reason).toBe('нужна роль')
    const def = defineForm({ id: 'dis', fields: { a: d } })
    expect(def.fields[0]?.disabled).toBe(true)
    expect(def.fields[0]?.reason).toBe('нужна роль')
  })

  test('reason без disabled не доживает до черновика', () => {
    const d = field.text({ label: 'Код', reason: 'вздор' })
    expect(d.disabled).toBeUndefined()
    expect(d.reason).toBeUndefined()
  })

  test('связка перекрывает объявление — и гасит, и размыкает', () => {
    const def = defineForm({
      id: 'lk',
      fields: { a: field.text({ label: 'A', disabled: true, reason: 'источник: нет доступа' }) },
    })
    const f = def.fields[0]!
    // связка молчит — как объявлено
    expect(fieldLinkState(f, undefined)).toEqual({ disabled: true, reason: 'источник: нет доступа' })
    // ответ связки полон: старого reason не остаётся
    expect(fieldLinkState(f, { disabled: true })).toEqual({ disabled: true, reason: undefined })
    // связка размыкает статически закрытое поле
    expect(fieldLinkState(f, { disabled: false })).toEqual({})
    // инвариант держится и при попытке принести reason без disabled
    expect(fieldLinkState({} as never, { reason: 'просто так' })).toEqual({})
  })
})

/* ─────────────── Q1: notifyResultErrors (приёмник ошибок) ─────────────── */

test('Q1: external + outcome-unknown + warnings; дедуп по submissionId; no-sink — ключ цел', async () => {
  const { notifyResultErrors } = await import('./errors')
  type Evt = { code: string; lib: string }
  const events: Evt[] = []
  const sink = (e: Evt) => events.push(e)
  const result: any = {
    v: 1, formId: 'f', instance: 'i', submissionId: 's1', ok: false, status: 422,
    outcome: 'not-applied', from: 'fetch',
    errors: [
      { id: 'a:external:1', code: 'external', origin: 'external' },
      { id: 'name:required:2', code: 'required', origin: 'core', path: 'name' },
    ],
    warnings: [{ id: '*:after:3', code: 'after', origin: 'server' }],
    values: {},
  }
  let seenKey: string | undefined
  seenKey = notifyResultErrors(sink, result, seenKey)
  expect(events.map((e) => [e.lib, e.code])).toEqual([
    ['form', 'external-error'],
    ['form', 'warnings'],
  ])
  expect(seenKey).toBe('s1')
  // повтор того же результата (lift+submit) — молчание
  const n = events.length
  seenKey = notifyResultErrors(sink, result, seenKey)
  expect(events).toHaveLength(n)
  // новый submission + unknown — сообщено, включая исходный ключ dedup
  events.length = 0
  seenKey = notifyResultErrors(sink, { ...result, submissionId: 's2', outcome: 'unknown' }, seenKey)
  expect(events.map((e) => e.code)).toEqual(['external-error', 'outcome-unknown', 'warnings'])
  // sink нет — nothing, переданный ключ сохранён
  expect((notifyResultErrors as any)(undefined, result, 'keepme')).toBe('keepme')
})

/* ── F14: accept/maxSize по правилам атрибута, у files — поэлементно ── */

suite('файловые правила (F14)', () => {
  const ctx = { path: 'f', values: {} }
  const file = (name: string, type: string, size = 1) => new File(['x'.repeat(size)], name, { type })

  test('MIME сравнивается строкой: + и . — не метасимволы', () => {
    expect(v.accept(['image/svg+xml'])(file('a.svg', 'image/svg+xml'), ctx)).toBeNull()
    expect(v.accept(['application/vnd.api+json'])(file('a.json', 'application/vnd.api+json'), ctx)).toBeNull()
    expect(v.accept(['image/png'])(file('a.p', 'imageXpng'), ctx)?.code).toBe('accept')
    expect(v.accept(['image/png'])(file('a.png', 'image/pngx'), ctx)?.code).toBe('accept')
  })

  test('маска type/*, регистр и параметры MIME', () => {
    expect(v.accept(['image/*'])(file('a.png', 'image/png'), ctx)).toBeNull()
    expect(v.accept(['image/*'])(file('a.txt', 'text/plain'), ctx)?.code).toBe('accept')
    expect(v.accept(['Text/Plain'])(file('a.txt', 'text/plain;charset=utf-8'), ctx)).toBeNull()
    expect(v.accept(['.PDF'])(file('doc.pdf', ''), ctx)).toBeNull()
  })

  test('files: каждый файл проверяется отдельно, без броска', () => {
    const d = defineForm({ id: 'many', fields: { docs: field.file({ multiple: true, validate: [v.accept(['.pdf']), v.maxSize(4)] }) } })
    const fd = (...files: File[]) => {
      const b = body({}, envelope('many'))
      for (const f of files) b.append('docs', f)
      return b
    }
    expect(evaluate(fd(file('a.pdf', 'application/pdf', 1), file('b.pdf', 'application/pdf', 2)), d, { render }).errors).toHaveLength(0)
    const wrong = evaluate(fd(file('a.pdf', 'application/pdf'), file('b.exe', 'application/x-msdownload')), d, { render }).errors
    expect(wrong.map((e) => [e.code, e.params?.['name']])).toEqual([['accept', 'b.exe']])
    const big = evaluate(fd(file('a.pdf', 'application/pdf', 1), file('c.pdf', 'application/pdf', 9)), d, { render }).errors
    expect(big.map((e) => [e.code, e.params?.['name']])).toEqual([['maxSize', 'c.pdf']])
  })
})

/* ── F15: share() не заходит в File/Date — замена видна ─────────────── */

suite('структурное разделение (F15)', async () => {
  const { share, FormStore, initialState } = await import('./state')
  const a = new File(['a'], 'a.txt'), b = new File(['bb'], 'b.txt')

  test('новый File/Date заменяет старый, массив файлов — тоже', () => {
    expect(share({ doc: a }, { doc: b }).doc).toBe(b)
    expect(share({ docs: [a] }, { docs: [b] }).docs[0]).toBe(b)
    const d2 = new Date(1)
    expect(share({ at: new Date(0) }, { at: d2 }).at).toBe(d2)
  })

  test('неизменившиеся ветви сохраняют ссылку, тот же File — тоже', () => {
    const prev = { doc: a, meta: { n: 1 }, list: [1, 2] }
    const next = share(prev, { doc: a, meta: { n: 1 }, list: [1, 2] })
    expect(next).toBe(prev)
    const bare = Object.assign(Object.create(null), { x: 1 })
    expect(share(bare, Object.assign(Object.create(null), { x: 1 }))).toBe(bare)
  })

  test('FormStore.set будит подписчиков при замене файла', () => {
    const store = new FormStore(initialState(1, { doc: a }))
    let woke = 0
    store.subscribe(() => { woke++ })
    store.set((s) => ({ ...s, values: { ...s.values, doc: b } }))
    expect(woke).toBe(1)
    expect(store.getSnapshot().values['doc']).toBe(b)
  })
})

/* ── F21: вытесненная асинхронная проверка молчит ──────────────────── */

suite('асинхронные проверки: вытеснение (F21)', async () => {
  const { AsyncRunner, CheckRegistry, check } = await import('./async')
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const make = () => {
    const checks = new CheckRegistry().register('taken', async (value) => {
      await sleep(value === 'slow' ? 120 : 10)           // signal намеренно не уважается
      return { code: 'login.taken' }
    })
    const d = defineForm({ id: 'q', fields: { login: field.text({ validate: [check('taken', { debounceMs: 0 })] }) } })
    return { runner: new AsyncRunner(checks), d }
  }

  test('медленный ответ вытесненной проверки не стирает свежую ошибку', async () => {
    const { runner, d } = make()
    const calls: string[] = []
    const cb = (e: readonly FormError[]) => { calls.push(e.length ? e[0]!.code : 'null') }
    runner.schedule(d, 'login', { login: 'slow' }, cb)
    await sleep(20)
    runner.schedule(d, 'login', { login: 'fast' }, cb)
    await sleep(200)
    expect(calls).toEqual(['login.taken'])
  })

  test('после cancel колбэк не вызывается', async () => {
    const { runner, d } = make()
    const calls: unknown[] = []
    runner.schedule(d, 'login', { login: 'fast' }, (e) => { calls.push(e) })
    await sleep(5)
    runner.cancel('login')
    await sleep(60)
    expect(calls).toEqual([])
  })
  test('cancel() без поля (размонтирование, B1) глушит все запланированные проверки', async () => {
    const { runner, d } = make()
    const calls: unknown[] = []
    runner.schedule(d, 'login', { login: 'fast' }, (e) => { calls.push(e) })
    runner.cancel()
    await sleep(60)
    expect(calls).toEqual([])
  })
})

/* ── B7: кэш проверок по значению ограничен ──────────────────────────── */

suite('асинхронные проверки: предел кэша (B7)', async () => {
  const { AsyncRunner, CheckRegistry, check } = await import('./async')
  test('старые значения вытесняются, свежие берутся из кэша', async () => {
    let calls = 0
    const checks = new CheckRegistry().register('free', async () => { calls++; return null })
    const d = defineForm({ id: 'c', fields: { login: field.text({ validate: [check('free', { debounceMs: 0 })] }) } })
    const runner = new AsyncRunner(checks)
    for (let i = 0; i < 250; i++) await runner.run(d, 'login', { login: `u${i}` })
    expect(calls).toBe(250)
    await runner.run(d, 'login', { login: 'u249' })   // свежее — из кэша
    expect(calls).toBe(250)
    await runner.run(d, 'login', { login: 'u0' })     // самое старое — вытеснено
    expect(calls).toBe(251)
  })
})

/* ── F20: браузер даёт проверке те же значения, что сервер ─────────── */

suite('асинхронные проверки: значения как на сервере (F20)', async () => {
  const { AsyncRunner, CheckRegistry, check, runAsyncChecks, valuesForChecks } = await import('./async')
  const { decode } = await import('./decode')

  test('число, флажок и мультиполе приходят типизированными на обоих путях', async () => {
    const seen: unknown[] = []
    const checks = new CheckRegistry().register('adult', async (value, ctx) => {
      seen.push({ value, agree: ctx.values['agree'], tags: ctx.values['tags'] })
      return typeof value === 'number' && value >= 18 ? null : { code: 'age.too-young' }
    })
    const d = defineForm({ id: 'p', fields: {
      age: field.number({ validate: [check('adult')] }),
      agree: field.checkbox({}),
      tags: field.select({ multiple: true, options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] } as never),
    } })
    const fd = new FormData()
    fd.set('age', '42'); fd.set('agree', 'on'); fd.append('tags', 'a'); fd.append('tags', 'b')

    const server = await runAsyncChecks(d, decode(fd, d).values, checks)
    const browser = await new AsyncRunner(checks).run(d, 'age', valuesForChecks(fd, d))
    expect(server).toEqual([])
    expect(browser).toEqual([])
    expect(seen[1]).toEqual(seen[0])
    expect(seen[0]).toMatchObject({ value: 42, agree: true })
  })
})

suite('runSubmit: Result.intent', () => {
  const d = defineForm({
    id: 'signup',
    actions: [{ id: 'save', validate: 'full' }],
    fields: { name: field.text({ validate: [v.required()] }) },
  })
  const input = (name: string) => ({
    description: d, data: body({ name }, envelope('signup', 1, 'save')),
    instance: 'signup:new', submission: newSubmission(1, 'save'), render, intent: 'save',
  })

  test('локальный провал полной проверки несёт интент, транспорт не звали', async () => {
    const r = await runSubmit({ ...input(''), transport: async () => { throw new Error('транспорт звать нельзя') } })
    expect(r.ok).toBe(false)
    expect(r.intent).toBe('save')
  })

  test('сетевой исход несёт интент', async () => {
    const r = await runSubmit({ ...input('a'), transport: async () => ({ kind: 'network' as const, code: 'network.failed', detail: 'down' }) })
    expect(r.outcome).toBe('unknown')
    expect(r.intent).toBe('save')
  })

  test('транспортный результат без штампа доштамповывается интентом отправки', async () => {
    const bare = { v: 1, ok: true, outcome: 'committed', errors: [] } as unknown as Result
    const r = await runSubmit({ ...input('a'), transport: async () => ({ kind: 'result' as const, result: bare }) })
    expect(r.intent).toBe('save')
  })
})
