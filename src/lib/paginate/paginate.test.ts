import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  canGo,
  canLoadMore,
  computeColumns,
  createCursorAdapter,
  createEmitter,
  createLocalAdapter,
  createLocalStorageStorage,
  createMemoryStorage,
  createPaginatorStore,
  createUrlAdapter,
  withUrlTakeover,
  withTotalsGate,
  decodeExtraValue,
  definePaginator,
  defineSource,
  deriveMeta,
  distributeRoundRobin,
  encodeExtraValue,
  extraField,
  flattenPages,
  getPaginator,
  getState,
  goToPage,
  hasPaginator,
  initPaginator,
  initServerPaginator,
  loadMore,
  pageSearch,
  pagesList,
  pageWindow,
  paginatorSearch,
  pendingSide,
  pickCurrentPage,
  prefetchPage,
  canonicalPaginatorSearch,
  canonicalSearchRecord,
  commaListSearch,
  readPaginatorSearch,
  resetPaginator,
  resetRegistry,
  retry,
  runsOfColumn,
  setExtra,
  setPageSize,
  safePersist,
  onPaginatorError,
  viewState,
  EMPTY_CAPABILITIES,
  type AdaptedSource,
  type Extra,
  type PageRequest,
  type PageResponse,
  type PaginatorState,
} from './index'

function makeState(overrides: Partial<PaginatorState<unknown>> = {}): PaginatorState<unknown> {
  return {
    name: 'test',
    page: 1,
    pageSize: 20,
    totalItems: null,
    totalPages: null,
    loadedPages: [],
    pages: {},
    status: 'idle',
    error: null,
    pending: null,
    hasNext: null,
    hasPrev: null,
    reqId: 0,
    extra: {},
    capabilities: EMPTY_CAPABILITIES,
    ...overrides,
  }
}

/**
 * Источник теста: данные + паспорт через слой (`defineSource`) — пагинатор
 * принимает только адаптированные источники, «просто функция» его не пройдёт.
 */
function sourceOf<T>(
  load: (req: PageRequest) => Promise<PageResponse<T>>,
  over: { scan?: { batchSize?: number }; search?: boolean } = {},
): AdaptedSource<T> {
  return defineSource<T>({
    name: 'test-source',
    record: {
      id: (record) => String((record as { id?: unknown }).id ?? ''),
      title: () => '',
      texts: () => [],
    },
    scan: over.scan ?? {},
    ...(over.search === false ? {} : { search: { minLength: 1 } }),
    data: (look, input) =>
      load({
        page: look.page,
        pageSize: look.pageSize,
        signal: look.signal,
        extra: { q: input.q },
      }),
  })
}

function fakeAdapter(
  init: { page: number; pageSize?: number; totalPages?: number; totalItems?: number; extra?: Extra },
  load?: (req: PageRequest) => Promise<PageResponse<string>>
) {
  const getInitial = vi.fn(async () => init)
  const loadPage = vi.fn(
    load ??
      (async ({ page }: PageRequest) => ({
        items: [`p${page}a`, `p${page}b`],
        totalItems: 6,
        totalPages: 3,
      }))
  )
  const persist = vi.fn(() => {})
  const adapter = {
    getInitial,
    loadPage,
    persist,
    capabilities: { append: true },
    capabilitiesFor: () => ({ totals: true }),
  }
  return { adapter, getInitial, loadPage, persist }
}

describe('pure functions', () => {
  it('deriveMeta with totalPages and totalItems', () => {
    expect(deriveMeta({ items: [], totalPages: 7, totalItems: 134 }, 20, 3)).toEqual({
      totalItems: 134,
      totalPages: 7,
      hasNext: true,
    })
  })

  it('deriveMeta: last page sets hasNext = false even without explicit hasNext', () => {
    expect(deriveMeta({ items: [], totalPages: 7, totalItems: 134 }, 20, 7).hasNext).toBe(false)
  })

  it('deriveMeta: explicit resp.hasNext overrides derived', () => {
    expect(deriveMeta({ items: [], totalPages: 7, hasNext: true }, 20, 7).hasNext).toBe(true)
  })

  it('deriveMeta: only totalItems derives totalPages and hasNext', () => {
    expect(deriveMeta({ items: [], totalItems: 95 }, 20, 5)).toEqual({
      totalItems: 95,
      totalPages: 5,
      hasNext: false,
    })
  })

  it('deriveMeta: only hasNext returns null totals', () => {
    expect(deriveMeta({ items: [], hasNext: true }, 20, 1)).toEqual({
      totalItems: null,
      totalPages: null,
      hasNext: true,
    })
  })

  it('deriveMeta: empty response returns nulls', () => {
    expect(deriveMeta({ items: [] }, 20, 1)).toEqual({
      totalItems: null,
      totalPages: null,
      hasNext: null,
    })
  })

  it('deriveMeta: totalItems = 0', () => {
    expect(deriveMeta({ items: [], totalItems: 0 }, 20, 1)).toEqual({
      totalItems: 0,
      totalPages: 0,
      hasNext: false,
    })
  })

  it('pickCurrentPage', () => {
    expect(pickCurrentPage(new Set(), 4)).toBe(4)
    expect(pickCurrentPage(new Set([3, 5]), 9)).toBe(5)
  })

  it('canGo: +1 by hasNext/totalPages, -1 by page', () => {
    expect(canGo(1, makeState({ hasNext: true }))).toBe(true)
    expect(canGo(1, makeState({ totalPages: 5, page: 3 }))).toBe(true)
    expect(canGo(1, makeState({ totalPages: 5, page: 5 }))).toBe(false)
    expect(canGo(1, makeState())).toBe(false)
    expect(canGo(-1, makeState({ page: 1 }))).toBe(false)
    expect(canGo(-1, makeState({ page: 3 }))).toBe(true)
  })

  it('canLoadMore: -1 by min(loadedPages), +1 like canGo', () => {
    expect(canLoadMore(-1, makeState({ loadedPages: [3, 4] }))).toBe(true)
    expect(canLoadMore(-1, makeState({ loadedPages: [1, 2] }))).toBe(false)
    expect(canLoadMore(-1, makeState({ loadedPages: [3, 4], hasPrev: false }))).toBe(false)
    expect(canLoadMore(1, makeState({ hasNext: true, loadedPages: [2] }))).toBe(true)
    expect(canLoadMore(1, makeState({ loadedPages: [2] }))).toBe(false)
  })

  it('flattenPages', () => {
    const s = makeState({ loadedPages: [1, 2], pages: { 2: ['c'], 1: ['a', 'b'] } })
    expect(flattenPages(s)).toEqual(['a', 'b', 'c'])
  })

  it('viewState states', () => {
    expect(viewState(makeState({ status: 'init' }))).toBe('notReady')
    expect(viewState(makeState({ status: 'error', loadedPages: [1], pages: { 1: ['a'] } }))).toBe('error')
    expect(viewState(makeState({ status: 'loading' }))).toBe('loading')
    expect(viewState(makeState({ status: 'idle' }))).toBe('empty')
    expect(viewState(makeState({ status: 'idle', loadedPages: [1], pages: { 1: ['a'] } }))).toBe('ready')
  })

  it('pagesList and pending groups', () => {
    const base = makeState({ loadedPages: [1, 2], pages: { 1: ['a'], 2: ['b'] } })
    expect(pagesList(base)).toEqual([
      { page: 1, pending: false, items: ['a'] },
      { page: 2, pending: false, items: ['b'] },
    ])

    const prep = { ...base, pending: { page: 3, mode: 'append' as const, count: 2 } }
    expect(pagesList(prep)[2]).toEqual({ page: 3, pending: true, slots: 2 })

    const pre = { ...base, pending: { page: 0, mode: 'prepend' as const, count: 1 } }
    expect(pagesList(pre)[0].page).toBe(0)

    const rep = { ...base, pending: { page: 5, mode: 'replace' as const, count: 20 } }
    expect(pagesList(rep)).toHaveLength(1)
    expect(pagesList(rep)[0].page).toBe(5)
  })
})

describe('layout & columns', () => {
  it('pageWindow produces proper navigation structure with gaps', () => {
    expect(pageWindow(5, 1)).toEqual([1, 2, 3, 4, 5])
    expect(pageWindow(20, 10, 2)).toEqual([1, 'gap', 8, 9, 10, 11, 12, 'gap', 20])
    expect(pageWindow(20, 1, 2)).toEqual([1, 2, 3, 'gap', 20])
    expect(pageWindow(20, 20, 2)).toEqual([1, 'gap', 18, 19, 20])
  })

  it('computeColumns calculates columns count and fit', () => {
    const res = computeColumns({
      width: 1000,
      columnWidth: 220,
      gap: 16,
      stretch: '25%',
    })
    expect(res.count).toBeGreaterThanOrEqual(1)
    expect(res.fit).toBeDefined()
  })

  it('distributeRoundRobin and runsOfColumn', () => {
    const pages = [
      { page: 1, pending: false as const, items: ['i1', 'i2', 'i3', 'i4', 'i5', 'i6'] },
      { page: 2, pending: false as const, items: ['i7', 'i8'] },
    ]
    const cols = distributeRoundRobin(pages, 3, false)
    expect(cols).toHaveLength(3)

    const runs0 = runsOfColumn(cols[0])
    expect(runs0.length).toBeGreaterThan(0)
    expect(runs0[0].page).toBe(1)

    // includeSlots=true: pending-группа даёт ячейки с item = null — их и рисует
    // сниппет скелетона в PageColumns (при includeSlots=false слоты не попадают в
    // раскладку вовсе, и скелетоны в колонках не появляются — так и было раньше).
    const withPending = [
      { page: 1, pending: false as const, items: ['i1', 'i2'] },
      { page: 2, pending: true as const, slots: 4 },
    ]
    const slotCols = distributeRoundRobin(withPending, 2, true)
    const slots = slotCols.flat().filter((c) => c.item === null)
    expect(slots).toHaveLength(4)
    expect(slotCols.flat().every((c) => c.item === null || typeof c.item === 'string')).toBe(true)
    expect(distributeRoundRobin(withPending, 2, false).flat()).toHaveLength(2)
  })

  it('pendingSide detects above / below pending state', () => {
    const above = [
      { page: 1, pending: true as const, slots: 5 },
      { page: 2, pending: false as const, items: ['a'] },
    ]
    expect(pendingSide(above)).toEqual({ page: 1, side: 'above' })

    const below = [
      { page: 1, pending: false as const, items: ['a'] },
      { page: 2, pending: true as const, slots: 5 },
    ]
    expect(pendingSide(below)).toEqual({ page: 2, side: 'below' })
  })
})

describe('emitter & storage', () => {
  it('createEmitter emit and unsubscribe', () => {
    const e = createEmitter()
    const seen: unknown[] = []
    const off = e.on((ev) => seen.push(ev))
    e.emit({ type: 'empty-page', page: 2 })
    off()
    e.emit({ type: 'empty-page', page: 3 })
    expect(seen).toEqual([{ type: 'empty-page', page: 2 }])
  })

  it('createMemoryStorage read/write', async () => {
    const storage = createMemoryStorage()
    const snap = makeState({ page: 3, totalItems: 57, totalPages: 3 })
    await storage.write('test', snap)
    expect(await storage.read('test')).toEqual(snap)
    expect(await createMemoryStorage().read('nope')).toBeNull()
  })

  it('createLocalStorageStorage deny-safe read/write', async () => {
    const map = new Map<string, string>()
    const ls = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    }
    const storage = createLocalStorageStorage({ storage: ls as any })
    const snap = makeState({
      name: 'lsTest',
      page: 2,
      pageSize: 10,
      totalItems: 30,
      totalPages: 3,
      extra: { sort: 'asc' },
    })
    await storage.write('lsTest', snap)
    expect(map.get('pag:lsTest')).toBeDefined()

    const restored = await storage.read('lsTest')
    expect(restored).toEqual({
      page: 2,
      pageSize: 10,
      totalItems: 30,
      extra: { sort: 'asc' },
    })

    // Corrupted data returns null
    map.set('pag:lsTest', 'not json')
    expect(await storage.read('lsTest')).toBeNull()
  })
})

describe('URL adapter & extra search', () => {
  it('encodeExtraValue & decodeExtraValue', () => {
    expect(encodeExtraValue('hello')).toBe('hello')
    expect(encodeExtraValue(42)).toBe('42')
    expect(encodeExtraValue(true)).toBe('true')
    expect(encodeExtraValue(false)).toBe('false')
    expect(encodeExtraValue(null)).toBe('null')

    expect(decodeExtraValue('hello')).toBe('hello')
    expect(decodeExtraValue('42')).toBe(42)
    expect(decodeExtraValue('true')).toBe(true)
    expect(decodeExtraValue('false')).toBe(false)
    expect(decodeExtraValue('null')).toBeNull()
  })

  it('extraField validators', () => {
    const textSpec = { q: extraField('text') }
    const numSpec = { n: extraField('number') }
    const listSpec = { tags: extraField('list') }

    expect(readPaginatorSearch(new URLSearchParams('page.q=9'), { extra: textSpec }).extra.q).toBe('9')
    expect(readPaginatorSearch(new URLSearchParams('page.n=9'), { extra: numSpec }).extra.n).toBe(9)
    expect(readPaginatorSearch(new URLSearchParams('page.tags=a, b,,c'), { extra: listSpec }).extra.tags).toBe('a,b,c')
    const repeatedList = { tags: commaListSearch(extraField('list')) }
    expect(readPaginatorSearch(new URLSearchParams('page.tags=a&page.tags=b'), { extra: repeatedList }).extra.tags).toBe('a,b')
    const repeatedToggle = { enabled: extraField('boolean') }
    expect(readPaginatorSearch(new URLSearchParams('page.enabled=false&page.enabled=true'), { extra: repeatedToggle }).extra.enabled).toBe(true)
    expect(readPaginatorSearch(new URLSearchParams('page.n=abc'), { extra: numSpec }).extra.n).toBeUndefined()
  })

  it('canonicalPaginatorSearch: пустые объявленные ключи уходят, значения остаются', () => {
    const specs = [
      {
        pageParam: 'page',
        extra: {
          q: extraField('text'),
          'filters.kind': extraField('text'),
          'filters.status': extraField('text'),
        },
      },
    ]
    // Нативная форма без JS отправляет ВСЕ контролы — вот тот самый «список полей».
    const dirty = new URLSearchParams('page=2&page.size=&page.q=&page.filters.kind=tv&page.filters.status=')
    expect(canonicalPaginatorSearch(specs, dirty)?.toString()).toBe('page=2&page.filters.kind=tv')
    // Пустое значение ≠ значащее: `false`/`0` остаются.
    const keep = new URLSearchParams('page.srch=false&page.q=&page.zero=0')
    expect(
      canonicalPaginatorSearch(
        { extra: { q: extraField('text'), srch: extraField('boolean'), zero: extraField('number') } },
        keep,
      )?.toString(),
    ).toBe('page.srch=false&page.zero=0')
    // Чужие ключи не наши: не трогаем даже пустые.
    const foreign = new URLSearchParams('utm_source=&page.q=')
    expect(canonicalPaginatorSearch({ extra: { q: extraField('text') } }, foreign)?.toString()).toBe(
      'utm_source=',
    )
    // Адрес уже канонический — переадресовать нечего.
    expect(canonicalPaginatorSearch(specs, 'page=2&page.filters.kind=tv')).toBeNull()
    // Второй пагинатор на странице чистится своей спецификацией.
    const two = new URLSearchParams('page.q=&gallery=&gallery.cols=')
    expect(
      canonicalPaginatorSearch(
        [{ extra: { q: extraField('text') } }, { pageParam: 'gallery', extra: { cols: extraField('text') } }],
        two,
      )?.toString(),
    ).toBe('')
    // Значение, потерявшее смысл (мусор), НЕ убирается: решение владельца —
    // «мёртвый» ключ живёт в адресе, пока его не тронет сам пользователь.
    expect(canonicalPaginatorSearch(specs, 'page.filters.kind=zzz')).toBeNull()
  })

  it('canonicalSearchRecord: срез роутера приводится к каноническому виду', () => {
    const specs = { extra: { q: extraField('text'), 'filters.kind': extraField('text') } }
    // «Грязный» адрес нативной GET-формы: пустые значения объявленных ключей уходят.
    expect(
      canonicalSearchRecord(specs, {
        page: '2',
        'page.size': '',
        'page.q': '',
        'page.filters.kind': 'tv',
        utm_source: 'x',
      }),
    ).toEqual({ page: '2', 'page.filters.kind': 'tv', utm_source: 'x' })
    // Уже канонический — править нечего (`null`, лишней записи истории не будет).
    expect(canonicalSearchRecord(specs, { page: '2', 'page.filters.kind': 'tv' })).toBeNull()
    // Чужие ключи не наши: пустое значение постороннего ключа остаётся.
    expect(canonicalSearchRecord(specs, { 'page.q': '', utm_source: '' })).toEqual({ utm_source: '' })
  })

  it('чистка адреса — замена записи истории на привязке роутера, без перехода', () => {
    const specs = { q: extraField('text'), 'filters.kind': extraField('text') }
    const adapter = createUrlAdapter({
      name: 'canonicalBind',
      source: sourceOf(async () => ({ items: [] })),
      extraSearch: specs,
    })
    const navigate = vi.fn()
    const syncAddress = vi.fn()
    adapter.setRouter({
      navigate,
      syncAddress,
      currentSearch: () => ({ page: '2', 'page.size': '', 'page.q': '', 'page.filters.kind': 'tv' }),
    })
    // Перехода нет: адрес правится заменой записи истории (`replaceState` слоя
    // роутера), поэтому и `navigate` не вызывается.
    expect(navigate).not.toHaveBeenCalled()
    expect(syncAddress).toHaveBeenCalledTimes(1)
    const opts = syncAddress.mock.calls[0][0] as {
      search: (prev: Record<string, unknown>) => Record<string, unknown>
    }
    expect(opts.search({})).toEqual({ page: '2', 'page.filters.kind': 'tv' })

    // Адрес канонический — шага нет.
    const clean = createUrlAdapter({
      name: 'canonicalClean',
      source: sourceOf(async () => ({ items: [] })),
      extraSearch: specs,
    })
    const syncClean = vi.fn()
    clean.setRouter({
      navigate: vi.fn(),
      syncAddress: syncClean,
      currentSearch: () => ({ page: '2', 'page.filters.kind': 'tv' }),
    })
    expect(syncClean).not.toHaveBeenCalled()

    // Роутер, не умеющий замену записи (или сервер), — адрес просто остаётся как есть.
    const bare = createUrlAdapter({
      name: 'canonicalBare',
      source: sourceOf(async () => ({ items: [] })),
      extraSearch: specs,
    })
    expect(() =>
      bare.setRouter({ navigate: vi.fn(), currentSearch: () => ({ 'page.q': '' }) }),
    ).not.toThrow()
  })

  it('readPaginatorSearch and paginatorSearch', () => {
    const params = new URLSearchParams('page=3&page.size=10&page.q=books')
    const res = readPaginatorSearch(params, {
      pageParam: 'page',
      extra: { q: extraField('text') },
    })
    expect(res.page).toBe(3)
    expect(res.pageSize).toBe(10)
    expect(res.extra.q).toBe('books')

    const parseFn = paginatorSearch({
      pageParam: 'page',
      extra: { q: extraField('text') },
    })
    const out = parseFn(new URLSearchParams('page=4&page.size=20&page.q=shoes'))
    expect(out['page']).toBe(4)
    expect(out['page.size']).toBe(20)
    expect(out['page.q']).toBe('shoes')
  })

  it('createUrlAdapter with custom pageParam', () => {
    const adapter = createUrlAdapter({
      name: 'gallery',
      pageParam: 'gallery',
      pageSize: 12,
      source: sourceOf(async () => ({ items: [] })),
    })
    expect(adapter.pageParam).toBe('gallery')
    expect(adapter.hrefFor(2, { search: {} })).toContain('gallery=2')
  })
})

describe('cursor adapter', () => {
  it('opaque token tracking', async () => {
    const source = {
      id: 'cursorTestSrc',
      capabilities: { offsetRecovery: false, stableAcrossSessions: true },
      load: vi.fn(async ({ cursor }: { cursor?: string; limit: number; extra: Extra; signal?: AbortSignal }) => ({
        items: [`item-for-${cursor ?? 'first'}`],
        nextCursor: cursor ? `token-after-${cursor}` : 'token-1',
        hasNext: true,
      })),
    }

    const adapter = createCursorAdapter({
      name: 'cursorTest',
      source,
    })

    const init = await adapter.getInitial()
    expect(init.page).toBe(1)

    const res = await adapter.loadPage({ page: 2, pageSize: 10, extra: {} })
    expect(res.items).toHaveLength(1)
  })
})

describe('core operations & lifecycle', () => {
  beforeEach(() => {
    resetRegistry()
  })

  it('initPaginator & server hydration', async () => {
    const fake = fakeAdapter({ page: 1, pageSize: 10, totalPages: 5 })
    definePaginator({ name: 'srvTest', adapter: fake.adapter })
    const store = createPaginatorStore()

    const snap = await initServerPaginator(store, 'srvTest')
    expect(snap.page).toBe(1)
    expect(snap.pageSize).toBe(10)
    expect(snap.status).toBe('idle')
    expect(snap.loadedPages).toEqual([1])
  })

  it('goToPage with loading and idle transition', async () => {
    const fake = fakeAdapter({ page: 1 })
    definePaginator({ name: 'goTest', adapter: fake.adapter })
    const store = createPaginatorStore()
    await initPaginator(store, 'goTest')

    await goToPage(store, 'goTest', 2)
    const state = getState(store, 'goTest')
    expect(state.page).toBe(2)
    expect(state.loadedPages).toEqual([2])
    expect(state.status).toBe('idle')
  })

  it('prefetchPage caches data for instant navigation', async () => {
    const fake = fakeAdapter({ page: 1 })
    definePaginator({ name: 'prefTest', adapter: fake.adapter })
    const store = createPaginatorStore()
    await initPaginator(store, 'prefTest')

    await prefetchPage(store, 'prefTest', 2)
    const loadCallsBefore = fake.loadPage.mock.calls.length
    await goToPage(store, 'prefTest', 2)
    expect(fake.loadPage.mock.calls.length).toBe(loadCallsBefore)
  })

  it('loadMore append and prepend', async () => {
    const fake = fakeAdapter({ page: 2 })
    definePaginator({ name: 'moreTest', adapter: fake.adapter })
    const store = createPaginatorStore()
    await initPaginator(store, 'moreTest')
    expect(getState(store, 'moreTest').loadedPages).toEqual([2])

    await loadMore(store, 'moreTest', 1)
    expect(getState(store, 'moreTest').loadedPages).toEqual([2, 3])

    await loadMore(store, 'moreTest', -1)
    expect(getState(store, 'moreTest').loadedPages).toEqual([1, 2, 3])
  })

  it('setPageSize recalculates page index based on first item', async () => {
    const fake = fakeAdapter({ page: 1, pageSize: 20 })
    definePaginator({ name: 'psTest', adapter: fake.adapter })
    const store = createPaginatorStore()
    await initPaginator(store, 'psTest')
    await goToPage(store, 'psTest', 3) // items 40..59

    await setPageSize(store, 'psTest', 5)
    const s = getState(store, 'psTest')
    expect(s.pageSize).toBe(5)
    expect(s.page).toBe(9) // 40/5 + 1
    expect(s.loadedPages).toEqual([9])
  })

  it('setExtra: UI keys update without reload, reloadKeys reset to page 1', async () => {
    const fake = fakeAdapter({ page: 2, pageSize: 20, extra: { kind: 'products' } })
    definePaginator({ name: 'extraTest', adapter: fake.adapter, reloadKeys: ['kind'] })
    const store = createPaginatorStore()
    await initPaginator(store, 'extraTest')

    const loadsBefore = fake.loadPage.mock.calls.length
    await setExtra(store, 'extraTest', { layout: 'columns' })
    expect(getState(store, 'extraTest').extra).toEqual({ kind: 'products', layout: 'columns' })
    expect(fake.loadPage.mock.calls.length).toBe(loadsBefore)

    // Data key triggers reload to page 1
    await setExtra(store, 'extraTest', { kind: 'photos' })
    const s = getState(store, 'extraTest')
    expect(s.page).toBe(1)
    expect(s.loadedPages).toEqual([1])
    expect(s.extra).toEqual({ kind: 'photos', layout: 'columns' })
  })

  it('maxPages limits loaded pages and evicts far side', async () => {
    const source = sourceOf(async ({ page }) => ({ items: [`item${page}`], totalPages: 10 }))
    definePaginator({
      name: 'maxTest',
      adapter: createLocalAdapter({ name: 'maxTest', source, append: true }),
      maxPages: 2,
    })
    const store = createPaginatorStore()
    await initPaginator(store, 'maxTest')
    expect(getState(store, 'maxTest').loadedPages).toEqual([1])

    await loadMore(store, 'maxTest', 1)
    expect(getState(store, 'maxTest').loadedPages).toEqual([1, 2])

    await loadMore(store, 'maxTest', 1) // page 3 evicts page 1
    expect(getState(store, 'maxTest').loadedPages).toEqual([2, 3])
    expect(getState(store, 'maxTest').pages[1]).toBeUndefined()
    expect(getState(store, 'maxTest').pages[3]).toEqual(['item3'])
  })

  it('retry recovers from error', async () => {
    let fail = true
    const fake = fakeAdapter({ page: 1 }, async ({ page }) => {
      if (fail) throw new Error('network failed')
      return { items: [`p${page}`], totalPages: 3 }
    })
    definePaginator({ name: 'errTest', adapter: fake.adapter })
    const store = createPaginatorStore()
    await initPaginator(store, 'errTest')
    expect(getState(store, 'errTest').status).toBe('error')

    fail = false
    await retry(store, 'errTest')
    expect(getState(store, 'errTest').status).toBe('idle')
    expect(getState(store, 'errTest').pages[1]).toEqual(['p1'])
  })
})

describe('extra источника: указатель следующего шага (адресный курсор)', () => {
  beforeEach(() => {
    resetRegistry()
  })

  /** Источник, который на каждой странице отдаёт токен следующего шага. */
  function pointerSource() {
    return sourceOf<string>(async ({ page }) => ({
      items: [`item${page}`],
      hasNext: page < 3,
      // «Дальше некуда» — тоже ответ: пустое значение обязано снять ключ.
      extra: page >= 3 ? { after: '' } : { after: `token-${page}` },
    }))
  }

  it('объявленный ключ дописывается в extra, перезагрузки нет', async () => {
    const source = pointerSource()
    definePaginator({
      name: 'ptrTest',
      adapter: createUrlAdapter<string>({
        name: 'ptrTest',
        source,
        pageSizes: [1],
        extraSearch: { after: extraField('text') },
      }),
    })
    const store = createPaginatorStore()
    await initPaginator(store, 'ptrTest')
    expect(getState(store, 'ptrTest').extra).toEqual({ after: 'token-1' })

    const before = getState(store, 'ptrTest').loadedPages
    await goToPage(store, 'ptrTest', 2)
    const s = getState(store, 'ptrTest')
    expect(s.extra).toEqual({ after: 'token-2' })
    expect(s.loadedPages).toEqual([2])
    expect(before).toEqual([1])
    // Один переход = одна загрузка страницы: указатель не должен её повторять.
    await goToPage(store, 'ptrTest', 3)
    expect(getState(store, 'ptrTest').extra).toEqual({})
  })

  it('непроглашенный ключ источника не попадает в extra (deny-safe + предупреждение)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    definePaginator({
      name: 'ptrUnknown',
      adapter: createUrlAdapter<string>({
        name: 'ptrUnknown',
        source: sourceOf<string>(async () => ({ items: ['a'], extra: { secret: 'x' } })),
        extraSearch: { after: extraField('text') },
      }),
    })
    const store = createPaginatorStore()
    await initPaginator(store, 'ptrUnknown')
    expect(getState(store, 'ptrUnknown').extra).toEqual({})
    expect(warn.mock.calls.flat().join(' ')).toContain('secret')
    warn.mockRestore()
  })

  it('href несёт указатель, даже когда адрес его ещё не знает (ссылка = клик)', () => {
    const adapter = createUrlAdapter<string>({
      name: 'ptrHref',
      source: pointerSource(),
      extraSearch: { after: extraField('text') },
    })
    // SSR: в адресе токена нет (править адрес на сервере нечем), но ссылка обязана
    // вести туда же, куда приведёт клик с JavaScript.
    expect(adapter.hrefFor!(2, { search: { page: 1 }, extra: { after: 'T1' } })).toBe(
      '?page=2&page.after=T1',
    )
    // Адрес сильнее состояния: то, что пользователь принёс в URL, не перезаписывается.
    expect(adapter.hrefFor!(2, { search: { page: 1, 'page.after': 'T0' }, extra: { after: 'T1' } })).toBe(
      '?page=2&page.after=T0',
    )
    // Без extra поведение не меняется вовсе (обратная совместимость).
    expect(adapter.hrefFor!(2, { search: { page: 1 } })).toBe('?page=2')
  })

  it('гейт totals не съедает указатель следующего шага', async () => {
    const source = pointerSource().with(withTotalsGate({ gate: 'total' }))
    const resp = await source.fetchPage({ page: 2, pageSize: 1 }, { total: false })
    expect(resp.totalPages).toBeUndefined()
    expect(resp.extra).toEqual({ after: 'token-2' })
  })
})

/* ─────────────────── Q1: приёмники ошибок (onError) ─────────────────── */

describe('Q1 onError: fan-out, коды, persist', () => {
  it('init-failed: getInitial бросает → config-sink получает конверт', async () => {
    resetRegistry()
    const store = createPaginatorStore()
    const seen: unknown[] = []
    definePaginator({
      name: 'q1-init',
      adapter: {
        async getInitial() {
          throw new Error('rest broke')
        },
        loadPage: async () => ({ items: [] }),
        persist: () => {},
        capabilities: EMPTY_CAPABILITIES,
        capabilitiesFor: () => EMPTY_CAPABILITIES,
      },
      onError: (e) => void seen.push(e),
    })
    await initPaginator(store, 'q1-init')
    expect(seen).toHaveLength(1)
    const e = seen[0] as { lib: string; code: string; cause: Error; ctx: Record<string, unknown> }
    expect([e.lib, e.code, e.cause.message, e.ctx.phase]).toEqual(['paginate', 'init-failed', 'rest broke', 'init'])
  })

  it('load-failed + phase init: первая страница упала — код load-failed', async () => {
    resetRegistry()
    const store = createPaginatorStore()
    const seen: unknown[] = []
    definePaginator({
      name: 'q1-load',
      adapter: {
        async getInitial() {
          return { page: 1, pageSize: 20 }
        },
        loadPage: async () => {
          throw new Error('source down')
        },
        persist: () => {},
        capabilities: EMPTY_CAPABILITIES,
        capabilitiesFor: () => EMPTY_CAPABILITIES,
      },
      onError: (e) => void seen.push(e),
    })
    await initPaginator(store, 'q1-load')
    expect(seen.some((x) => (x as { code: string }).code === 'load-failed')).toBe(true)
    expect((seen[0] as { ctx: Record<string, unknown> }).ctx.phase).toBe('init')
  })

  it('persist-failed: вместо console.warn; бросок sink’а прокинут вверх', () => {
    resetRegistry()
    const store = createPaginatorStore()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const seen: string[] = []
    definePaginator({
      name: 'q1-p',
      adapter: {
        async getInitial() {
          return { page: 1, pageSize: 20 }
        },
        loadPage: async () => ({ items: [] }),
        persist: () => {
          throw new Error('quota')
        },
        capabilities: EMPTY_CAPABILITIES,
        capabilitiesFor: () => EMPTY_CAPABILITIES,
      },
      onError: (e) => seen.push(e.code),
    })
    safePersist(store, 'q1-p')
    expect(seen).toEqual(['persist-failed'])
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
    // бросок — намеренный контракт серверного фатала
    resetRegistry()
    definePaginator({
      name: 'q1-throw',
      adapter: {
        async getInitial() {
          return { page: 1, pageSize: 20 }
        },
        loadPage: async () => ({ items: [] }),
        persist: () => {
          throw new Error('quota')
        },
        capabilities: EMPTY_CAPABILITIES,
        capabilitiesFor: () => EMPTY_CAPABILITIES,
      },
      onError: () => {
        throw new Error('fatal')
      },
    })
    // бросок приёмника ПРОКИНУТ наружу — намеренный контракт серверного фатала
    expect(() => safePersist(store, 'q1-throw')).toThrow('fatal')
  })

  it('onPaginatorError: подписка хоста, отписка уважаема, оба sink’а получают', () => {
    resetRegistry()
    const store = createPaginatorStore()
    const cfg: string[] = []
    const host: string[] = []
    definePaginator({
      name: 'q1-fan',
      adapter: {
        async getInitial() {
          return { page: 1, pageSize: 20 }
        },
        loadPage: async () => ({ items: [] }),
        persist: () => {
          throw new Error('quota')
        },
        capabilities: EMPTY_CAPABILITIES,
        capabilitiesFor: () => EMPTY_CAPABILITIES,
      },
      onError: (e) => cfg.push(e.code),
    })
    const off = onPaginatorError('q1-fan', (e) => host.push(e.code))
    safePersist(store, 'q1-fan')
    expect([cfg, host]).toEqual([['persist-failed'], ['persist-failed']])
    off()
    safePersist(store, 'q1-fan')
    expect(host).toHaveLength(1)
  })
})

describe('withUrlTakeover: адрес на подхвате (S4, Q2 v2)', () => {
  const mkCombo = (storage: ReturnType<typeof createMemoryStorage>) => {
    const source = sourceOf(async () => ({ items: [] }))
    const combo = withUrlTakeover(
      createLocalAdapter<unknown>({ name: 't', source, storage }),
      { name: 't', source, pageSize: 10, extraSearch: { q: extraField('text') }, extraDefaults: { q: '' } },
    )
    const navigate = vi.fn()
    combo.setRouter({ navigate, currentSearch: () => ({}) })
    return { combo, navigate }
  }
  const restored = (page: number, extra: Record<string, unknown>) =>
    ({ page, pageSize: 10, totalItems: null, totalPages: null, extra }) as never

  it('адрес пуст → прошлый заход из storage; persist пишет storage, адрес молчит', async () => {
    const storage = createMemoryStorage()
    await storage.write('t', restored(4, { q: 'store' }))
    const { combo, navigate } = mkCombo(storage)
    const init = await combo.getInitial({ url: '/catalog' })
    expect(init.page).toBe(4)
    expect(init.extra.q).toBe('store')
    await combo.persist({ ...restored(5, { q: 'x' }), items: [], loadedPages: [], pages: {}, status: 'idle' } as never)
    expect(navigate).not.toHaveBeenCalled()
    expect((await storage.read('t'))!.page).toBe(5)
    // Локальная сессия слепа к правкам адреса: внешнего наблюдения нет.
    expect(combo.observeExternal?.({ page: 2 })).toBeNull()
    expect(combo.hrefFor?.(3)).toBeNull()
  })

  it('адрес несёт объявленный ключ → хранилище = адрес; storage не пишется', async () => {
    const storage = createMemoryStorage()
    await storage.write('t', restored(4, { q: 'store' }))
    const { combo, navigate } = mkCombo(storage)
    const init = await combo.getInitial({ url: '/catalog?page=7&page.q=url' })
    expect(init.page).toBe(7)
    expect(init.extra.q).toBe('url')
    await combo.persist({ ...restored(8, { q: 'url' }), items: [], loadedPages: [], pages: {}, status: 'idle' } as never)
    expect(navigate).toHaveBeenCalledTimes(1)
    const call = navigate.mock.calls[0][0] as { replace?: boolean; search: (p: Record<string, unknown>) => Record<string, unknown> }
    expect(call.replace).toBe(true)
    expect(call.search({ utm_source: 'x' })).toEqual({ utm_source: 'x', page: 8, 'page.q': 'url' })
    // Fallback-стор неприкосновенен: «пока url несёт — не используется и не пишется».
    expect((await storage.read('t'))!.page).toBe(4)
    // Внешний адрес наблюдается: страница из него.
    expect(combo.observeExternal?.({ page: 3, 'page.q': 'z' })).toMatchObject({ page: 3 })
    expect(combo.hrefFor?.(3)).toContain('page=3')
  })

  it('undeclared-ключ адреса не перехватывает сессию (deny-safe); пустое значение — тоже', async () => {
    const storage = createMemoryStorage()
    for (const url of ['/c?page.junk=1', '/c?page.q=']) {
      await storage.write('t', restored(4, { q: 'store' }))   // каждое условие — с чистого снапшота
      const { combo, navigate } = mkCombo(storage)
      const init = await combo.getInitial({ url })
      expect(init.page, url).toBe(4)                     // restores из storage, не из адреса
      await combo.persist({ ...restored(6, {}), items: [], loadedPages: [], pages: {}, status: 'idle' } as never)
      expect(navigate, url).not.toHaveBeenCalled()      // адрес локальной сессии не правится
    }
  })

  it('поверхность extraKeys — объединение каналов (форма пишет в стор тем же судом)', () => {
    const storage = createMemoryStorage()
    const { combo } = mkCombo(storage)
    const keys = combo.extraKeys?.() ?? []
    expect(keys).toContain('q')                          // объявлен адресной спецификацией
  })
})
