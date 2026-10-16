// Набор полей от пользователя как поле формы: `field.fields` и `defineForm({ from })`.
import { describe as suite, expect, test } from 'vitest'
import {
  buildEnvelope, decode, defineForm, encode, field, fieldSetName, FormDefinitionError, v, validateForm,
  type FieldSetItem,
} from './index'
import { createFormHandler } from './server'
import { FIELD_SET_ADD, FIELD_SET_REMOVE, fieldSetDraft, fieldSetItems, fieldSetKey, fieldSetOp, fieldSetRules } from './field-set'

const props = () => field.fields({
  label: 'Поля записи', max: 3,
  rules: {
    required: {},
    maxLength: { min: 1, max: 2000, default: 200 },
    minValue: { min: -1000, max: 1000 },
  },
  kinds: {
    text: { label: 'Строка', input: 'text', extra: ['required', 'maxLength'] },
    email: { label: 'Почта', input: 'email', locked: ['email'], extra: ['required'] },
    number: { label: 'Число', input: 'number', extra: ['required', 'minValue'] },
  },
})

const collection = defineForm({
  id: 'collection',
  fields: { title: field.text({ label: 'Название', validate: [v.required()] }), props: props() },
})

const data = (entries: [string, string][]) => {
  const f = new FormData()
  for (const [k, x] of entries) f.append(k, x)
  return f
}

suite('field.fields — поле формы', () => {
  test('стоит в списке полей рядом с обычными, тип и каталог в дескрипторе', () => {
    const f = collection.byName['props']!
    expect(f.kind).toBe('fields')
    expect(f.input).toBe('fields')
    expect(f.fieldSet?.kinds).toEqual(['text', 'email', 'number'])
    expect(f.fieldSet?.labelOf('email')).toBe('Почта')
  })

  test('неверный каталог падает при объявлении', () => {
    expect(() => field.fields({ rules: { nope: {} }, kinds: {} })).toThrow(/не зарегистрировано/)
    expect(() => field.fields({ rules: { maxLength: { min: 5, max: 1 } }, kinds: {} })).toThrow(/больше max/)
  })

  test('разбор: места по порядку появления, пустое название пропускается, значение приведено', () => {
    const { values, structural } = decode(data([
      ['title', 'Книги'],
      ['props.s2.label', 'Автор'], ['props.s2.kind', 'text'],
      ['props.s2.rules', 'maxLength'], ['props.s2.max_length', '99999'],
      ['props.s1.label', ''], ['props.s1.kind', 'text'],
      ['props.s3.label', ' Почта '], ['props.s3.kind', 'email'], ['props.s3.rules', 'required'],
      ['props.s4.label', 'Год'], ['props.s4.kind', 'number'],
    ]), collection)
    expect(structural).toEqual([])
    const list = values['props'] as FieldSetItem[]
    expect(list.map((x) => [x.name, x.preset, x.label])).toEqual([
      ['s2', 'text', 'Автор'], ['s3', 'email', 'Почта'], ['s4', 'number', 'Год'],
    ])
    // вне пределов — заменено на предел; правило вида — внутри значения
    expect(list[0]!.rules).toEqual([{ rule: 'maxLength', arg: 2000 }])
    expect(list[1]!.rules).toEqual([{ rule: 'email' }, { rule: 'required' }])
    expect(list[2]!.input).toBe('number')
  })

  test('правило по умолчанию добавляется, если его не выбрали', () => {
    const { values } = decode(data([['props.a.label', 'Имя'], ['props.a.kind', 'text']]), collection)
    expect((values['props'] as FieldSetItem[])[0]!.rules).toEqual([{ rule: 'maxLength', arg: 200 }])
  })

  test('отказы каталога — ошибки на подпутях места', () => {
    const { structural, values } = decode(data([
      ['props.s1.label', 'А'], ['props.s1.kind', 'number'], ['props.s1.rules', 'maxLength'],
      ['props.s2.label', 'Б'], ['props.s2.kind', 'number'], ['props.s2.rules', 'minValue'], ['props.s2.min_value', 'abc'],
      ['props.s3.label', 'В'], ['props.s3.kind', 'nope'],
    ]), collection)
    // набранное возвращается для показа, но правила к нему не применяются
    expect((values['props'] as FieldSetItem[]).map((x) => x.label)).toEqual(['А', 'Б', 'В'])
    expect(structural.map((s) => `${s.path}|${s.at}|${s.code}`)).toEqual([
      'props|s1.rules|kit.rule-not-allowed',
      'props|s2.min_value|kit.arg-type',
      'props|s3.kind|kit.unknown-kind',
    ])
    const errors = validateForm(collection, values, { structural })
    expect(errors.map((e) => e.path)).toEqual(expect.arrayContaining(['props.s1.rules', 'props.s2.min_value', 'props.s3.kind']))
  })

  test('предел набора — ошибка самого поля', () => {
    const many = ['a', 'b', 'c', 'd'].flatMap((s): [string, string][] => [[`props.${s}.label`, s], [`props.${s}.kind`, 'text']])
    const { structural } = decode(data(many), collection)
    expect(structural).toEqual([{ path: 'props', code: 'kit.too-many-fields', params: { count: 4, max: 3 } }])
  })

  test('повтор одиночной записи и лишний уровень — отказ, а не «взять первое»', () => {
    const { structural } = decode(data([
      ['props.s1.label', 'А'], ['props.s1.label', 'Б'], ['props.s1.kind', 'text'],
      ['props.s2.label', 'В'], ['props.s2.kind', 'text'], ['props.s2.x.y', '1'],
    ]), collection)
    expect(structural.map((s) => `${s.at}|${s.code}`)).toEqual(['s1|kit.field-shape', 's2|kit.field-shape'])
  })

  test('обратный ход: encode → decode даёт то же значение, правила вида не дублируются', () => {
    const { values } = decode(data([
      ['props.s1.label', 'Почта'], ['props.s1.kind', 'email'],
      ['props.s2.label', 'Год'], ['props.s2.kind', 'number'], ['props.s2.rules', 'minValue'], ['props.s2.min_value', '-5'],
    ]), collection)
    const pairs = [...encode(values, collection).entries()].map(([k, x]) => `${k}=${x}`)
    expect(pairs).toEqual(expect.arrayContaining([
      'props.s1.label=Почта', 'props.s1.kind=email', 'props.s2.rules=minValue', 'props.s2.min_value=-5',
    ]))
    expect(pairs).not.toContain('props.s1.rules=email')
    expect(decode(encode(values, collection), collection).values['props']).toEqual(values['props'])
  })

  test('имя записи: значение правила — в snake_case', () => {
    expect(fieldSetName('props', 's1', 'maxLength')).toBe('props.s1.max_length')
    expect(fieldSetName('props', 's1', 'rules')).toBe('props.s1.rules')
  })

  test('сервер принимает записи набора и отвергает чужие ключи', async () => {
    const h = createFormHandler({ description: collection, execute: (c) => { c.commit(); return { data: c.values } } })
    const post = (extra: Record<string, string>) => {
      const env = buildEnvelope({ formId: 'collection', revision: 1, instance: 'collection:new', submissionId: crypto.randomUUID() }, collection.policy)
      return new Request('http://x/f', {
        method: 'POST', body: new URLSearchParams({ ...env, title: 'Книги', ...extra }),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      })
    }
    const ok = await h(post({ 'props.s1.label': 'Автор', 'props.s1.kind': 'text' }))
    expect(ok.status).toBe(200)
    expect((ok.result.data as { props: FieldSetItem[] }).props[0]).toMatchObject({ name: 's1', preset: 'text', label: 'Автор' })
    const bad = await h(post({ 'props.s1.label': 'Автор', 'props.s1.kind': 'text', other: 'x' }))
    expect(bad.result.errors[0]).toMatchObject({ code: 'request.unexpected-field', params: { name: 'other' } })
    const deep = await h(post({ 'props.s1.label': 'А', 'props.s1.kind': 'text', 'props.s1.max_length.x.y': '1' }))
    expect(deep.result.errors[0]).toMatchObject({ code: 'request.unexpected-field' })
  })
})

suite('defineForm({ from }) — сохранённый набор снова форма', () => {
  const saved = decode(data([
    ['props.s1.label', 'Автор'], ['props.s1.kind', 'text'], ['props.s1.rules', 'required'],
    ['props.s2.label', 'Почта'], ['props.s2.kind', 'email'],
  ]), collection).values['props'] as FieldSetItem[]

  test('как есть: поля набора с префиксом, не «новые»', () => {
    const d = defineForm({ id: 'record', from: saved, fields: {} })
    expect(d.fields.map((f) => f.name)).toEqual(['u_s1', 'u_s2'])
    expect(d.fields.every((f) => !f.fresh)).toBe(true)
    expect(d.byName['u_s2']!.input).toBe('email')
  })

  test('расширение: сначала набор, потом поля из кода; правила набора действуют', () => {
    const d = defineForm({
      id: 'record', from: saved,
      fields: { title: field.text({ label: 'Название', validate: [v.required()] }), image: field.file({ label: 'Файл' }) },
    })
    expect(d.fields.map((f) => [f.name, f.order])).toEqual([['u_s1', 0], ['u_s2', 1], ['title', 2], ['image', 3]])
    const { values, structural } = decode(data([['u_s1', ''], ['u_s2', 'not-mail'], ['title', 'x']]), d)
    const codes = validateForm(d, values, { structural }).map((e) => `${e.path}:${e.code}`)
    expect(codes).toContain('u_s1:required')
    expect(codes.some((c) => c.startsWith('u_s2:email'))).toBe(true)
  })

  test('имя из кода совпало с сохранённым — дефект объявления', () => {
    expect(() => defineForm({ id: 'r', from: saved, fields: { u_s1: field.text({ label: 'x' }) } }))
      .toThrow(FormDefinitionError)
  })

  test('испорченный набор — дефект объявления, а не молчаливый пропуск', () => {
    expect(() => defineForm({ id: 'r', from: [{ name: 'x', input: 'text', label: '' }], fields: {} }))
      .toThrow(FormDefinitionError)
  })
})

suite('кнопки набора без JS и ключи мест', () => {
  test('ключ места случайный, по правилам имён, не совпадает с занятыми', () => {
    const keys = new Set<string>()
    for (let i = 0; i < 200; i++) keys.add(fieldSetKey([...keys]))
    expect(keys.size).toBe(200)
    for (const k of keys) expect(k).toMatch(/^f[a-z0-9]{6}$/)
  })

  test('форма с набором сама объявляет действия «добавить» и «удалить»', () => {
    const names = collection.actions.map((a) => a.id)
    expect(names).toContain(FIELD_SET_ADD)
    expect(names).toContain(FIELD_SET_REMOVE)
    const plain = defineForm({ id: 'plain', fields: { title: field.text({ label: 'Т' }) } })
    expect(plain.actions.map((a) => a.id)).not.toContain(FIELD_SET_ADD)
  })

  test('добавить: все места, включая пустые, плюс пустое; удалить: без указанного; предел держится', () => {
    const form = data([['props.fa.label', 'Автор'], ['props.fa.kind', 'text'], ['props.fb.label', '']])
    const add = fieldSetOp(form, collection, `${FIELD_SET_ADD}:props`)!
    expect(add.name).toBe('props')
    expect(add.items.map((x) => x.name).slice(0, 2)).toEqual(['fa', 'fb'])
    expect(add.items).toHaveLength(3)
    expect(add.items[2]).toMatchObject({ preset: 'text', label: '' })
    const rm = fieldSetOp(form, collection, `${FIELD_SET_REMOVE}:props.fa`)!
    expect(rm.items.map((x) => x.name)).toEqual(['fb'])
    const full = data([['props.fa.label', 'А'], ['props.fb.label', 'Б'], ['props.fc.label', 'В']])
    expect(fieldSetOp(full, collection, `${FIELD_SET_ADD}:props`)!.items).toHaveLength(3)
    expect(fieldSetOp(form, collection, 'submit')).toBeUndefined()
    expect(fieldSetOp(form, collection, `${FIELD_SET_ADD}:title`)).toBeUndefined()
  })

  test('сервер на кнопку набора возвращает места и не выполняет', async () => {
    let ran = 0
    const h = createFormHandler({ description: collection, execute: (c) => { ran++; c.commit(); return { data: c.values } } })
    const env = buildEnvelope({ formId: 'collection', revision: 1, instance: 'collection:new', submissionId: crypto.randomUUID() },
      collection.policy)
    const r = await h(new Request('http://x/f', {
      method: 'POST', body: new URLSearchParams({ ...env, [collection.policy.envelopeKeys.intent]: `${FIELD_SET_ADD}:props`, title: '', 'props.fa.label': 'Автор', 'props.fa.kind': 'text' }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    }))
    expect(ran).toBe(0)
    expect(r.status).toBe(200)
    expect(r.result).toMatchObject({ ok: true, outcome: 'not-applied' })
    expect((r.result.values as { props: FieldSetItem[] }).props).toHaveLength(2)
  })

  test('form.from: у полей набора есть исходное поле схемы', () => {
    const saved: FieldSetItem[] = [{ name: 'fa', preset: 'email', input: 'email', label: 'Почта' }]
    const d = defineForm({ id: 'rec', from: saved, fields: {} })
    expect(d.fields[0]!.spec).toMatchObject({ name: 'fa', preset: 'email', label: 'Почта' })
  })
})

suite('места для разметки', () => {
  const kit = collection.byName['props']!.fieldSet!
  test('место из поля: правила вида не в выбранных, числа строками; обратно — только с названием', () => {
    const d = fieldSetDraft(kit, { name: 'fa', preset: 'email', input: 'email', label: 'Почта',
      rules: [{ rule: 'email' }, { rule: 'required' }] })
    expect(d).toEqual({ key: 'fa', preset: 'email', label: 'Почта', rules: ['required'], args: {} })
    const t = fieldSetDraft(kit, { name: 'fb', preset: 'text', input: 'text', label: 'А', rules: [{ rule: 'maxLength', arg: 50 }] })
    expect(t.args).toEqual({ maxLength: '50' })
    expect(fieldSetItems(kit, [t, { ...t, key: 'fc', label: '  ' }])).toEqual([
      { name: 'fb', preset: 'text', label: 'А', input: 'text', rules: [{ rule: 'maxLength', arg: 50 }] }])
  })
  test('правила места: на выбор разрешённые виду и уже выбранные, числа — у правил с пределами', () => {
    const r = fieldSetRules(kit, { key: 'fa', preset: 'text', label: 'А', rules: ['maxLength', 'minValue'], args: {} })
    expect(r.choices).toEqual(['required', 'maxLength', 'minValue'])
    // у вида «Строка» пределов `minValue` нет: правило выбрано, но числа ему не положено
    expect(r.withArgs.map((a) => a.rule)).toEqual(['maxLength'])
    expect(r.withArgs[0]!.default).toBe(200)
  })
})
