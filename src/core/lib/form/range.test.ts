// Межполевые границы: notAbove / notBelow / noOverlap — тот же путь evaluate, что у сервера.
import { describe, expect, test } from 'vitest'
import { defineForm, en, evaluate, field, makeRenderer, v } from './index'

const render = makeRenderer([en])
const check = (d: ReturnType<typeof defineForm>, entries: [string, string][]) => {
  const fd = new FormData()
  for (const [k, val] of entries) fd.append(k, val)
  return evaluate(fd, d, { render, requireEnvelope: false }).errors
}

describe('notAbove / notBelow', () => {
  const years = defineForm({
    id: 'years',
    fields: {
      from: field.number({ validate: [v.notAbove('to')] }),
      to: field.number({ validate: [v.notBelow('from')] }),
    },
  })

  test('перевёрнутый диапазон — ошибка у обеих границ, с текстом и значением соседа', () => {
    const errors = check(years, [['from', '2010'], ['to', '2001']])
    expect(errors.map((e) => [e.path, e.code])).toEqual([['from', 'notAbove'], ['to', 'notBelow']])
    expect(errors[0]!.message).toBe('Must not exceed upper bound (2001)')
    expect(errors[1]!.message).toBe('Must not be below lower bound (2010)')
  })

  test('равные границы и открытый диапазон — не ошибка', () => {
    expect(check(years, [['from', '2005'], ['to', '2005']])).toEqual([])
    expect(check(years, [['from', '2005']])).toEqual([])
    expect(check(years, [['to', '2005']])).toEqual([])
  })

  test('ISO-даты сравниваются по порядку', () => {
    const d = defineForm({ id: 'd', fields: { a: field.date({ validate: [v.notAbove('b')] }), b: field.date() } })
    expect(check(d, [['a', '2024-05-02'], ['b', '2024-05-01']])[0]!.code).toBe('notAbove')
    expect(check(d, [['a', '2024-04-30'], ['b', '2024-05-01']])).toEqual([])
  })

  test('именованная ссылка из реестра работает так же, атрибута нет', () => {
    const d = defineForm({ id: 'n', fields: { a: field.number({ validate: [{ name: 'notAbove', arg: 'b' }] }), b: field.number() } })
    expect(check(d, [['a', '3'], ['b', '1']])[0]!.code).toBe('notAbove')
    expect(d.attrsOf('a').attrs['max']).toBeUndefined()
    expect(d.attrsOf('a').skipped[0]!.kind).toBe('opaque')
  })
})

describe('noOverlap', () => {
  const genres = defineForm({
    id: 'genres',
    fields: {
      all: field.multiselect({ options: ['a', 'b', 'c'] }),
      none: field.multiselect({ options: ['a', 'b', 'c'], validate: [v.noOverlap('all')] }),
    },
  })

  test('общее значение — ошибка у поля с правилом, общие значения в параметрах', () => {
    const errors = check(genres, [['all', 'a'], ['all', 'b'], ['none', 'b']])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ path: 'none', code: 'noOverlap', params: { values: ['b'], count: 1 } })
    expect(errors[0]!.message).toBe('This value overlaps with the related field')
  })

  test('без пересечения или с пустой стороной — не ошибка', () => {
    expect(check(genres, [['all', 'a'], ['none', 'b']])).toEqual([])
    expect(check(genres, [['none', 'b']])).toEqual([])
  })

  test('несколько общих значений — текст во множественном числе', () => {
    const errors = check(genres, [['all', 'a'], ['all', 'b'], ['none', 'a'], ['none', 'b']])
    expect(errors[0]!.message).toBe('These values overlap with the related field')
  })
})
