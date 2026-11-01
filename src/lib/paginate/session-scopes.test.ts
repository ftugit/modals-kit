import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { claimQuery, resetQueryClaims } from '#lib/address/keys.js'
import {
  acquireScopedStore,
  createUrlAdapter,
  definePaginator,
  defineSource,
  extraField,
  findScopedStore,
  getClientStore,
  getState,
  initPaginator,
  invalidatePaginator,
  linkFor,
  listLiveStores,
  releaseScopedStore,
  resetClientStore,
  resetRegistry,
  resetScopedStores,
  setExtra,
  setSessionTransport,
  type MinimalRouter,
} from './index'
import { clearSearchQuery, defineSearch, resetSearchRegistry, setSearchQuery } from './search/index'

describe('scopes & session transports (1.6–1.9)', () => {
  beforeEach(() => {
    resetQueryClaims()
    resetRegistry()
    resetSearchRegistry()
    resetClientStore()
    resetScopedStores()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('isolates scoped stores on SSR without retaining entries in module Map', () => {
    vi.stubGlobal('window', undefined)
    const a = acquireScopedStore('0:user.list')
    const b = acquireScopedStore('0:user.list')
    expect(a).not.toBe(b)
    expect(findScopedStore('0:user.list')).toBeUndefined()
    expect(listLiveStores()).toEqual([])
    releaseScopedStore('0:user.list')
  })

  it('ref-counts scoped stores in browser and lists clientStore + live scoped stores', () => {
    vi.stubGlobal('window', {})
    const client = getClientStore()
    const s1 = acquireScopedStore('0:user.list')
    const s1Again = acquireScopedStore('0:user.list')
    const s2 = acquireScopedStore('1:user.picker')

    expect(s1Again).toBe(s1)
    expect(findScopedStore('0:user.list')).toBe(s1)
    expect(listLiveStores()).toEqual([client, s1, s2])

    releaseScopedStore('0:user.list')
    expect(findScopedStore('0:user.list')).toBe(s1)

    releaseScopedStore('0:user.list')
    expect(findScopedStore('0:user.list')).toBeUndefined()
    expect(listLiveStores()).toEqual([client, s2])

    releaseScopedStore('1:user.picker')
    expect(listLiveStores()).toEqual([client])
  })

  it('isolates page URL adapter (users.*) from modal session adapter (m0.users.*) and memory session (url: false)', async () => {
    vi.stubGlobal('window', { location: { search: '?users=2&users.q=alice&modal=user.list&m0.users=3&m0.users.q=bob' } })
    claimQuery('modals', 'modal', 'm0.*')

    const calls: Array<{ page: number; pageSize: number; q?: unknown }> = []
    const src = defineSource<{ id: string }>({
      name: 'users-src',
      record: { id: (r) => r.id, title: (r) => r.id, texts: (r) => [r.id] },
      search: { minLength: 1 },
      totals: true,
      data: async ({ page, pageSize }, input) => {
        calls.push({ page, pageSize, q: input.q })
        return { items: [{ id: `${input.q ?? 'all'}-${page}` }], totalItems: 30, totalPages: 6 }
      },
    })

    const baseAdapter = createUrlAdapter({
      name: 'seed-users',
      pageParam: 'users',
      pageSize: 5,
      pageSizes: [5, 10, 20],
      source: src,
      extraSearch: { q: extraField('text') },
      extraDefaults: { q: '' },
    })

    definePaginator({
      name: 'seed-users',
      adapter: baseAdapter,
      pageSize: 5,
      reloadKeys: ['q'],
    })

    let currentUrl = '?users=2&users.q=alice&modal=user.list&m0.users=3&m0.users.q=bob'
    const makeRouter = (): MinimalRouter => ({
      currentSearch: () => Object.fromEntries(new URLSearchParams(currentUrl)),
      navigate: ({ search }) => {
        const next = search(Object.fromEntries(new URLSearchParams(currentUrl)))
        const p = new URLSearchParams()
        for (const [k, v] of Object.entries(next)) if (v != null) p.set(k, String(v))
        currentUrl = p.toString() ? `?${p.toString()}` : ''
      },
      syncAddress: ({ search }) => {
        const next = search(Object.fromEntries(new URLSearchParams(currentUrl)))
        const p = new URLSearchParams()
        for (const [k, v] of Object.entries(next)) if (v != null) p.set(k, String(v))
        currentUrl = p.toString() ? `?${p.toString()}` : ''
      },
    })

    // 1. Page store reads users.*
    const pageStore = getClientStore()
    const pageRouter = makeRouter()
    baseAdapter.setRouter(pageRouter)
    await initPaginator(pageStore, 'seed-users')
    expect(getState(pageStore, 'seed-users').page).toBe(2)
    expect(getState(pageStore, 'seed-users').extra.q).toBe('alice')

    // 2. Modal store (0:user.list) uses m0.users.* with shared queryOwner: 'modals'
    const modalStore = acquireScopedStore('0:user.list')
    const modalAdapter = baseAdapter.forSession!({ pageParam: 'm0.users', queryOwner: 'modals' }) as typeof baseAdapter
    const modalRouter = makeRouter()
    modalAdapter.setRouter(modalRouter)
    setSessionTransport(modalStore, 'seed-users', modalAdapter)

    await initPaginator(modalStore, 'seed-users')
    expect(getState(modalStore, 'seed-users').page).toBe(3)
    expect(getState(modalStore, 'seed-users').extra.q).toBe('bob')
    expect(linkFor('seed-users', { page: 4 }, { store: modalStore })).toContain('m0.users=4')
    expect(linkFor('seed-users', { page: 4 }, { store: pageStore })).toContain('users=4')

    // clearRouter only detaches matching owner
    baseAdapter.clearRouter(modalRouter)
    await setExtra(pageStore, 'seed-users', { q: 'carol' })
    expect(currentUrl).toContain('users.q=carol')
    expect(currentUrl).toContain('m0.users.q=bob')

    // 3. Picker store (1:user.picker) uses url: false (pure memory, zero URL touch)
    const pickerStore = acquireScopedStore('1:user.picker')
    const pickerAdapter = baseAdapter.forSession!({ url: false })
    setSessionTransport(pickerStore, 'seed-users', pickerAdapter)
    await initPaginator(pickerStore, 'seed-users')
    expect(getState(pickerStore, 'seed-users').page).toBe(1)
    expect(getState(pickerStore, 'seed-users').extra.q).toBe('')
    expect(linkFor('seed-users', { page: 2 }, { store: pickerStore })).toBeNull()

    const urlBeforePicker = currentUrl
    defineSearch({ name: 'seed-users', source: src })
    await setSearchQuery('seed-users', 'dave', pickerStore)
    expect(getState(pickerStore, 'seed-users').extra.q).toBe('dave')
    expect(getState(pageStore, 'seed-users').extra.q).toBe('carol')
    expect(getState(modalStore, 'seed-users').extra.q).toBe('bob')
    expect(currentUrl).toBe(urlBeforePicker)

    await clearSearchQuery('seed-users', pickerStore)
    expect(getState(pickerStore, 'seed-users').extra.q).toBe('')
    expect(currentUrl).toBe(urlBeforePicker)
  })

  it('updates extra + pageSize atomically in setExtra and invalidates all live stores safely', async () => {
    vi.stubGlobal('window', { location: { search: '' } })

    // C2.1: unregistered paginator is a safe no-op
    await expect(invalidatePaginator('not-registered-yet')).resolves.toBeUndefined()

    const fetches: Array<{ page: number; pageSize: number; q?: unknown }> = []
    const src = defineSource<{ id: string }>({
      name: 'atomic-src',
      record: { id: (r) => r.id, title: (r) => r.id, texts: (r) => [r.id] },
      search: { minLength: 1 },
      totals: true,
      data: async ({ page, pageSize }, input) => {
        fetches.push({ page, pageSize, q: input.q })
        return { items: [{ id: `${fetches.length}` }], totalItems: 20, totalPages: 2 }
      },
    })

    const adapter = createUrlAdapter({
      name: 'atomic-list',
      pageParam: 'items',
      pageSize: 5,
      pageSizes: [5, 10],
      source: src,
      extraSearch: { q: extraField('text') },
      extraDefaults: { q: '' },
    })
    let persistedCount = 0
    adapter.setRouter({
      currentSearch: () => ({}),
      navigate: () => {
        persistedCount += 1
      },
      syncAddress: () => {
        persistedCount += 1
      },
    })

    definePaginator({
      name: 'atomic-list',
      adapter,
      pageSize: 5,
      reloadKeys: ['q'],
    })

    const pageStore = getClientStore()
    await initPaginator(pageStore, 'atomic-list')
    fetches.length = 0
    persistedCount = 0

    // Atomic extra + pageSize update -> 1 persist + 1 fetch
    await setExtra(pageStore, 'atomic-list', { q: 'neo' }, { pageSize: 10 })
    expect(fetches).toEqual([{ page: 1, pageSize: 10, q: 'neo' }])
    expect(persistedCount).toBe(1)
    expect(getState(pageStore, 'atomic-list').pageSize).toBe(10)

    // Live scoped store alongside pageStore: invalidatePaginator refreshes BOTH with their own extra/pageSize
    const scopedStore = acquireScopedStore('0:items.modal')
    setSessionTransport(scopedStore, 'atomic-list', adapter.forSession!({ url: false }))
    await initPaginator(scopedStore, 'atomic-list')
    fetches.length = 0

    await invalidatePaginator('atomic-list')
    expect(fetches).toEqual([
      { page: 1, pageSize: 10, q: 'neo' },
      { page: 1, pageSize: 5, q: '' },
    ])
  })
})
