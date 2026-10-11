/**
 * Словарь связок фильтра — единственный движок связок фильтров (C6): живая
 * форма, картина панели и серверная защита спрашивают его. Ожидания —
 * дословно те, что давал прежний движок схемы (`rules.ts` + `view.ts`), чтобы
 * переход не сменил ни одной строки, видимой пользователю.
 */
import { describe, expect, it } from 'vitest'
import type { CatalogFilterSchema } from '#lib/filters/catalog-filter.js'
import { catalogFilterValueMap } from '#lib/filters/catalog-filter.js'
import {
  CATALOG_SEARCH_LINK,
  catalogLinkFieldState,
  catalogLinkOutcome,
  catalogLinkReason,
  catalogLinkRules,
  catalogLinkValues,
  catalogLinkViolations,
} from './catalog'

const schema: CatalogFilterSchema = {
  source: 'links',
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

/** Поле → строка под ним, как её рисует форма. */
function reasons(extra: Record<string, unknown>): Map<string, string> {
  const map = catalogFilterValueMap(extra)
  const outcome = catalogLinkOutcome(schema, map)
  return new Map(
    [...outcome.fields]
      .filter(([key]) => key !== CATALOG_SEARCH_LINK)
      .map(([key, firing]) => [key, catalogLinkReason(schema, map, firing, key)]),
  )
}

describe('поля под связкой: кто гаснет и что написано под ним', () => {
  it('пустая жертва — helper, называющий виновника', () => {
    expect(reasons({ 'filters.status': 'anons' })).toEqual(
      new Map([['score', '«Статус» блокирует поле: у анонсов нет оценки']]),
    )
  })

  it('заполненная жертва — отказ набора (та же реплика, что у валидатора)', () => {
    expect(reasons({ 'filters.status': 'anons', 'filters.score.min': '7' })).toEqual(
      new Map([['score', '«Оценка» невозможно использовать совместно с «Статус»']]),
    )
  })

  it('несколько условий называются все (согласование по числу)', () => {
    expect(reasons({ 'filters.genres.and': '1,2', 'filters.kind': 'tv' })).toEqual(
      new Map([['score', '«Жанры» и «Тип» блокируют поле: с жанрами при ТВ не фильтруем']]),
    )
  })

  it('две связки на одно поле — говорит последняя сработавшая', () => {
    expect(reasons({ 'filters.genres.and': '1', 'filters.kind': 'tv', 'filters.status': 'anons' })).toEqual(
      new Map([['score', '«Жанры» и «Тип» блокируют поле: с жанрами при ТВ не фильтруем']]),
    )
  })

  it('несработавшая связка молчит; чужие ключи extra расчёт не двигают', () => {
    expect(reasons({})).toEqual(new Map())
    expect(reasons({ 'filters.kind': 'tv' })).toEqual(new Map())
    expect(catalogLinkOutcome(schema, catalogFilterValueMap({ 'filters.q': 'x', junk: 'y' })).firings).toHaveLength(0)
  })
})

describe('запрет поиска — тот же расчёт, свой идентификатор', () => {
  it('срабатывает по условию и гасит `#q`, а не поле схемы', () => {
    const outcome = catalogLinkOutcome(schema, catalogFilterValueMap({ 'filters.status': 'latest' }))
    expect(outcome.fields.get(CATALOG_SEARCH_LINK)?.rule).toMatchObject({
      id: 'search-with-latest',
      reason: 'поиск не работает',
    })
    expect([...outcome.fields.keys()]).toEqual([CATALOG_SEARCH_LINK])
  })

  it('не срабатывает при других значениях', () => {
    const outcome = catalogLinkOutcome(schema, catalogFilterValueMap({ 'filters.status': 'anons' }))
    expect(outcome.fields.has(CATALOG_SEARCH_LINK)).toBe(false)
  })

  it('идентификатор поиска не может совпасть с ключом поля схемы', () => {
    expect(/^[a-zA-Z]/.test(CATALOG_SEARCH_LINK)).toBe(false)
  })
})

describe('противоречие режимов: подсказка, а не запрет', () => {
  const map = catalogFilterValueMap({ 'filters.genres.and': '1,133', 'filters.genres.not': '133' })

  it('синтезированное правило — на общее значение, текст с подписью поля и значения', () => {
    const rules = catalogLinkRules(schema, map).filter((r) => r.id === 'contradictory-modes')
    expect(rules).toHaveLength(1)
    expect(rules[0]?.reason).toBe('«Жанры»: «Комедия» выбрано и в «все из», и в «кроме» — выдача будет пустой')
    expect(rules[0]?.effect).toEqual({ kind: 'disable-option', field: 'genres', value: '133' })
  })

  it('поле не гаснет: связка выключает только значение', () => {
    const outcome = catalogLinkOutcome(schema, map)
    expect(outcome.fields.size).toBe(0)
    expect([...(outcome.options.get('genres') ?? [])]).toEqual(['133'])
  })

  it('без пересечения — тишина', () => {
    const clean = catalogFilterValueMap({ 'filters.genres.and': '1', 'filters.genres.not': '2' })
    expect(catalogLinkOutcome(schema, clean).firings).toHaveLength(0)
  })
})

describe('пояснения панели', () => {
  it('правила схемы и противоречия — с каноническими ключами и тем, что снимается', () => {
    const violations = catalogLinkViolations(catalogLinkOutcome(
      schema,
      catalogFilterValueMap({ 'filters.status': 'latest', 'filters.genres.and': '2', 'filters.genres.not': '2' }),
    ))
    expect(violations).toEqual([
      { id: 'search-with-latest', message: 'поиск не работает', keys: ['filters.status=latest'], drop: 'q' },
      {
        id: 'contradictory-modes',
        message: '«Жанры»: «Драма» выбрано и в «все из», и в «кроме» — выдача будет пустой',
        keys: ['filters.genres.and=2', 'filters.genres.not=2'],
      },
    ])
  })

  it('связка без значения в условии — ключ поля без `=`', () => {
    const violations = catalogLinkViolations(catalogLinkOutcome(
      schema,
      catalogFilterValueMap({ 'filters.genres.and': '1', 'filters.kind': 'tv' }),
    ))
    expect(violations).toEqual([{
      id: 'score-with-genres-kind',
      message: 'с жанрами при ТВ не фильтруем',
      keys: ['filters.genres', 'filters.kind=tv'],
      drop: { field: 'score' },
    }])
  })
})

describe('канал fieldState формы фильтров', () => {
  const fieldState = catalogLinkFieldState(schema, 'page.')

  it('гасит все пути поля по ЖИВЫМ значениям формы (адресные имена)', () => {
    const values = { 'page.filters.status': 'anons' }
    expect(fieldState('page.filters.score.min', values)).toEqual({
      disabled: true,
      reason: '«Статус» блокирует поле: у анонсов нет оценки',
    })
    expect(fieldState('page.filters.status', values)).toBeUndefined()
  })

  it('новые значения — новый ответ: разблокировка приходит сама', () => {
    expect(fieldState('page.filters.score.min', { 'page.filters.status': 'anons' })?.disabled).toBe(true)
    expect(fieldState('page.filters.score.min', { 'page.filters.status': 'latest' })).toBeUndefined()
  })

  it('выбор в заблокированном поле — отказ набора под полем', () => {
    expect(fieldState('page.filters.score.min', { 'page.filters.status': 'anons', 'page.filters.score.min': 5 }))
      .toEqual({ disabled: true, reason: '«Оценка» невозможно использовать совместно с «Статус»' })
  })

  it('чужие имена (без префикса, вне filters.*) — молчание', () => {
    const values = { 'page.filters.status': 'anons', 'filters.score.min': '5' }
    expect(fieldState('filters.score.min', values)).toBeUndefined()
    expect(fieldState('page.size', values)).toBeUndefined()
  })

  it('массивы multiselect читаются как списки', () => {
    expect(fieldState('page.filters.score.min', { 'page.filters.genres.and': ['1'], 'page.filters.kind': 'tv' }))
      .toMatchObject({ disabled: true })
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
    expect(read(CATALOG_SEARCH_LINK)).toEqual([])
    expect(read('nope.and')).toEqual([])
  })
})
