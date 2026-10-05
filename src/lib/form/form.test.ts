// Модульные тесты ядра: без фреймворка, без DOM, без сети.
import { describe as suite, expect, test } from 'vitest'
import {
  applyOps, assertConsistent, checkStale, compileFieldSpec, createRegistry, defineForm,
  degrade, editor, evaluate, fieldSetHash, FormDefinitionError, groupRows, InvariantError,
  makeContinuation, makeRenderer, normalizeErrors, projectAttrs, reconcile, ru,
  addressedTo, assertQueuedProtocol, effectiveMode, hasError, invalidFromFor,
  applyHandler, split, makeFieldSugar, normalizeService, policyWith, QueuedWithoutProtocolError,
  SubmitMachine,
  type ErrorContext, type FieldSpec, type FormError, type Result,
} from './index'

const render = makeRenderer([ru])
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
    { id: 'add-row', validate: 'none', sideEffect: 'mutate-schema' },
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
    expect(render('step', { step: 5 })).toBe('Шаг 5')
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

suite('изменение набора полей', () => {
  const order = defineForm({
    id: 'order',
    fields: {
      'items.r1.sku': field.text({}),
      'items.r1.qty': field.number({ validate: [v.minValue(1)] }),
    },
  })

  test('строка копируется по стабильному ключу', () => {
    const next = applyOps(order, [editor.addRow('items', 'r7')])
    expect(groupRows(next.fields)).toEqual({ items: ['r1', 'r7'] })
    expect(next.attrsOf('items.r7.qty').attrs['min']).toBe(1)
  })

  test('удаление строки не задевает соседей', () => {
    const next = applyOps(order, [editor.addRow('items', 'r7'), editor.removeRow('items', 'r1')])
    expect(groupRows(next.fields)).toEqual({ items: ['r7'] })
  })

  test('ревизия растёт один раз на пакет', () => {
    const next = applyOps(order, [editor.addRow('items', 'r2'), editor.addRow('items', 'r3')])
    expect(next.revision).toBe(order.revision + 1)
  })

  test('новое поле помечено свежим и не ругается обязательностью', () => {
    const spec: FieldSpec = { name: 'phone', input: 'tel', label: 'Телефон', required: true }
    const compiled = compileFieldSpec(spec)
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return
    const next = applyOps(signup, [editor.add(compiled.field)])
    const ev = evaluate(body({ email: 'a@b.io', age: '30', agree: 'on' }, envelope('signup', 2)),
                        next, { render })
    expect(ev.errors.some((e) => e.path === 'u_phone')).toBe(false)
  })

  test('инвариант ловит осиротевшую ошибку', () => {
    const next = applyOps(signup, [editor.remove('email')])
    expect(() => assertConsistent(next, {
      facts: [{ id: '1', code: 'required', path: 'email', origin: 'core' }], values: {},
    })).toThrow(InvariantError)
  })

  test('перенос состояния сбрасывает ошибки менявшегося поля', () => {
    const next = applyOps(order, [editor.patch('items.r1.qty', { validators: [v.minValue(5)] })])
    const moved = reconcile(next, order, {
      values: { 'items.r1.qty': 3 },
      facts: [{ id: '1', code: 'minValue', path: 'items.r1.qty', origin: 'core' }],
      dirty: {}, touched: {},
    })
    expect(moved.facts).toHaveLength(0)
    expect(moved.values['items.r1.qty']).toBe(3)
  })
})

suite('поля из рантайма', () => {
  test('функции в спецификации запрещены', () => {
    const r = compileFieldSpec({ name: 'x', input: 'text', label: 'X', validate: () => null } as never)
    expect(r.ok).toBe(false)
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

suite('устаревание и продолжение', () => {
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

  test('продолжение адресовано: чужое не применяется', () => {
    const c = makeContinuation({
      formId: 'signup', instance: 'signup:new', revision: 1, submissionId: SUB,
      rowKeys: [], values: {},
    })
    expect(addressedTo(c, { formId: 'signup', instance: 'signup:new' })).toBe(true)
    expect(addressedTo(c, { formId: 'signup', instance: 'signup:edit-1' })).toBe(false)
  })

  test('срок жизни соблюдается', () => {
    const c = makeContinuation({
      formId: 'f', instance: 'f:new', revision: 1, submissionId: SUB, rowKeys: [], values: {},
    }, 1000, 500)
    expect(addressedTo(c, { formId: 'f', instance: 'f:new' }, 1400)).toBe(true)
    expect(addressedTo(c, { formId: 'f', instance: 'f:new' }, 1600)).toBe(false)
  })

  test('деградация не отбрасывает ошибки', () => {
    const errors: FormError[] = Array.from({ length: 10 }, (_, i) =>
      ({ id: `e${i}`, code: 'required', message: 'Обязательное поле', path: `f${i}`, origin: 'core' }))
    const result = { v: 1, formId: 'f', instance: 'f:new', submissionId: SUB, ok: false,
                     status: 422, outcome: 'not-applied', errors, values: {}, revision: 1,
                     from: 'action' } as Result
    const big = makeContinuation({
      formId: 'f', instance: 'f:new', revision: 1, submissionId: SUB, rowKeys: [],
      values: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`f${i}`, 'x'.repeat(300)])),
      result,
    })
    const d = degrade(big, { maxBytes: 1200 })
    expect(d.level).toBeGreaterThan(0)
    expect(d.continuation.result!.errors).toHaveLength(10)
  })
})

suite('исход и файлы', () => {
  const base = { v: 1, formId: 'f', instance: 'f:new', submissionId: SUB, ok: true,
                 status: 200, errors: [], values: {}, revision: 1, from: 'fetch' } as Result

  test('queued без протокола — ошибка разработки', () => {
    expect(() => assertQueuedProtocol({ ...base, outcome: 'queued' }))
      .toThrow(QueuedWithoutProtocolError)
    expect(() => assertQueuedProtocol({
      ...base, outcome: 'queued', data: { pollUrl: '/p', statusUrl: '/s' },
    })).not.toThrow()
  })

  test('режим reference без возможности загрузки деградирует', () => {
    const s = { mode: 'reference' as const, maxBytes: 1, endpoint: '/u' }
    expect(effectiveMode(s, true)).toBe('reference')
    expect(effectiveMode(s, false)).toBe('inline')
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
