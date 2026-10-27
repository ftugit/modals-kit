/**
 * Гидрация стора снапшотами: тот же объект снапшота — перемонтирование,
 * живое состояние не трогаем; новый объект — носитель переспросил данные,
 * принимаем свежую первую порцию.
 */
import { describe, expect, test } from 'vitest'
import { createPaginatorStore } from './store.js'
import type { PaginatorState } from './types.js'

const snap = (items: string[]): PaginatorState<string> => ({
  name: 'p',
  page: 1,
  pageSize: 2,
  totalItems: items.length,
  totalPages: 1,
  extra: {},
  loadedPages: [1],
  pages: { 1: items },
  status: 'idle',
  error: null,
  errorCode: null,
  pending: null,
  hasNext: false,
  hasPrev: false,
  reqId: 0,
  capabilities: { totals: true },
})

describe('store.hydrate', () => {
  test('первый снапшот принимается', () => {
    const store = createPaginatorStore()
    store.hydrate('p', snap(['a']))
    expect(store.state<string>('p')().pages[1]).toEqual(['a'])
    expect(store.isHydrated('p')).toBe(true)
  })

  test('тот же объект снапшота живую ячейку не перетирает', () => {
    const store = createPaginatorStore()
    const s = snap(['a'])
    store.hydrate('p', s)
    store.update<string>('p', (prev) => ({ ...prev, pages: { 1: ['a', 'b'] }, loadedPages: [1] }))
    store.hydrate('p', s)
    expect(store.state<string>('p')().pages[1]).toEqual(['a', 'b'])
  })

  test('новый объект снапшота заменяет ячейку свежей первой порцией', () => {
    const store = createPaginatorStore()
    store.hydrate('p', snap(['old']))
    store.hydrate('p', snap(['new']))
    expect(store.state<string>('p')().pages[1]).toEqual(['new'])
  })
})
