import { describe as suite, expect, test } from 'vitest'
import { defineForm, validateForm } from './index'
import { defineFieldKit, type KitField } from './kit'

const kit = defineFieldKit({
  limits: { fields: 4 },
  rules: {
    required: {},
    integer: {},
    pattern: {},
    maxLength: { min: 1, max: 5000, default: 500 },
    minLength: { min: 0, max: 5000 },
    minValue: { min: -1000, max: 1000 },
    maxValue: { min: -1000, max: 1000 },
  },
  kinds: {
    textarea: { input: 'textarea', extra: ['required', 'minLength', 'maxLength'] },
    email: { input: 'email', locked: ['email'], extra: ['required', 'maxLength', 'pattern'], rules: { maxLength: { max: 254 } } },
    url: { input: 'url', locked: ['url'], extra: ['required', 'maxLength'], rules: { maxLength: { max: 2000 } } },
    tel: { input: 'tel', locked: [{ rule: 'pattern', arg: 'e164' }], extra: ['required'] },
    number: { input: 'number', extra: ['required', 'minValue', 'maxValue', 'integer'] },
  },
})

const errorsOf = (list: KitField[], values: Record<string, unknown>) => {
  const r = kit.compile(list)
  if (!r.ok) throw new Error(JSON.stringify(r.defects))
  return validateForm(defineForm({ id: 'record', from: r.specs, fields: {} }), values, { cardinality: 'all' }).map((e) => `${e.path}:${e.code}`)
}

suite('defineFieldKit: схема валидаторов с пределами', () => {
  test('длины нет — ставится значение по умолчанию; нелепая длина — потолок вида', () => {
    const r = kit.compile([
      { name: 'about', kind: 'textarea', label: 'Описание' },
      { name: 'link', kind: 'url', label: 'Ссылка', rules: [{ rule: 'required' }, { rule: 'maxLength', arg: 9_999_999 }] },
      { name: 'mail', kind: 'email', label: 'Почта' },
    ])
    expect(r.ok).toBe(true)
    expect(r.changes).toEqual([
      { field: 'about', rule: 'maxLength', code: 'added', to: 500 },
      { field: 'link', rule: 'maxLength', code: 'clamped', from: 9_999_999, to: 2000 },
      // вид сузил max до 254 — и значение по умолчанию вместе с ним
      { field: 'mail', rule: 'maxLength', code: 'added', to: 254 },
    ])
    if (!r.ok) return
    expect(r.specs.find((s) => s.name === 'mail')!.rules).toEqual([{ rule: 'email' }, { rule: 'maxLength', arg: 254 }])
  })

  test('правило вида нельзя снять: почта проверяется всегда, выбор только расширяет', () => {
    const r = kit.compile([{ name: 'mail', kind: 'email', label: 'Почта', rules: [{ rule: 'email' }, { rule: 'pattern', arg: 'slug' }] }])
    expect(r.ok && r.specs[0]!.rules).toEqual([{ rule: 'email' }, { rule: 'pattern', arg: 'slug' }, { rule: 'maxLength', arg: 254 }])
    expect(errorsOf([{ name: 'mail', kind: 'email', label: 'Почта' }], { u_mail: 'abc' })).toEqual(['u_mail:email'])
    expect(errorsOf([{ name: 'phone', kind: 'tel', label: 'Телефон' }], { u_phone: '12' })).toEqual(['u_phone:pattern'])
  })

  test('отрицательное число — обычное значение; вне пределов — ближайшая граница', () => {
    const r = kit.compile([{ name: 'n', kind: 'number', label: 'Число', rules: [{ rule: 'minValue', arg: -50 }, { rule: 'maxValue', arg: 1e9 }] }])
    expect(r.ok && r.specs[0]!.rules).toEqual([{ rule: 'minValue', arg: -50 }, { rule: 'maxValue', arg: 1000 }])
    expect(r.changes).toEqual([{ field: 'n', rule: 'maxValue', code: 'clamped', from: 1e9, to: 1000 }])
    expect(errorsOf([{ name: 'n', kind: 'number', label: 'Число', rules: [{ rule: 'minValue', arg: -5 }] }], { u_n: -6 })).toEqual(['u_n:minValue'])
  })

  test('обязательность и длина действуют на значениях', () => {
    const list: KitField[] = [{ name: 'about', kind: 'textarea', label: 'О', rules: [{ rule: 'required' }] }]
    expect(errorsOf(list, { u_about: '' })).toEqual(['u_about:required'])
    expect(errorsOf(list, { u_about: 'x'.repeat(501) })).toEqual(['u_about:maxLength'])
    expect(errorsOf(list, { u_about: 'текст' })).toEqual([])
  })

  test('правило без значения: есть default — берётся оно, нет — дефект', () => {
    const r = kit.compile([{ name: 'a', kind: 'textarea', label: 'А', rules: [{ rule: 'maxLength' }] }])
    expect(r.changes).toEqual([{ field: 'a', rule: 'maxLength', code: 'defaulted', to: 500 }])
    const bad = kit.compile([{ name: 'n', kind: 'number', label: 'Ч', rules: [{ rule: 'minValue' }] }])
    expect(!bad.ok && bad.defects.map((d) => d.code)).toEqual(['kit.arg-missing'])
  })

  test('чужое правило, неизвестный вид, повтор, не число, лишние поля — отказ', () => {
    const r = kit.compile([
      { name: 'n', kind: 'number', label: 'Ч', rules: [{ rule: 'email' }] },
      { name: 'z', kind: 'script', label: 'Z' },
      { name: 'a', kind: 'textarea', label: 'А', rules: [{ rule: 'required' }, { rule: 'required' }] },
      { name: 'b', kind: 'textarea', label: 'Б', rules: [{ rule: 'maxLength', arg: '10' as never }] },
    ])
    expect(!r.ok && r.defects.map((d) => `${d.field}:${d.code}`)).toEqual([
      'n:kit.rule-not-allowed', 'z:kit.unknown-kind', 'a:kit.rule-duplicate', 'b:kit.arg-type',
    ])
    const many = kit.compile(Array.from({ length: 5 }, (_, i) => ({ name: `f${i}`, kind: 'textarea', label: 'П' })))
    expect(!many.ok && many.defects[0]).toMatchObject({ code: 'kit.too-many-fields', params: { count: 5, max: 4 } })
    expect(kit.compile('x').ok).toBe(false)
  })

  test('конфликт границ после замены — дефект у своего поля', () => {
    const r = kit.compile([{ name: 'a', kind: 'textarea', label: 'А', rules: [{ rule: 'minLength', arg: 900 }, { rule: 'maxLength', arg: 10 }] }])
    expect(!r.ok && r.defects[0]).toMatchObject({ code: 'kit.spec', field: 'a' })
  })

  test('нет ключа, null, false, \'\' — предела нет', () => {
    const free = defineFieldKit({
      limits: { fields: null },
      rules: { maxLength: { min: false, max: '', default: undefined } },
      kinds: { text: { input: 'text', extra: ['maxLength'] } },
    })
    const r = free.compile([
      { name: 'a', kind: 'text', label: 'А' },
      { name: 'b', kind: 'text', label: 'Б', rules: [{ rule: 'maxLength', arg: 9_999_999 }] },
    ])
    expect(r.changes).toEqual([])
    expect(r.ok && r.specs.map((s) => s.rules)).toEqual([[], [{ rule: 'maxLength', arg: 9_999_999 }]])
    expect(free.rulesFor('text')).toEqual({ locked: [], extra: ['maxLength'], limits: {} })
  })

  test('rulesFor: правила вида, выбор и действующие пределы', () => {
    expect(kit.rulesFor('email')).toEqual({
      locked: [{ rule: 'email' }],
      extra: ['required', 'maxLength', 'pattern'],
      limits: { maxLength: { min: 1, max: 254, default: 254 } },
    })
    expect(kit.rulesFor('nope')).toBeUndefined()
    expect(kit.kinds).toEqual(['textarea', 'email', 'url', 'tel', 'number'])
  })

  test('неверная настройка падает сразу', () => {
    const make = (o: object) => () => defineFieldKit({ rules: {}, kinds: {}, ...o } as never)
    expect(make({ rules: { nope: {} } })).toThrow(/не зарегистрировано/)
    expect(make({ rules: { maxLength: { min: 10, max: 5 } } })).toThrow(/больше max/)
    expect(make({ rules: { maxLength: { max: Number.NaN } } })).toThrow(/число/)
    expect(make({ kinds: { t: { input: 'text', extra: ['maxLength'] } } })).toThrow(/нет в схеме/)
    expect(make({ rules: { maxLength: { max: 10 } }, kinds: { t: { input: 'text', extra: ['maxLength'], rules: { maxLength: { min: 20 } } } } })).toThrow(/больше max/)
  })
})
