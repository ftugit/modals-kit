/**
 * Unit-набор схемы фильтров: валидация схемы, деградация опций, канонический
 * адрес, deny-safe разбор значений и компиляция в определение формы b1.
 *
 * Порт канона проверяется ПОВЕДЕНЧЕСКИ (не строками исходника): имена полей,
 * режимы, дефолты границ и allowlist'ы — то, на что опираются форма и транспорт.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  CATALOG_FILTER_OPTIONS_LIMIT,
  activeCatalogFilters,
  canonicalCatalogFilterUrl,
  capCatalogFilterOptions,
  catalogFilterFieldNames,
  catalogFilterFormData,
  catalogFilterInitialState,
  catalogFilterOptionsAreComplete,
  catalogFilterUrlWithout,
  catalogFilterValuesFromSearch,
  compileCatalogFilterSchema,
  parseCatalogFilterPath,
  readCatalogFilterValues,
  stripDefaultCatalogFilterValues,
  validateCatalogFilterSchema,
  validateCatalogFilterValues,
  type CatalogFilterSchema,
} from './catalog-filter'

const schema = {
  source: 'demo',
  version: 3,
  fields: [
    {
      key: 'genres',
      label: 'Жанры',
      type: 'multiselect',
      modes: ['and', 'not'],
      options: [
        { value: '1', label: 'Экшен', count: 12 },
        { value: '2', label: 'Драма' },
      ],
    },
    { key: 'kind', label: 'Тип', type: 'select', options: [{ value: 'tv', label: 'TV' }] },
    { key: 'score', label: 'Оценка', type: 'number', bounds: ['min'], min: 1, max: 10 },
    { key: 'year', label: 'Год', type: 'number', min: 1900, max: 2026 },
  ],
  rules: [
    {
      id: 'search-with-kind',
      when: [{ field: 'kind', value: 'tv' }],
      drop: 'q',
      reason: 'поиск не работает',
    },
  ],
  builtAt: '2026-10-07T10:00:00.000Z',
}

describe('схема фильтров: валидация', () => {
  it('принимает схему с полями, связками и меткой сборки', () => {
    const parsed = validateCatalogFilterSchema(schema)
    expect(parsed.source).toBe('demo')
    expect(parsed.builtAt).toBe('2026-10-07T10:00:00.000Z')
    expect(parsed.rules?.map((rule) => rule.id)).toEqual(['search-with-kind'])
    expect(parsed.fields[0]?.modes).toEqual(['and', 'not'])
  })

  it('опция с disabled проходит схему; false не пишется, мусор отклоняется', () => {
    const parsed = validateCatalogFilterSchema({
      ...schema,
      rules: [],
      fields: [
        {
          key: 'genres',
          label: 'Жанры',
          type: 'multiselect',
          modes: ['and'],
          options: [
            { value: '1', label: 'Экшен', disabled: true },
            { value: '2', label: 'Драма', disabled: false },
          ],
        },
      ],
    })
    const options = parsed.fields[0]?.options
    expect(options?.[0]).toMatchObject({ value: '1', disabled: true })
    // разряженная форма: отсутствие ключа и false — одно и то же, шума нет
    expect(options?.[1] && 'disabled' in options[1]).toBe(false)
    expect(() =>
      validateCatalogFilterSchema({
        ...schema,
        fields: [{ key: 'k', label: 'K', type: 'select', options: [{ value: 'x', label: 'X', disabled: 'да' }] }],
      }),
    ).toThrow(/disabled/)
  })

  it('отклоняет подделку полей: дубль ключа, чужой тип, опции вне правил', () => {
    expect(() => validateCatalogFilterSchema({ ...schema, source: 'Demo Kit' })).toThrow(/source/)
    expect(() =>
      validateCatalogFilterSchema({
        ...schema,
        fields: [...schema.fields, { key: 'genres', label: 'Ещё', type: 'select', options: [{ value: 'x', label: 'X' }] }],
      }),
    ).toThrow(/duplicate/)
    expect(() => validateCatalogFilterSchema({ ...schema, fields: [{ key: 'k', label: 'K', type: 'color' }] })).toThrow(/type/)
    expect(() =>
      validateCatalogFilterSchema({
        ...schema,
        fields: [{ key: 'k', label: 'K', type: 'select', options: [{ value: 'x', label: 'X', count: -1 }] }],
      }),
    ).toThrow(/count/)
  })

  it('связка ссылается только на объявленные поля и поиск', () => {
    expect(() =>
      validateCatalogFilterSchema({
        ...schema,
        rules: [{ id: 'r', when: [{ field: 'nope' }], drop: 'q', reason: 'r' }],
      }),
    ).toThrow(/unknown field/)
    expect(() =>
      validateCatalogFilterSchema({
        ...schema,
        rules: [{ id: 'r', when: [{ field: 'kind' }], drop: { field: 'nope' }, reason: 'r' }],
      }),
    ).toThrow(/drops an unknown field/)
    expect(() => validateCatalogFilterSchema({ ...schema, builtAt: 'не дата' })).toThrow(/builtAt/)
  })

  it('поля ≤ 64 и числовые границы не перевёрнуты', () => {
    const many = Array.from({ length: 65 }, (_, i) => ({ key: `k${i}`, label: `K${i}`, type: 'text' as const }))
    expect(() => validateCatalogFilterSchema({ ...schema, fields: many })).toThrow(/fields/)
    expect(() =>
      validateCatalogFilterSchema({
        ...schema,
        fields: [{ key: 'n', label: 'N', type: 'number', min: 10, max: 1 }],
      }),
    ).toThrow(/min exceeds max/)
  })
})

describe('имена полей и адрес', () => {
  it('имена выводятся из режимов и границ', () => {
    expect(catalogFilterFieldNames(schema.fields[0]!)).toEqual(['filters.genres.and', 'filters.genres.not'])
    expect(catalogFilterFieldNames(schema.fields[2]!)).toEqual(['filters.score.min'])
    expect(catalogFilterFieldNames(schema.fields[3]!)).toEqual(['filters.year.min', 'filters.year.max'])
    expect(catalogFilterFieldNames(schema.fields[1]!)).toEqual(['filters.kind'])
  })

  it('путь разбирается обратно, мусор — нет', () => {
    expect(parseCatalogFilterPath('filters.genres.not')).toEqual({ key: 'genres', mode: 'not' })
    expect(parseCatalogFilterPath('filters.year.max')).toEqual({ key: 'year', bound: 'max' })
    expect(parseCatalogFilterPath('filters.kind')).toEqual({ key: 'kind' })
    expect(parseCatalogFilterPath('page.filters.kind')).toBeUndefined()
  })

  it('дефолт границы в адрес не пишется, а не-дефолт — пишется', () => {
    const stripped = stripDefaultCatalogFilterValues(schema, {
      'filters.score.min': 1,
      'filters.year.min': 1990,
      'filters.genres.and': ['1'],
    })
    expect(stripped).toEqual({ 'filters.year.min': '1990', 'filters.genres.and': ['1'] })
  })

  it('адрес каноничен: ключи сортируются, чужие сохраняются, своя страница сбрасывается', () => {
    const url = canonicalCatalogFilterUrl(
      '/demo',
      { 'filters.genres.and': ['1', '2'], 'filters.score.min': 7, page: '3' },
      { prefix: 'page', preserved: { 'gallery.size': '12', 'page.size': '20' } },
    )
    expect(url).toBe('/demo?gallery.size=12&page.filters.genres.and=1%2C2&page.filters.score.min=7&page.size=20')
  })

  it('снятие одного чипа не трогает остальные значения', () => {
    const url = catalogFilterUrlWithout('/demo', { 'filters.genres.and': ['1', '2'], 'filters.kind': ['tv'] }, 'filters.genres.and', '1')
    expect(url).toBe('/demo?page.filters.genres.and=2&page.filters.kind=tv')
  })

  it('значения из адреса: свой префикс пагинатора срезается, числа сохраняются числами', () => {
    const values = catalogFilterValuesFromSearch(
      { 'page.filters.genres.and': '1,2', 'page.filters.score.min': 8, 'page.q': 'наруто', 'gallery.filters.kind': 'tv' },
      'page',
    )
    expect(values).toEqual({ 'filters.genres.and': ['1', '2'], 'filters.score.min': ['8'] })
    expect(readCatalogFilterValues({ 'filters.kind': 'tv', 'filters.score.min': 6 })).toEqual({
      'filters.kind': ['tv'],
      'filters.score.min': ['6'],
    })
  })

  it('чипы: значение из опций — с подписью, «кроме» — исключено, чужое — unknown', () => {
    const chips = activeCatalogFilters(schema, { 'filters.genres.not': ['1'], 'filters.kind': ['zzz'] })
    expect(chips).toHaveLength(2)
    expect(chips[0]).toMatchObject({ label: 'Экшен', fieldLabel: 'Жанры', excluded: true, unknown: false })
    expect(chips[1]).toMatchObject({ label: 'zzz', unknown: true, excluded: false })
  })
})

describe('деградация oversized-полей', () => {
  it('опции режутся до предела с отметкой optionsTruncated', () => {
    const big: CatalogFilterSchema = {
      source: 'demo',
      version: 1,
      fields: [
        {
          key: 'studios',
          label: 'Студии',
          type: 'multiselect',
          options: Array.from({ length: CATALOG_FILTER_OPTIONS_LIMIT + 3 }, (_, i) => ({
            value: `s${i}`,
            label: `Студия ${i}`,
            count: i,
          })),
        },
      ],
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const capped = capCatalogFilterOptions(big)
    expect(capped.fields[0]?.options).toHaveLength(CATALOG_FILTER_OPTIONS_LIMIT)
    expect(capped.fields[0]?.optionsTruncated).toBe(3)
    // Сортировка — по частоте: первый вариант самый популярный.
    expect(capped.fields[0]?.options?.[0]?.value).toBe(`s${CATALOG_FILTER_OPTIONS_LIMIT + 2}`)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('компиляция в форму b1', () => {
  it('поля, пути и дефолты границ', () => {
    const compiled = compileCatalogFilterSchema(schema)
    expect(compiled.paths).toEqual([
      'filters.genres.and',
      'filters.genres.not',
      'filters.kind',
      'filters.score.min',
      'filters.year.min',
      'filters.year.max',
    ])
    expect(compiled.defaults).toEqual({
      'filters.score.min': '1',
      'filters.year.min': '1900',
      'filters.year.max': '2026',
    })
    const labels = compiled.definition.fields.map((field) => field.label)
    expect(labels).toContain('Жанры · все из')
    expect(labels).toContain('Оценка · от')
    expect(labels).toContain('Тип')
  })

  it('опции — allowlist валидатора: чужое значение не проходит', () => {
    const compiled = compileCatalogFilterSchema(schema)
    const form = new FormData()
    form.append('filters.genres.and', '1')
    form.append('filters.genres.and', 'чужое')
    const { values, errors } = validateCatalogFilterValues(compiled.schema, form)
    expect(errors).toEqual(['oneOf'])
    expect(values).toEqual({})
  })

  it('deny-safe разбор extra: чужое значение и мусор не доезжают до значений', () => {
    const form = catalogFilterFormData(schema, {
      'filters.genres.and': '1,чужое',
      'filters.score.min': '999',
      'filters.year.max': '2020',
      'filters.kind': 'tv',
      'filters.unknown': 'x',
    })
    expect(form.getAll('filters.genres.and')).toEqual(['1'])
    expect(form.get('filters.score.min')).toBeNull()
    expect(form.get('filters.year.max')).toBe('2020')
    expect(form.get('filters.kind')).toBe('tv')
    expect(form.get('filters.unknown')).toBeNull()
  })

  it('начальное состояние формы заполняется из адреса и дефолтов', () => {
    const compiled = compileCatalogFilterSchema(schema)
    const state = catalogFilterInitialState(
      compiled.definition,
      { 'filters.genres.and': ['1'], 'filters.score.min': ['7'] },
      compiled.defaults,
    )
    expect(state.values['filters.genres.and']).toEqual(['1'])
    expect(state.values['filters.score.min']).toBe('7')
    expect(state.values['filters.year.max']).toBe('2026')
  })

  it('опции доезжают до поля формы полными подписями; allowlist — по значениям', () => {
    const compiled = compileCatalogFilterSchema({
      ...schema,
      rules: [],
      fields: [
        {
          key: 'genres',
          label: 'Жанры',
          type: 'multiselect',
          modes: ['and'],
          options: [
            { value: '1', label: 'Экшен', disabled: true },
            { value: '2', label: 'Драма' },
          ],
        },
      ],
    })
    const genreField = compiled.definition.fields.find((f) => f.name === 'filters.genres.and')
    // Подпись и флаг доступности не теряются: поле видит «Драма», а не «2».
    expect(genreField?.options).toEqual([
      { value: '1', label: 'Экшен', count: undefined, disabled: true },
      { value: '2', label: 'Драма', count: undefined },
    ])
    // allowlist по-прежнему по значениям: чужое отсекается, объявленное — нет.
    const form = new FormData()
    form.append('filters.genres.and', '1')
    form.append('filters.genres.and', 'чужое')
    const { errors } = validateCatalogFilterValues(compiled.schema, form)
    expect(errors).toEqual(['oneOf'])
  })
})

describe('значение, скрытое лимитом показа', () => {
  /**
   * Поле объявило `optionsTruncated`: у источника значений больше, чем доехало
   * в схему. «Нет в показанных опциях» для такого поля — ещё не «чужое
   * значение»: молча выбросить его нельзя, решает источник (он один знает свой
   * справочник и честно скажет `dropped`).
   */
  const truncated: CatalogFilterSchema = {
    source: 'shikimori',
    version: 1,
    fields: [
      {
        key: 'studios',
        label: 'Студии',
        type: 'multiselect',
        modes: ['and'],
        options: [{ value: '858', label: 'Wit Studio' }],
        optionsTruncated: 933,
      },
      {
        key: 'kind',
        label: 'Тип',
        type: 'select',
        options: [{ value: 'tv', label: 'ТВ' }],
      },
    ],
  }

  it('полный список опций остаётся allowlist’ом, обрезанный — нет', () => {
    expect(catalogFilterOptionsAreComplete(truncated.fields[0])).toBe(false)
    expect(catalogFilterOptionsAreComplete(truncated.fields[1])).toBe(true)
    expect(
      catalogFilterOptionsAreComplete({ key: 'x', label: 'X', type: 'text' } as never),
    ).toBe(false)
  })

  it('значение вне обрезанного списка доезжает до значений', () => {
    const form = catalogFilterFormData(truncated, { 'filters.studios.and': '858,1933' })
    expect(form.getAll('filters.studios.and')).toEqual(['858', '1933'])
    const { values, errors } = validateCatalogFilterValues(truncated, form)
    expect(errors).toEqual([])
    expect(values).toEqual({ studios: { and: ['858', '1933'] } })
  })

  it('у поля с полным списком allowlist работает как прежде', () => {
    const form = catalogFilterFormData(truncated, { 'filters.kind': 'zzz' })
    expect(form.get('filters.kind')).toBeNull()
    expect(validateCatalogFilterValues(truncated, form).values).toEqual({})
  })

  it('чип различает «чужое значение» и «скрыто лимитом»', () => {
    const values = { 'filters.studios.and': ['1933'], 'filters.kind': ['zzz'] }
    const chips = activeCatalogFilters(truncated, values)
    const hidden = chips.find((chip) => chip.value === '1933')
    const foreign = chips.find((chip) => chip.value === 'zzz')
    expect(hidden).toMatchObject({ hiddenByLimit: true, unknown: false })
    expect(foreign).toMatchObject({ unknown: true })
    expect(foreign?.hiddenByLimit).toBeUndefined()
  })
})
