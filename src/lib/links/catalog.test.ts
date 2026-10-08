/**
 * Словарь связок фильтра. Паритет с движком схемы (`lib/filters/rules.ts` +
 * `view.ts`) обязателен: слой приходит на смену живому движку (этап 5) и уже
 * сегодня обязан отвечать РОВНО то же — проверка табличная, на одних данных.
 */
import { describe, expect, it } from 'vitest'
import { catalogFilterFieldStates } from '$lib/filters/view'
import { catalogFilterValueMap, checkCatalogFilterRules } from '$lib/filters/rules'
import type { CatalogFilterSchema } from '$lib/filters/catalog-filter'
import { catalogFilterFieldNames } from '$lib/filters/catalog-filter'
import { catalogLinkOutcome, catalogLinkRules, catalogLinkSet, catalogLinkValues } from './catalog'
import { linkHelperText, linkRefusalText } from './links'

const schema: CatalogFilterSchema = {
  source: 'parity',
  version: 1,
  builtAt: '2026-10-08T10:00:00.000Z',
  fields: [
    {
      key: 'genres',
      label: 'Жанры',
      type: 'multiselect',
      modes: ['and', 'not'],
      options: [
        { value: '1', label: 'Экшен' },
        { value: '2', label: 'Драма' },
        { value: '133', label: 'Комедия' },
      ],
    },
    { key: 'kind', label: 'Тип', type: 'select', options: [{ value: 'tv', label: 'ТВ' }] },
    {
      key: 'status',
      label: 'Статус',
      type: 'select',
      options: [
        { value: 'latest', label: 'последние' },
        { value: 'anons', label: 'анонс' },
      ],
    },
    { key: 'score', label: 'Оценка', type: 'number', bounds: ['min'], min: 1, max: 10 },
  ],
  rules: [
    { id: 'search-with-latest', when: [{ field: 'status', value: 'latest' }], drop: 'q', reason: 'поиск не работает' },
    { id: 'score-with-anons', when: [{ field: 'status', value: 'anons' }], drop: { field: 'score' }, reason: 'у анонсов нет оценки' },
    {
      id: 'score-with-genres-kind',
      when: [{ field: 'genres' }, { field: 'kind', value: 'tv' }],
      drop: { field: 'score' },
      reason: 'с жанрами при ТВ не фильтруем',
    },
  ],
}

const label = (field: string): string => schema.fields.find((f) => f.key === field)?.label ?? field

/** Таблица «значения extra → что гасим»: движок схемы против словаря. */
const CASES: Record<string, unknown>[] = [
  {},
  { 'filters.status': 'latest' },
  { 'filters.status': 'anons', 'filters.score.min': '7' },
  { 'filters.genres.and': '1,2', 'filters.kind': 'tv' },
  { 'filters.genres.and': '1', 'filters.kind': 'tv', 'filters.status': 'anons' },
  { 'filters.kind': 'tv' },
  { 'filters.q': 'что-то', 'unknown.field': 'мусор' },
]

describe('паритет: словарь связок ≡ движок схемы', () => {
  it('гасит те же поля с теми же строками под полем', () => {
    for (const extra of CASES) {
      const viewStates = catalogFilterFieldStates(schema, extra)
      const expected = new Map(
        viewStates.filter((s) => s.disabled).map((s) => [s.key, s.reason!]),
      )
      const map = catalogFilterValueMap(extra)
      const outcome = catalogLinkOutcome(schema, map)
      // Ровно та же логика выбора реплики, что у view: у заполненной жертвы
      // под полем стоит ОТКАЗ набора, у пустой — helper блокировки.
      const got = new Map(
        [...outcome.fields].map(([key, firing]) => {
          const field = schema.fields.find((f) => f.key === key)!
          const filled = catalogFilterFieldNames(field).some((name) => (map[name]?.length ?? 0) > 0)
          return [key, filled
            ? linkRefusalText(key, firing.blockers, label)
            : linkHelperText(firing, label)]
        }),
      )
      expect(got, JSON.stringify(extra)).toEqual(expected)
    }
  })

  it('связка «поиск запрещён» остаётся вне связок ядра (q — не фильтр)', () => {
    const map = catalogFilterValueMap({ 'filters.status': 'latest' })
    expect(catalogLinkRules(schema, map).some((rule) => rule.id === 'search-with-latest')).toBe(false)
    // …но канал схемы её видит: расхождение недопустимо
    expect(checkCatalogFilterRules(schema, map).map((v) => v.id)).toContain('search-with-latest')
  })

  it('чужие и ненастроенные ключи extra не двигают расчёт', () => {
    const outcome = catalogLinkOutcome(schema, catalogFilterValueMap({ 'filters.q': 'x', 'junk': 'y' }))
    expect(outcome.firings).toHaveLength(0)
  })
})

describe('противоречие режимов: значение гаснет в обоих списках', () => {
  const extra = { 'filters.genres.and': '1,133', 'filters.genres.not': '133' }
  const map = catalogFilterValueMap(extra)

  it('синтезированное правило — на общее значение, тексты с подписью источника', () => {
    const rules = catalogLinkRules(schema, map).filter((r) => r.id === 'contradictory-modes')
    expect(rules).toHaveLength(1)
    expect(rules[0]?.reason).toBe('«Комедия» выбрано и в «все из», и в «кроме» — выдача будет пустой')
    expect(rules[0]?.effect).toEqual({ kind: 'disable-option', field: 'genres', value: '133' })
  })

  it('поле свободно, значение выключено; набор без него, выбор формы цел', () => {
    const outcome = catalogLinkOutcome(schema, map)
    expect(outcome.fields.size).toBe(0)
    expect([...(outcome.options.get('genres') ?? [])]).toEqual(['133'])
    const set = catalogLinkSet(schema, map, outcome)
    expect(set['filters.genres.and']).toEqual(['1'])
    expect('filters.genres.not' in set).toBe(false)
    // форма не тронута: снял блокирующего — значение вернулось само
    expect(map['filters.genres.not']).toEqual(['133'])
  })

  it('без пересечения — тишина', () => {
    const clean = catalogFilterValueMap({ 'filters.genres.and': '1', 'filters.genres.not': '2' })
    expect(catalogLinkOutcome(schema, clean).options.size).toBe(0)
  })
})

describe('чтение идентификаторов словаря', () => {
  const map = catalogFilterValueMap({ 'filters.score.min': '7', 'filters.genres.and': '1' })
  const read = catalogLinkValues(schema, map)

  it('ключ поля — union его путей; срез — один путь', () => {
    expect(read('score')).toEqual(['7'])
    expect(read('score.min')).toEqual(['7'])
    expect(read('score.max')).toEqual([])
    expect(read('genres')).toEqual(['1'])
    expect(read('genres.and')).toEqual(['1'])
    expect(read('genres.not')).toEqual([])
  })

  it('неизвестный идентификатор — пусто, а не падение', () => {
    expect(read('q')).toEqual([])
    expect(read('nope.and')).toEqual([])
  })
})
