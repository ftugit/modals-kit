/**
 * Unit-набор схемы фильтров: валидация схемы, деградация опций, канонический
 * адрес, deny-safe разбор значений и параметры формы (`formParams`).
 *
 * Порт канона проверяется ПОВЕДЕНЧЕСКИ (не строками исходника): имена полей,
 * режимы, дефолты границ и allowlist'ы — то, на что опираются форма и транспорт.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  CATALOG_FILTER_NOJS_OPTIONS,
  CATALOG_FILTER_OPTIONS_LIMIT,
  activeCatalogFilters,
  canonicalCatalogFilterUrl,
  capCatalogFilterOptions,
  catalogFilterFieldNames,
  catalogFilterFormData,
  catalogFilterOptionsAreComplete,
  catalogFilterUrlWithout,
  catalogFilterValueMap,
  catalogFilterValuesFromSearch,
  formParams,
  parseCatalogFilterPath,
  readCatalogFilterValues,
  stripDefaultCatalogFilterValues,
  validateCatalogFilterSchema,
  validateCatalogFilterValues,
  type CatalogFilterSchema,
} from './index'
import { defineForm, field, makeRenderer, ru, evaluate } from '#lib/form/index.js'
import { describeAll } from './test-describe'

const schema: CatalogFilterSchema = {
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

  it('длинное поле в пределе едет целиком: частые первыми, дальше по подписи; короткое не трогается; allowlist полный', () => {
    const studios = Array.from({ length: 1934 }, (_, i) => ({ value: `s${i}`, label: `Студия ${String(1933 - i).padStart(4, '0')}` }))
    studios[1500] = { ...studios[1500]!, count: 5 } as (typeof studios)[number]
    const kinds = [{ value: 'tv', label: 'TV' }, { value: 'movie', label: 'Фильм' }, { value: 'ova', label: 'OVA' }]
    const schema: CatalogFilterSchema = {
      source: 'demo', version: 1,
      fields: [
        { key: 'studios', label: 'Студии', type: 'multiselect', options: studios },
        { key: 'kind', label: 'Тип', type: 'select', options: kinds },
      ],
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const capped = capCatalogFilterOptions(schema)
    const options = capped.fields[0]!.options!
    expect(options).toHaveLength(1934)
    expect(capped.fields[0]!.optionsTruncated).toBeUndefined()
    expect(options[0]!.value).toBe('s1500') // единственная с частотой
    expect(options.slice(1, 3).map((o) => o.label)).toEqual(['Студия 0000', 'Студия 0001'])
    expect(capped.fields[1]!.options!.map((o) => o.value)).toEqual(['tv', 'movie', 'ova'])
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
    // значение из хвоста (не в первых 200) законно, чужое — нет: allowlist по всему списку
    const tail = new FormData()
    tail.append('filters.studios.or', 's3')
    expect(validateCatalogFilterValues(capped, tail, describeAll).errors).toEqual([])
    const foreign = new FormData()
    foreign.append('filters.studios.or', 'zzz')
    expect(validateCatalogFilterValues(capped, foreign, describeAll).errors).toEqual(['oneOf'])
  })

  it('схема длиннее предела 5000 не проходит валидатор (защита от гигантских форм)', () => {
    const options = Array.from({ length: CATALOG_FILTER_OPTIONS_LIMIT + 1 }, (_, i) => ({ value: `s${i}`, label: `S${i}` }))
    expect(() =>
      validateCatalogFilterSchema({ source: 'demo', version: 1, fields: [{ key: 'studios', label: 'Студии', type: 'multiselect', options }] }),
    ).toThrow('Invalid catalog filter options')
    expect(CATALOG_FILTER_OPTIONS_LIMIT).toBe(5000)
    expect(CATALOG_FILTER_NOJS_OPTIONS).toBe(200)
  })
})

describe('параметры формы из схемы (formParams)', () => {
  it('описание приложения: свои подписи и порядок, варианты и границы — из схемы', () => {
    const filter = formParams(schema)
    const d = defineForm({
      id: 'own',
      policy: filter.policy,
      fields: filter.fields({
        'year.max': field.number({ label: 'Год до', ...filter.year.max }),
        'year.min': field.number({ label: 'Год от', ...filter.year.min }),
        kind: field.select({ label: 'Формат', placeholder: 'Любой', ...filter.kind }),
      }),
    })
    expect(d.fields.map((f) => [f.name, f.label])).toEqual([
      ['filters.year.max', 'Год до'],
      ['filters.year.min', 'Год от'],
      ['filters.kind', 'Формат'],
    ])
    // F45: край базы — подсказкой у пустого числового инпута, не значением
    expect(d.byName['filters.year.min']?.placeholder).toBe('1900')
    expect(d.byName['filters.year.max']?.placeholder).toBe('2026')
    // свой ключ после развёртки побеждает
    expect(d.byName['filters.kind']?.placeholder).toBe('Любой')
    expect(d.attrsOf('filters.year.min').attrs).toMatchObject({ min: 1900, max: 2026 })
  })

  it('поле, которого у источника нет, не попадает в описание; неизвестный ключ даёт пустые параметры', () => {
    const filter = formParams(schema)
    expect(filter.studios.and).toEqual({ validate: [] })
    expect(filter.nothing).toEqual({ validate: [] })
    const fields = filter.fields({
      'studios.and': field.multiselect({ label: 'Студии', ...filter.studios.and }),
      'genres.or': field.multiselect({ label: 'Жанры', ...filter.genres.or }), // режима нет у схемы
      kind: field.select({ label: 'Тип', ...filter.kind }),
    })
    expect(Object.keys(fields)).toEqual(['filters.kind'])
  })

  it('развёртка чужого ключа в разработке даёт предупреждение', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const filter = formParams(schema)
    filter.fields({ 'genres.not': field.multiselect({ label: 'Кроме', ...filter.genres.and }) })
    expect(warn).toHaveBeenCalledWith('[filters] поле «genres.not» получило параметры «genres.and»')
    warn.mockClear()
    filter.fields({ 'genres.not': field.multiselect({ label: 'Кроме', ...filter.genres.not }) })
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('адресный слой: имена и межполевые ссылки — с префиксом', () => {
    const d = describeAll(schema, { prefix: 'page.' })
    expect(d.fields.map((f) => f.name)).toEqual([
      'page.filters.genres.and',
      'page.filters.genres.not',
      'page.filters.kind',
      'page.filters.score.min',
      'page.filters.year.min',
      'page.filters.year.max',
    ])
    const render = makeRenderer([ru])
    const data = new FormData()
    data.set('page.filters.year.min', '2010')
    data.set('page.filters.year.max', '2001')
    data.append('page.filters.genres.and', '1')
    data.append('page.filters.genres.not', '1')
    const errors = evaluate(data, d, { render, requireEnvelope: false }).errors
    expect(errors.map((e) => [e.path, e.code])).toEqual([
      ['page.filters.genres.not', 'noOverlap'],
      ['page.filters.year.min', 'notAbove'],
    ])
  })

  it('опции — allowlist валидатора: чужое значение не проходит', () => {
    const form = new FormData()
    form.append('filters.genres.and', '1')
    form.append('filters.genres.and', 'чужое')
    const { values, errors } = validateCatalogFilterValues(schema, form, describeAll)
    expect(errors).toEqual(['oneOf'])
    expect(values).toEqual({})
  })

  it('«все из» ∩ «кроме» и перевёрнутый диапазон — ошибки формы: набор отклоняется целиком', () => {
    const overlap = new FormData()
    overlap.append('filters.genres.and', '1')
    overlap.append('filters.genres.not', '1')
    overlap.set('filters.kind', 'tv')
    expect(validateCatalogFilterValues(schema, overlap, describeAll)).toMatchObject({
      values: {},
      errors: ['noOverlap'],
      failed: [{ path: 'filters.genres.not', code: 'noOverlap' }],
    })
    const reversed = new FormData()
    reversed.set('filters.year.min', '2010')
    reversed.set('filters.year.max', '2001')
    expect(validateCatalogFilterValues(schema, reversed, describeAll).failed).toEqual([
      { path: 'filters.year.min', code: 'notAbove' },
    ])
    const range = new FormData()
    range.set('filters.year.min', '2001')
    range.set('filters.year.max', '2010')
    expect(validateCatalogFilterValues(schema, range, describeAll).values).toEqual({ year: { min: 2001, max: 2010 } })
  })

  it('поле, которого нет в описании приложения, не применяется', () => {
    const onlyKind = (input: CatalogFilterSchema) => {
      const filter = formParams(input)
      return defineForm({ id: 'k', policy: filter.policy, fields: filter.fields({ kind: field.select({ label: 'Тип', ...filter.kind }) }) })
    }
    const form = new FormData()
    form.set('filters.kind', 'tv')
    form.set('filters.score.min', '5')
    expect(validateCatalogFilterValues(schema, form, onlyKind)).toMatchObject({ values: { kind: 'tv' }, errors: [] })
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

  it('связка на поле входит в отказ набора; пустое запрещённое поле — нет; подписи связки — из описания', () => {
    const linked = {
      ...schema,
      rules: [
        {
          id: 'score-with-kind',
          when: [{ field: 'kind', value: 'tv' }],
          drop: { field: 'score' },
          reason: 'у ТВ нет оценки',
        },
      ],
    }
    const bad = new FormData()
    bad.set('filters.kind', 'tv')
    bad.set('filters.score.min', '5')
    const rejected = validateCatalogFilterValues(linked, bad, describeAll)
    expect(rejected.errors).toContain('link.blocked')
    // отказ касается ЦЕЛОГО набора: источник не получает ничего
    expect(rejected.values).toEqual({})

    const free = new FormData()
    free.set('filters.kind', 'tv')
    const passed = validateCatalogFilterValues(linked, free, describeAll)
    // пустое запрещённое поле ничего не нарушает
    expect(passed.errors).toEqual([])
    expect(passed.values.kind).toBe('tv')
    // связка — правило поля (`disabledWhen`); поле и блокирующее названы
    // подписями ОПИСАНИЯ, а не схемы; текст — словаря формы
    const filter = formParams(linked)
    const d = defineForm({
      id: 'linked',
      policy: filter.policy,
      fields: filter.fields({
        kind: field.select({ label: 'Формат', ...filter.kind }),
        'score.min': field.number({ label: 'Оценка от', ...filter.score.min }),
      }),
    })
    expect(d.byName['filters.score.min']?.disabledWhen).toEqual([{
      when: { field: 'filters.kind', includes: 'tv' },
      reason: 'у ТВ нет оценки',
      blockers: ['Формат'],
      label: 'Оценка от',
    }])
    expect(d.byName['filters.kind']?.disabledWhen).toBeUndefined()
    expect(d.messages).toEqual({})
  })

  it('опции доезжают до поля формы полными подписями; allowlist — по значениям', () => {
    const own: CatalogFilterSchema = {
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
    }
    const genreField = describeAll(own).fields.find((f) => f.name === 'filters.genres.and')
    // Подпись и флаг доступности не теряются: поле видит «Драма», а не «2».
    expect(genreField?.options).toEqual([
      { value: '1', label: 'Экшен', count: undefined, disabled: true },
      { value: '2', label: 'Драма', count: undefined },
    ])
    const form = new FormData()
    form.append('filters.genres.and', '1')
    form.append('filters.genres.and', 'чужое')
    expect(validateCatalogFilterValues(own, form, describeAll).errors).toEqual(['oneOf'])
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
    const { values, errors } = validateCatalogFilterValues(truncated, form, describeAll)
    expect(errors).toEqual([])
    expect(values).toEqual({ studios: { and: ['858', '1933'] } })
  })

  it('у поля с полным списком allowlist работает как прежде', () => {
    const form = catalogFilterFormData(truncated, { 'filters.kind': 'zzz' })
    expect(form.get('filters.kind')).toBeNull()
    expect(validateCatalogFilterValues(truncated, form, describeAll).values).toEqual({})
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
