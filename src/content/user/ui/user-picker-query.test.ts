// Разбор адреса пикера: мусор, предел и шаг. Чистые функции — без SvelteKit.
import { describe, expect, test } from 'vitest'
import { parsePickedIds, parsePickerStep, USER_PICKER_IDS_MAX } from './user-picker-query.js'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

describe('parsePickedIds: набор из адреса', () => {
  test('мусор отброшен, повторы схлопнуты, регистр приведён', () => {
    expect(parsePickedIds(`мусор,${A.toUpperCase()},,${A.toUpperCase()}, ${B}`)).toEqual([A, B])
    expect(parsePickedIds('')).toEqual([])
  })

  test('нет параметра — fallback; пустой параметр — пустой выбор', () => {
    expect(parsePickedIds(null, [A])).toEqual([A])
    expect(parsePickedIds(undefined, [A])).toEqual([A])
    // Негативный контроль: `?picked=` — это явный пустой набор, а не «не задан».
    expect(parsePickedIds('', [A])).toEqual([])
  })

  test('предел набора: 600 id дают 500', () => {
    const ids = Array.from({ length: 600 }, (_, i) =>
      `33333333-3333-4333-8333-${String(i).padStart(12, '0')}`,
    )
    expect(parsePickedIds(ids.join(','))).toHaveLength(USER_PICKER_IDS_MAX)
    expect(USER_PICKER_IDS_MAX).toBe(500)
  })

  test('не-UUID не проходит даже один в один', () => {
    // `a`-`f` — шестнадцатеричные, строка формы UUID валидна; мусор — вне алфавита.
    expect(parsePickedIds('gggggggg-bbbb-cccc-dddd-eeeeeeeeeeee')).toEqual([])
    expect(parsePickedIds('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toHaveLength(1)
    expect(parsePickedIds(A.slice(0, 35))).toEqual([])
    expect(parsePickedIds(`${A},../../etc/passwd`)).toEqual([A])
  })
})

describe('parsePickerStep: шаг из адреса', () => {
  test('известные шаги проходят, мусор и пустота — pick', () => {
    expect(parsePickerStep('chosen')).toBe('chosen')
    expect(parsePickerStep('CHOSEN')).toBe('chosen')
    expect(parsePickerStep('bogus')).toBe('pick')
    expect(parsePickerStep('')).toBe('pick')
    expect(parsePickerStep(null)).toBe('pick')
    expect(parsePickerStep(undefined)).toBe('pick')
  })
})
