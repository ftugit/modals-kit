/**
 * `patchItems` — локальная правка окна без запроса: своя форма уже знает строку,
 * и список обязан показать её на месте, не перезагружаясь.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createPaginatorStore,
  definePaginator,
  getState,
  initPaginator,
  loadMore,
  patchItems,
  resetRegistry,
  setAppendMode,
  type PageRequest,
  type PaginatorAdapter,
} from './index'

type Row = { id: string; v?: number }
const row = (id: string, v?: number): Row => ({ id, v })

/** Коллекция из `total` строк `r1..rN`, страницы по `size`. */
function adapterOf(total: number, size: number, over: Partial<PaginatorAdapter<Row>> = {}) {
  const loadPage = vi.fn(async ({ page }: PageRequest) => ({
    items: Array.from({ length: Math.max(0, Math.min(size, total - (page - 1) * size)) }, (_, i) =>
      row(`r${(page - 1) * size + i + 1}`),
    ),
    totalItems: total,
    totalPages: Math.max(1, Math.ceil(total / size)),
  }))
  const adapter: PaginatorAdapter<Row> = {
    getInitial: async () => ({ page: 1, pageSize: size, extra: {} }),
    loadPage,
    persist: () => {},
    capabilities: { append: true },
    capabilitiesFor: () => ({ totals: true }),
    recordFor: () => ({ id: (r: Row) => r.id, title: (r: Row) => r.id, texts: (r: Row) => [r.id] }),
    ...over,
  }
  return { adapter, loadPage }
}

async function setup(name: string, total: number, size: number, opts: { single?: boolean; page?: number } = {}) {
  const { adapter, loadPage } = adapterOf(total, size, {
    getInitial: async () => ({ page: opts.page ?? 1, pageSize: size, extra: {} }),
  })
  definePaginator<Row>({ name, adapter })
  const store = createPaginatorStore()
  setAppendMode(store, name, !opts.single)
  await initPaginator<Row>(store, name)
  return {
    store,
    loadPage,
    ids: () =>
      getState<Row>(store, name).loadedPages.flatMap((p) => getState<Row>(store, name).pages[p]!.map((r) => r.id)),
  }
}

describe('patchItems', () => {
  beforeEach(() => resetRegistry())

  it('постраничный режим, стр. 1: вставка в голову держит размер страницы и сдвигает счётчики', async () => {
    const { store, ids, loadPage } = await setup('p1', 6, 3, { single: true })
    const calls = loadPage.mock.calls.length
    expect(patchItems<Row>(store, 'p1', { insert: row('new'), at: 'head' })).toBe(true)
    expect(ids()).toEqual(['new', 'r1', 'r2'])
    const s = getState<Row>(store, 'p1')
    expect([s.totalItems, s.totalPages, s.hasNext]).toEqual([7, 3, true])
    // Ни одного запроса: правка локальная.
    expect(loadPage.mock.calls.length).toBe(calls)
  })

  it('постраничный режим, стр. 2: голова вне окна — меняются только счётчики', async () => {
    const { store, ids } = await setup('p2', 6, 3, { single: true, page: 2 })
    expect(ids()).toEqual(['r4', 'r5', 'r6'])
    expect(patchItems<Row>(store, 'p2', { insert: row('new'), at: 'head' })).toBe(false)
    expect(ids()).toEqual(['r4', 'r5', 'r6'])
    const s = getState<Row>(store, 'p2')
    // Шесть записей были ровно двумя страницами; седьмая открывает третью.
    expect([s.totalItems, s.totalPages, s.hasNext]).toEqual([7, 3, true])
  })

  it('хвост: на последней неполной странице запись дописывается, на полной — открывает следующую', async () => {
    const a = await setup('t1', 5, 3, { single: true, page: 2 })
    expect(patchItems<Row>(a.store, 't1', { insert: row('new'), at: 'tail' })).toBe(true)
    expect(a.ids()).toEqual(['r4', 'r5', 'new'])
    expect(getState<Row>(a.store, 't1').hasNext).toBe(false)

    const b = await setup('t2', 6, 3, { single: true, page: 2 })
    expect(patchItems<Row>(b.store, 't2', { insert: row('new'), at: 'tail' })).toBe(false)
    expect(b.ids()).toEqual(['r4', 'r5', 'r6'])
    expect(getState<Row>(b.store, 't2').hasNext).toBe(true)
  })

  it('режим накопления: голова вставляется без обрезки, хвост — когда конец загружен', async () => {
    const { store, ids } = await setup('acc', 4, 2)
    await loadMore<Row>(store, 'acc', 1)
    expect(ids()).toEqual(['r1', 'r2', 'r3', 'r4'])
    expect(patchItems<Row>(store, 'acc', { insert: row('h'), at: 'head' })).toBe(true)
    expect(ids()).toEqual(['h', 'r1', 'r2', 'r3', 'r4'])
    // Конец подтверждён ответом (стр. 2 из 2) — хвост в окне, запись дописывается.
    expect(getState<Row>(store, 'acc').hasNext).toBe(false)
    expect(patchItems<Row>(store, 'acc', { insert: row('t'), at: 'tail' })).toBe(true)
    expect(ids()).toEqual(['h', 'r1', 'r2', 'r3', 'r4', 't'])
    expect(getState<Row>(store, 'acc').totalItems).toBe(6)
  })

  it('та же запись уже в окне (её принёс опрос) — обновление, а не копия и не +1', async () => {
    const { store, ids } = await setup('dup', 6, 3, { single: true })
    expect(patchItems<Row>(store, 'dup', { insert: row('r2', 9), at: 'head' })).toBe(true)
    expect(ids()).toEqual(['r1', 'r2', 'r3'])
    expect(getState<Row>(store, 'dup').pages[1]![1]!.v).toBe(9)
    expect(getState<Row>(store, 'dup').totalItems).toBe(6)
  })

  it('update заменяет запись на месте; неизвестный id — без изменений', async () => {
    const { store } = await setup('up', 6, 3, { single: true })
    expect(patchItems<Row>(store, 'up', { update: row('r3', 1) })).toBe(true)
    expect(getState<Row>(store, 'up').pages[1]![2]).toEqual(row('r3', 1))
    const before = getState<Row>(store, 'up')
    expect(patchItems<Row>(store, 'up', { update: row('zzz', 1) })).toBe(false)
    expect(getState<Row>(store, 'up')).toBe(before)
  })

  it('remove убирает запись и двигает счётчики; запись вне окна — только счётчики', async () => {
    const { store, ids } = await setup('rm', 4, 2, { single: true })
    expect(patchItems<Row>(store, 'rm', { remove: 'r1' })).toBe(true)
    expect(ids()).toEqual(['r2'])
    let s = getState<Row>(store, 'rm')
    expect([s.totalItems, s.totalPages, s.hasNext]).toEqual([3, 2, true])
    expect(patchItems<Row>(store, 'rm', { remove: 'r4' })).toBe(false)
    s = getState<Row>(store, 'rm')
    expect([s.totalItems, s.totalPages, s.hasNext]).toEqual([2, 1, false])
  })

  it('без паспорта записи правка отказывает, а не угадывает идентичность', async () => {
    const { adapter } = adapterOf(3, 3, { recordFor: undefined })
    definePaginator<Row>({ name: 'nor', adapter })
    const store = createPaginatorStore()
    await initPaginator<Row>(store, 'nor')
    expect(() => patchItems<Row>(store, 'nor', { remove: 'r1' })).toThrow(/recordFor/)
  })
})
