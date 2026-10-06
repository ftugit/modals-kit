// Хранилище состояния пагинатора (чистый vanilla Store без привязки к фреймворку).
// Дескрипторы модульно кэшируются по name ВНУТРИ экземпляра store: отдельный store на
// запрос (SSR-конкурентность) и глобальный клиентский (состояние переживает unmount хоста).
import type { Extra, PaginatorState } from './types'

export function initialState<T>(
  name: string,
  pageSize: number,
  extra: Extra = {},
): PaginatorState<T> {
  return {
    name,
    page: 1,
    pageSize,
    extra,
    totalItems: null,
    totalPages: null,
    loadedPages: [],
    pages: {},
    status: 'init',
    error: null,
    pending: null,
    hasNext: null,
    hasPrev: null,
    reqId: 0,
  }
}

type Cell = {
  current: PaginatorState<unknown>
  listeners: Set<(s: PaginatorState<unknown>) => void>
}

/**
 * Store = контейнер состояний по name + гидрация «один раз на имя»:
 * повторный snapshot того же name игнорируется — живое состояние клиента
 * не затирается stale-данными навигации.
 */
export type Store = {
  /** Функция чтения состояния (getter). */
  state<T>(name: string, pageSize?: number): () => PaginatorState<T>
  /** Иммутабельный патч состояния. */
  update<T>(name: string, fn: (prev: PaginatorState<T>) => PaginatorState<T>): void
  /** Гидрация SSR-снапшотом: применяется ОДИН раз на имя. */
  hydrate<T>(name: string, snapshot: PaginatorState<T>): void
  /** Была ли гидрация по этому имени (для инспекции/тестов). */
  isHydrated(name: string): boolean
  /** Подписка на изменение состояния ячейки (для адаптеров реактивности). */
  subscribe?<T>(name: string, listener: (state: PaginatorState<T>) => void): () => void
}

export function createPaginatorStore(): Store {
  const cells = new Map<string, Cell>()
  const hydrated = new Set<string>()

  function cell(name: string, pageSize = 20): Cell {
    let c = cells.get(name)
    if (!c) {
      c = {
        current: initialState(name, pageSize),
        listeners: new Set(),
      }
      cells.set(name, c)
    }
    return c
  }

  return {
    state<T>(name: string, pageSize?: number): () => PaginatorState<T> {
      const c = cell(name, pageSize)
      return () => c.current as PaginatorState<T>
    },
    update<T>(name: string, fn: (prev: PaginatorState<T>) => PaginatorState<T>): void {
      const c = cell(name)
      const next = fn(c.current as PaginatorState<T>) as PaginatorState<unknown>
      if (next !== c.current) {
        c.current = next
        for (const listener of c.listeners) listener(next)
      }
    },
    hydrate<T>(name: string, snapshot: PaginatorState<T>): void {
      if (hydrated.has(name)) return
      hydrated.add(name)
      const c = cell(name, snapshot.pageSize)
      const next = snapshot as PaginatorState<unknown>
      c.current = next
      for (const listener of c.listeners) listener(next)
    },
    isHydrated(name: string): boolean {
      return hydrated.has(name)
    },
    subscribe<T>(name: string, listener: (state: PaginatorState<T>) => void): () => void {
      const c = cell(name)
      const l = listener as (s: PaginatorState<unknown>) => void
      c.listeners.add(l)
      return () => {
        c.listeners.delete(l)
      }
    },
  }
}

/**
 * Глобальный клиентский store: пагинатор живёт между mount/unmount хоста.
 * Только клиент; на сервере — свой store на каждый запрос/рендер (createPaginatorStore()).
 */
let clientStore: Store | null = null

export function getClientStore(): Store {
  if (!clientStore) clientStore = createPaginatorStore()
  return clientStore
}

/** Только для тестов: сброс глобального клиентского store. */
export function resetClientStore(): void {
  clientStore = null
}
