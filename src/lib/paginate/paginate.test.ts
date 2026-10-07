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
  decodeExtraValue,
  definePaginator,
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
  readPaginatorSearch,
  resetPaginator,
  resetRegistry,
  retry,
  runsOfColumn,
  setExtra,
  setPageSize,
  viewState,
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
    ...overrides,
  }
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
  const adapter = { getInitial, loadPage, persist, capabilities: { append: true } }
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
    expect(readPaginatorSearch(new URLSearchParams('page.n=abc'), { extra: numSpec }).extra.n).toBeUndefined()
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
      source: async () => ({ items: [] }),
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
    const source = async ({ page }: PageRequest) => ({ items: [`item${page}`], totalPages: 10 })
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
