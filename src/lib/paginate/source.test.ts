import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NO_CAPABILITIES,
  assertAdaptedSource,
  clearUnsupportedKeys,
  clearedKeys,
  defineSource,
  defineSourceSwitch,
  isAdaptedSource,
  sanitizeQueryValue,
  sourceCapabilities,
  type CapabilityKeys,
} from './source'
import { createLocalAdapter } from './adapter-local'
import { createUrlAdapter } from './adapter-url'
import { definePaginator, getPaginator, hasPaginator, resetRegistry } from './registry'
import type { PageRequest } from './types'

/** Источник-заглушка: страница и spy на вызовы. */
function fakeSource<T>(items: T[] = [], meta: { totalPages?: number } = {}) {
  const calls: PageRequest[] = []
  const source = defineSource<T>({
    id: 'fake',
    label: 'Заглушка',
    totals: meta.totalPages !== undefined,
    page: async (req) => {
      calls.push(req)
      return { items, ...meta }
    },
  })
  return { source, calls }
}

describe('слой источника: адаптация', () => {
  it('пагинатор принимает только defineSource — простая функция мимо', () => {
    const plain = async () => ({ items: [] })
    expect(isAdaptedSource(plain)).toBe(false)
    expect(() =>
      createLocalAdapter({ name: 'plain', source: plain as never }),
    ).toThrow(/defineSource/)
    expect(() =>
      createUrlAdapter({ name: 'plain-url', source: plain as never }),
    ).toThrow(/defineSource/)
  })

  it('объект с той же формой не проходит: бренд нужен', () => {
    const lookalike = {
      id: 'lookalike',
      label: 'Похожий',
      dataKeys: [],
      capabilityKeys: {},
      capabilitiesFor: () => NO_CAPABILITIES,
      searchFor: () => undefined,
      filtersFor: () => undefined,
      page: async () => ({ items: [] }),
    }
    expect(isAdaptedSource(lookalike)).toBe(false)
    expect(() => assertAdaptedSource(lookalike, 'test')).toThrow(/defineSource/)
    expect(() => definePaginator({ name: 'lookalike', source: lookalike as never })).toThrow(
      /defineSource/,
    )
  })

  it('возможности источника считаются по спецификациям, а не по желанию UI', () => {
    const data = fakeSource(['a'])
    expect(data.source.capabilitiesFor({})).toEqual({
      search: false,
      filters: false,
      fuzzy: false,
      totals: false,
    })

    const catalogue = defineSource<string>({
      id: 'catalogue',
      label: 'Каталог',
      totals: true,
      search: {
        fuzzy: { id: (r) => r, texts: (r) => [r] },
      },
      page: async () => ({ items: [] }),
    })
    expect(catalogue.capabilitiesFor({})).toEqual({
      search: true,
      filters: false,
      fuzzy: true,
      totals: true,
    })
  })

  it('запрос нормализуется до источника: мусор, длина, выключенный поиск', async () => {
    const { source, calls } = fakeSource<string>()
    await source.page({ page: 1, pageSize: 10, extra: { q: ' книги ' } })
    // Без спецификации поиска запрос источнику не передаётся вообще.
    expect(calls[0].extra).toEqual({})

    const searchable = defineSource<string>({
      id: 'searchable',
      label: 'Поиск',
      search: { enabled: (extra) => extra.search !== false },
      page: async () => ({ items: [] }),
    })
    const seen: PageRequest[] = []
    const spy = defineSource<string>({
      id: 'spy',
      label: 'Spy',
      search: { enabled: (extra) => extra.search !== false },
      page: async (req) => {
        seen.push(req)
        return { items: searchable ? [] : [] }
      },
    })
    await spy.page({ page: 1, pageSize: 10, extra: { q: 'кни\u0000ги' } })
    expect(seen[0].extra).toEqual({ q: 'кни ги' })
    await spy.page({ page: 1, pageSize: 10, extra: { q: 'x'.repeat(300) } })
    expect(String((seen[1].extra as Record<string, unknown>).q)).toHaveLength(120)
    // Выключенный поиск — гейт оболочки: источник запроса не видит.
    await spy.page({ page: 1, pageSize: 10, extra: { q: 'книги', search: false } })
    expect(seen[2].extra).toEqual({ search: false })
    // Пустой запрос = «ключа нет».
    await spy.page({ page: 1, pageSize: 10, extra: { q: '   ' } })
    expect(seen[3].extra).toEqual({})
  })

  it('sanitizeQueryValue — общая нормализация запроса', () => {
    expect(sanitizeQueryValue(' a ')).toBe('a')
    expect(sanitizeQueryValue('')).toBeUndefined()
    expect(sanitizeQueryValue(null)).toBeUndefined()
    expect(sanitizeQueryValue(42)).toBe('42')
    expect(sanitizeQueryValue('ab\ncd')).toBe('ab cd')
  })

  it('ключи данных замораживаются и не дублируются', () => {
    const source = defineSource<string>({
      id: 'keys',
      label: 'Ключи',
      dataKeys: ['q', 'kind', 'q'],
      page: async () => ({ items: [] }),
    })
    expect(source.dataKeys).toEqual(['q', 'kind'])
    expect(Object.isFrozen(source.dataKeys)).toBe(true)
    expect(Object.isFrozen(source)).toBe(true)
  })
})

describe('слой источника: переключатель', () => {
  const withSearchSource = defineSource<string>({
    id: 'a',
    label: 'A',
    totals: true,
    dataKeys: ['q'],
    search: { fuzzy: { id: (r) => r, texts: (r) => [r] } },
    page: async () => ({ items: ['a'] }),
  })
  const plainSource = defineSource<string>({
    id: 'b',
    label: 'B',
    dataKeys: ['total'],
    page: async () => ({ items: ['b'] }),
  })
  const switchSource = defineSourceSwitch<string>({
    id: 'switch',
    label: 'Переключатель',
    key: 'kind',
    sources: { a: withSearchSource, b: plainSource },
    fallback: 'b',
    dataKeys: ['search'],
    capabilityKeys: { search: ['q', 'search'], totals: ['total'] },
  })

  it('возможности делегируются ВЫБРАННОМУ источнику', () => {
    expect(switchSource.capabilitiesFor({ kind: 'a' })).toEqual({
      search: true,
      filters: false,
      fuzzy: true,
      totals: true,
    })
    expect(switchSource.capabilitiesFor({ kind: 'b' })).toEqual({
      search: false,
      filters: false,
      fuzzy: false,
      totals: false,
    })
    // Неизвестный/пустой выбор — источник по умолчанию.
    expect(switchSource.capabilitiesFor({})).toEqual(switchSource.capabilitiesFor({ kind: 'b' }))
    expect(switchSource.capabilitiesFor({ kind: 'zzz' })).toEqual(
      switchSource.capabilitiesFor({ kind: 'b' }),
    )
  })

  it('спецификации и страницы тоже идут от выбранного источника', async () => {
    expect(switchSource.searchFor({ kind: 'a' })).toBeDefined()
    expect(switchSource.searchFor({ kind: 'b' })).toBeUndefined()
    expect((await switchSource.page({ page: 1, pageSize: 10, extra: { kind: 'a' } })).items).toEqual([
      'a',
    ])
    expect((await switchSource.page({ page: 1, pageSize: 10, extra: { kind: 'b' } })).items).toEqual([
      'b',
    ])
  })

  it('ключи данных — ключ переключателя, свои и дочерние', () => {
    expect([...switchSource.dataKeys].sort()).toEqual(['kind', 'q', 'search', 'total'])
  })

  it('clearedKeys отдаёт удаление ключей неподдерживаемых возможностей', () => {
    const keys: CapabilityKeys = { search: ['q', 'search'], totals: ['total'] }
    // У выбранного «b» нет ни поиска, ни числа страниц → все ключи снимаются.
    expect(clearedKeys(switchSource, { kind: 'b', q: 'книги', total: true }, keys)).toEqual({
      q: undefined,
      search: undefined,
      total: undefined,
    })
    // У «a» поиск есть — снимается только число страниц.
    expect(clearedKeys(switchSource, { kind: 'a', q: 'книги' }, keys)).toEqual({ total: undefined })
    // Чистить нечего → пустой патч (хранилище не трогаем зря).
    expect(clearedKeys(switchSource, { kind: 'a' }, keys)).toEqual({})
  })

  it('переключение источника снимает ключи возможностей одной записью', () => {
    // Патч «выбрали b» + снятие того, чего у b нет: одна запись в хранилище,
    // один перезаход — а не вторая правка «из-под полы».
    expect(
      clearUnsupportedKeys(switchSource, { kind: 'a', q: 'книги', total: true }, { kind: 'b' }),
    ).toEqual({ kind: 'b', q: undefined, search: undefined, total: undefined })
    // Поддерживаемые ключи не трогаем: у «a» есть поиск, остаётся только чистка totals.
    expect(clearUnsupportedKeys(switchSource, { kind: 'b', total: true }, { kind: 'a' })).toEqual({
      kind: 'a',
      total: undefined,
    })
    // Снимаем лишь то, что реально записано: пустые ключи в патч не попадают.
    expect(clearUnsupportedKeys(switchSource, { kind: 'a' }, { kind: 'b' })).toEqual({ kind: 'b' })
    // Ключи, которых у выбора нет и в патче, тоже не выдумываются.
    expect(clearUnsupportedKeys(switchSource, { kind: 'b' }, { layout: 'columns' })).toEqual({
      layout: 'columns',
    })
  })

  it('источник без объявленных ключей пагинатор не чистит', () => {
    expect(plainSource.capabilityKeys).toEqual({})
    expect(clearedKeys(plainSource, { q: 'x' }, {})).toEqual({})
  })

  it('sourceCapabilities безопасен для чужого объекта', () => {
    expect(sourceCapabilities(undefined)).toEqual(NO_CAPABILITIES)
    expect(sourceCapabilities({} as never)).toEqual(NO_CAPABILITIES)
    expect(sourceCapabilities(withSearchSource)).toEqual(withSearchSource.capabilitiesFor({}))
  })
})

describe('слой источника: регистрация в пагинаторе', () => {
  beforeEach(() => resetRegistry())

  it('адаптер и пагинатор знают источник, возможности доступны по имени', async () => {
    const { source } = fakeSource(['a', 'b'], { totalPages: 3 })
    const adapter = createLocalAdapter({ name: 'caps', source })
    definePaginator({ name: 'caps', adapter })
    const instance = getPaginator('caps')
    expect(hasPaginator('caps')).toBe(true)
    expect(instance.source).toBe(source)
    expect(adapter.source).toBe(source)
  })

  it('возможности выключенного поиска видны UI как «false»', async () => {
    const spy = vi.fn(async () => ({ items: [] }))
    const gated = defineSource<string>({
      id: 'gated',
      label: 'Гейт',
      search: { enabled: () => false },
      page: spy,
    })
    definePaginator({ name: 'gated', source: gated })
    const instance = getPaginator('gated')
    expect(instance.source.capabilitiesFor({}).search).toBe(true)
    await instance.source.page({ page: 1, pageSize: 10, extra: { q: 'книги' } })
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ extra: {} }))
  })
})
