/**
 * Связки фильтров: запрет поиска под фильтром, несовместимые фильтры и
 * противоречие режимов «все из» / «кроме» одного поля.
 */
import { describe, expect, it } from 'vitest'
import {
  catalogFilterSearchRule,
  catalogFilterSuppressedFields,
  catalogFilterValueMap,
  checkCatalogFilterRules,
  contradictoryModeViolations,
} from './rules'
import type { CatalogFilterSchema } from './catalog-filter'

const schema: CatalogFilterSchema = {
  source: 'demo',
  version: 1,
  fields: [
    {
      key: 'genres',
      label: 'Жанры',
      type: 'multiselect',
      modes: ['and', 'not'],
      options: [
        { value: '1', label: 'Экшен' },
        { value: '2', label: 'Драма' },
      ],
    },
    { key: 'status', label: 'Статус', type: 'select', options: [{ value: 'latest', label: 'последние' }, { value: 'anons', label: 'анонс' }] },
    { key: 'score', label: 'Оценка', type: 'number', bounds: ['min'] },
  ],
  rules: [
    { id: 'search-with-latest', when: [{ field: 'status', value: 'latest' }], drop: 'q', reason: 'поиск не работает' },
    { id: 'score-with-anons', when: [{ field: 'status', value: 'anons' }], drop: { field: 'score' }, reason: 'у анонсов нет оценки' },
  ],
}

describe('значения для связок', () => {
  it('читаются только `filters.*`, списки разбираются по запятой', () => {
    expect(
      catalogFilterValueMap({ 'filters.genres.and': '1,2', 'filters.status': 'latest', q: 'наруто', 'page.size': '20' }),
    ).toEqual({ 'filters.genres.and': ['1', '2'], 'filters.status': ['latest'] })
  })

  it('пустые и переросшие значения не считаются выбором', () => {
    expect(catalogFilterValueMap({ 'filters.genres.and': ',', 'filters.status': 'x'.repeat(121) })).toEqual({})
  })
})

describe('запрет поиска', () => {
  it('срабатывает, когда условие связки выполнено', () => {
    const rule = catalogFilterSearchRule(schema, catalogFilterValueMap({ 'filters.status': 'latest' }))
    expect(rule?.id).toBe('search-with-latest')
    expect(rule?.reason).toBe('поиск не работает')
  })

  it('не срабатывает при других значениях и без схемы', () => {
    expect(catalogFilterSearchRule(schema, catalogFilterValueMap({ 'filters.status': 'anons' }))).toBeUndefined()
    expect(catalogFilterSearchRule(undefined, catalogFilterValueMap({ 'filters.status': 'latest' }))).toBeUndefined()
  })
})

describe('несовместимые фильтры', () => {
  it('поле из `drop` не применяется, пока выполнено условие', () => {
    const suppressed = catalogFilterSuppressedFields(schema, catalogFilterValueMap({ 'filters.status': 'anons' }))
    expect([...suppressed]).toEqual(['score'])
    expect(catalogFilterSuppressedFields(schema, catalogFilterValueMap({ 'filters.status': 'latest' })).size).toBe(0)
  })
})

describe('противоречие режимов', () => {
  it('одно значение и в «все из», и в «кроме» — подсказка форме', () => {
    const violations = contradictoryModeViolations(
      schema,
      catalogFilterValueMap({ 'filters.genres.and': '1,2', 'filters.genres.not': '2' }),
    )
    expect(violations).toHaveLength(1)
    expect(violations[0]!.keys).toEqual(['filters.genres.and=2', 'filters.genres.not=2'])
    expect(violations[0]!.message).toContain('Драма')
  })

  it('разные значения не противоречат, поле без режима «кроме» не проверяется', () => {
    expect(
      contradictoryModeViolations(schema, catalogFilterValueMap({ 'filters.genres.and': '1', 'filters.genres.not': '2' })),
    ).toEqual([])
  })
})

describe('полная проверка связок', () => {
  it('возвращает и правила схемы, и противоречия режимов с ключами', () => {
    const violations = checkCatalogFilterRules(
      schema,
      catalogFilterValueMap({ 'filters.status': 'latest', 'filters.genres.and': '1', 'filters.genres.not': '1' }),
    )
    expect(violations.map((violation) => violation.id)).toEqual(['search-with-latest', 'contradictory-modes'])
    expect(violations[0]!.keys).toEqual(['filters.status=latest'])
    expect(violations[0]!.drop).toBe('q')
    expect(violations[1]!.drop).toBeUndefined()
  })

  it('без схемы нарушений нет (схема необязательна)', () => {
    expect(checkCatalogFilterRules(undefined, catalogFilterValueMap({ 'filters.genres.and': '1' }))).toEqual([])
  })
})
