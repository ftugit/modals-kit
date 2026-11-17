import { beforeEach, describe, expect, it } from 'vitest'
import { loadMore, rehydratePaginator, replacePaginatorSnapshot } from './core'
import { definePaginator, resetRegistry } from './registry'
import { defineSource } from './source'
import { createPaginatorStore, initialState } from './store'
import type { PaginatorState } from './types'

const snapshot = (over: Partial<PaginatorState<string>> = {}): PaginatorState<string> => ({
  ...initialState<string>('p', 10),
  status: 'idle', loadedPages: [1], pages: { 1: ['old'] }, ...over,
})

beforeEach(() => {
  resetRegistry()
  definePaginator({
    name: 'p', pageSize: 10, extraDefaults: { order: 'desc' },
    source: defineSource<string>({
      name: 'test', record: { id: (s) => s, title: (s) => s, texts: (s) => [s] },
      data: async () => ({ items: [] }),
    }),
  })
})

describe('rehydratePaginator', () => {
  it('гидрирует незарегистрированное имя и первый снимок', () => {
    const store = createPaginatorStore()
    const first = snapshot()
    rehydratePaginator(store, 'unknown', first)
    expect(store.state('unknown')()).toBe(first)
    rehydratePaginator(store, 'p', first)
    expect(store.state('p')()).toBe(first)
  })

  it('обновляет тот же срез, учитывая отсутствующие значения по умолчанию', () => {
    const store = createPaginatorStore()
    rehydratePaginator(store, 'p', snapshot())
    const updated = snapshot({ extra: { order: 'desc' }, pages: { 1: ['new'] } })
    rehydratePaginator(store, 'p', updated)
    expect(store.state<string>('p')().pages[1]).toEqual(['new'])
  })

  it.each([
    ['фильтр в снимке', snapshot({ extra: { filter: 'other' } })],
    ['страница', snapshot({ page: 2 })],
    ['размер', snapshot({ pageSize: 20 })],
  ])('не перезаписывает живой срез: %s', (_label, fresh) => {
    const store = createPaginatorStore()
    const current = snapshot()
    rehydratePaginator(store, 'p', current)
    rehydratePaginator(store, 'p', fresh)
    expect(store.state('p')()).toBe(current)
  })

  it('учитывает ключи, присутствующие только в живом срезе', () => {
    const store = createPaginatorStore()
    const current = snapshot({ extra: { filter: 'old' } })
    rehydratePaginator(store, 'p', current)
    rehydratePaginator(store, 'p', snapshot())
    expect(store.state('p')()).toBe(current)
  })

  it('сохраняет накопленные страницы при SWR того же среза', () => {
    const store = createPaginatorStore()
    const current = snapshot({ loadedPages: [1, 2], pages: { 1: ['a'], 2: ['b'] } })
    rehydratePaginator(store, 'p', current)
    rehydratePaginator(store, 'p', snapshot({ pages: { 1: ['fresh'] } }))
    expect(store.state('p')()).toBe(current)
  })
})

describe('полётные запросы при приёме снимка', () => {
  it('старый ответ после смены uid не перезаписывает новый срез', async () => {
    resetRegistry()
    let resolve!: (value: { items: string[]; hasNext: boolean }) => void
    definePaginator({
      name: 'p', pageSize: 10, append: true,
      source: defineSource<string>({
        name: 'test', record: { id: (s) => s, title: (s) => s, texts: (s) => [s] },
        data: () => new Promise((r) => { resolve = r }),
      }),
    })
    const store = createPaginatorStore()
    const old = snapshot({ extra: { _uid: 'A' }, hasNext: true })
    rehydratePaginator(store, 'p', old)
    const flight = loadMore(store, 'p', 1)
    expect(store.state('p')().status).toBe('loading')
    // Повтор того же снимка не должен отменять полётную загрузку.
    rehydratePaginator(store, 'p', old)
    expect(store.state('p')().status).toBe('loading')
    replacePaginatorSnapshot(store, 'p', snapshot({ extra: { _uid: 'B' }, pages: { 1: ['B'] } }))
    resolve({ items: ['late A'], hasNext: false })
    await flight
    expect(store.state<string>('p')().pages).toEqual({ 1: ['B'] })
    expect(store.state('p')().extra._uid).toBe('B')
  })
})
