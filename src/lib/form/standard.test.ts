// Поле формы как Standard Schema / Standard JSON Schema и метка проверки на сервере.
import { describe as suite, expect, test } from 'vitest'
import { buildEnvelope, check, defineForm, field, fieldSchema, readProof, v, VALIDATED_PROOF } from './index'
import { createFormHandler, type ExecuteContext } from './server'

const form = defineForm({
  id: 'post',
  fields: {
    title: field.text({ validate: [v.required(), v.minLength(3), v.maxLength(120)] }),
    again: field.text({ validate: [v.sameAs('title'), v.maxLength(10)] }),
    age: field.number({ validate: [v.integer(), v.minValue(18), v.maxValue(120, true)] }),
    price: field.number({ validate: [v.minValue(0, true), v.step(0.5)] }),
    kind: field.select({ options: ['a', 'b'], validate: [v.oneOf(['a', 'b'])] }),
    tags: field.multiselect({ validate: [v.required(), v.maxCount(3), v.oneOf(['x', 'y', 'z'])] }),
    agree: field.checkbox({ validate: [v.required()] }),
    day: field.date({}),
    nick: field.text({ validate: [check('nick-free'), v.minLength(2).message('Ник: от {min} знаков')] }),
    file: field.file({}),
  },
})

suite('fieldSchema: проверка одного значения', () => {
  test('тот же объект на каждый вызов — по нему lib/db сверяет метку', () => {
    expect(fieldSchema(form, 'title')).toBe(fieldSchema(form, 'title'))
    expect(fieldSchema(form, 'title')).not.toBe(fieldSchema(form, 'again'))
    expect(() => fieldSchema(form, 'nope')).toThrow(/не объявлено/)
  })

  test('правила поля дают issues с путём, кодом, параметрами и текстом из словаря', () => {
    const s = fieldSchema(form, 'title')['~standard']
    expect(s.validate('Заметка')).toEqual({ value: 'Заметка' })
    expect(s.validate('ab')).toEqual({
      issues: [{ message: 'Минимум 3 символов', path: ['title'], code: 'minLength', params: { min: 3, actual: 2 } }],
    })
    expect(s.validate('').issues?.map((i) => i.code)).toEqual(['required'])
    expect(s.validate(42).issues?.map((i) => i.code)).toEqual(['invalid'])
  })

  test('межполевое и асинхронное правило пропускаются: по одному значению их не решить', () => {
    expect(fieldSchema(form, 'again')['~standard'].validate('другое')).toEqual({ value: 'другое' })
    expect(fieldSchema(form, 'again')['~standard'].validate('очень длинное').issues?.map((i) => i.code)).toEqual(['maxLength'])
    const nick = fieldSchema(form, 'nick')['~standard'].validate('a')
    expect(nick.issues).toEqual([{
      message: 'Ник: от 2 знаков', path: ['nick'], code: 'minLength', params: { min: 2, actual: 1 }, template: 'Ник: от {min} знаков',
    }])
  })

  test('тип значения встроенных видов проверяется до правил', () => {
    expect(fieldSchema(form, 'age')['~standard'].validate('18').issues?.[0]?.code).toBe('invalid')
    expect(fieldSchema(form, 'age')['~standard'].validate(null)).toEqual({ value: null })
    expect(fieldSchema(form, 'tags')['~standard'].validate(['x', 1]).issues?.[0]?.code).toBe('invalid')
    expect(fieldSchema(form, 'agree')['~standard'].validate('on').issues?.[0]?.code).toBe('invalid')
  })
})

suite('fieldSchema: JSON Schema из ограничений', () => {
  const json = (name: string) => fieldSchema(form, name)['~standard'].jsonSchema.input({ target: 'draft-2020-12' })

  test('строка, число, выбор, список, флажок, дата', () => {
    expect(json('title')).toEqual({ type: 'string', minLength: 3, maxLength: 120 })
    expect(json('age')).toEqual({ type: ['integer', 'null'], minimum: 18, exclusiveMaximum: 120 })
    expect(json('price')).toEqual({ type: ['number', 'null'], exclusiveMinimum: 0, multipleOf: 0.5 })
    expect(json('kind')).toEqual({ type: ['string', 'null'], enum: ['a', 'b', null] })
    expect(json('tags')).toEqual({ type: 'array', items: { type: 'string', enum: ['x', 'y', 'z'] }, minItems: 1, maxItems: 3 })
    expect(json('agree')).toEqual({ type: 'boolean', const: true })
    expect(json('day')).toEqual({ type: ['string', 'null'], format: 'date' })
    // межполевое правило в JSON Schema не попадает, своё — попадает
    expect(json('again')).toEqual({ type: 'string', maxLength: 10 })
  })

  test('draft-07 — то же; неизвестная цель и неописуемый вид — исключение (так велит стандарт)', () => {
    const s = fieldSchema(form, 'title')['~standard'].jsonSchema
    expect(s.input({ target: 'draft-07' })).toEqual(json('title'))
    expect(s.output({ target: 'draft-2020-12' })).toEqual(json('title'))
    expect(() => s.input({ target: 'openapi-3.0' })).toThrow(/не поддерживается/)
    expect(() => json('file')).toThrow(/не описывается/)
  })
})

suite('метка проверки (договорённость с lib/db: src/lib/db/test/db-rules.test.ts)', () => {
  test('ключ Symbol.for(\'modals-kit.validated-proof.v1\'), форма { fields: { поле: { schema, value } } }', () => {
    expect(VALIDATED_PROOF).toBe(Symbol.for('modals-kit.validated-proof.v1'))
    const fixture = Object.defineProperty({ title: 'abc' }, Symbol.for('modals-kit.validated-proof.v1'), {
      value: { fields: { title: { schema: fieldSchema(form, 'title'), value: 'abc' } } },
    })
    expect(readProof(fixture)?.fields['title']?.schema).toBe(fieldSchema(form, 'title'))
    expect(readProof({ ...fixture })).toBeUndefined()
  })

  const post = (d: typeof form, entries: Record<string, string>, intent?: string) =>
    new Request('http://x/form', {
      method: 'POST',
      body: new URLSearchParams({
        ...buildEnvelope({ formId: d.id, revision: d.revision, instance: `${d.id}:new`, submissionId: crypto.randomUUID() }, d.policy),
        ...(intent ? { intent } : {}),
        ...entries,
      }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })
  const seenBy = (d: ReturnType<typeof defineForm>) => {
    let seen: ExecuteContext | undefined
    const h = createFormHandler({ description: d, execute: (c) => { seen = c; c.commit(); return {} } })
    return { h, get: () => seen! }
  }
  const small = defineForm({
    id: 'small',
    actions: [{ id: 'submit', validate: 'full' }, { id: 'draft', validate: 'partial', relax: ['required'] }],
    fields: {
      title: field.text({ validate: [v.required(), v.minLength(3)] }),
      extra: field.text({ visibleWhen: { field: 'title', equals: 'с дополнением' } }),
    },
  })

  test('полная проверка — метка на видимых полях: та же схема, то же значение; в JSON её нет', async () => {
    const { h, get } = seenBy(small)
    const r = await h(post(small, { title: 'Заметка', extra: 'скрыто' }))
    expect(r.result.ok).toBe(true)
    const proof = readProof(get().values)!
    expect(Object.keys(proof.fields)).toEqual(['title'])
    expect(proof.fields['title']).toEqual({ schema: fieldSchema(small, 'title'), value: 'Заметка' })
    expect(Object.keys(get().values)).not.toContain(String(VALIDATED_PROOF))
    expect(JSON.stringify(get().values)).not.toContain('schema')
  })

  test('действие со снятыми правилами (черновик) метку не ставит', async () => {
    const { h, get } = seenBy(small)
    await h(post(small, { title: '' }, 'draft'))
    expect(readProof(get().values)).toBeUndefined()
  })
})
