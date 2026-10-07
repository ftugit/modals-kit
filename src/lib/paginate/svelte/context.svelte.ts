// Svelte 5 reactive context & hooks for paginator.
import { getContext, setContext, untrack } from 'svelte'
import { createAnchorRegistry } from '../anchors'
import type { AnchorRegistry, TriggerZone } from '../anchors'
import {
  getState,
  goToPage,
  initPaginator,
  loadMore,
  onExternalPage,
  prefetchPage,
  reportAnchor,
  resetPaginator,
  retry,
  scrollToPage,
  setExtra,
  setPageSize,
} from '../core'
import {
  canGo,
  canLoadMore,
  flattenPages,
  pagesList,
  pickCurrentPage,
  viewState as deriveViewState,
} from '../pure'
import { getPaginator } from '../registry'
import { sourceCapabilities, type SourceCapabilities } from '../source'
import { createPaginatorStore, getClientStore, type Store } from '../store'
import type { Extra, ExtraValue, PageGroup, PaginatorEvent, PaginatorState, ViewState } from '../types'

export type EdgeTrigger = 'off' | 'direction' | 'edge' | 'chat' | 'manual'
export type PrependBehavior = 'auto' | 'native' | 'js'

export type ResolvedHostOptions = {
  mode: 'accumulate' | 'single'
  topTrigger: EdgeTrigger
  bottomTrigger: EdgeTrigger
  topZone: TriggerZone
  bottomZone: TriggerZone
  prependBehavior: PrependBehavior
  /** Минимальное время показа скелетонов подгрузки, мс (см. <PaginatorHost pendingDelayMs>). */
  pendingDelayMs: number
}

export const DEFAULT_HOST_OPTIONS: ResolvedHostOptions = {
  mode: 'accumulate',
  topTrigger: 'direction',
  bottomTrigger: 'direction',
  topZone: '40%',
  bottomZone: '40%',
  prependBehavior: 'auto',
  // 300 мс: демо-источник отвечает за ~20 мс — это меньше кадра, и без «пола»
  // скелетоны жили бы один кадр. Значение по умолчанию — только у хоста Svelte.
  pendingDelayMs: 300,
}

export type PaginatorContextValue = {
  name: string
  store: Store
  anchors: AnchorRegistry
  requestMore?: (dir: 1 | -1) => void
  currentSearch?: () => Record<string, unknown> | null
  hashAnchor?: string | null
  options?: () => ResolvedHostOptions
}

export const PAGINATOR_CTX_KEY = Symbol('paginator-ctx')
export const SCOPE_CTX_KEY = Symbol('paginator-scope-ctx')

export function setPaginatorContext(value: PaginatorContextValue): void {
  setContext(PAGINATOR_CTX_KEY, value)
}

export function getPaginatorContext(): PaginatorContextValue | undefined {
  return getContext<PaginatorContextValue>(PAGINATOR_CTX_KEY)
}

export function setScopeStore(store: Store): void {
  setContext(SCOPE_CTX_KEY, store)
}

export function useScopeStore(): Store {
  const scopeStore = getContext<Store>(SCOPE_CTX_KEY)
  if (scopeStore) return scopeStore
  return typeof window !== 'undefined' ? getClientStore() : createPaginatorStore()
}

export function hashAnchorFor(name: string): string {
  return `paginator-${name}`
}

const noopAnchors: AnchorRegistry = {
  observe() {},
  unobserve() {},
  setTracker() {},
  getElement: () => null,
}

export function useCtx(component: string, name?: string): PaginatorContextValue {
  const ctx = getPaginatorContext()
  if (name && (!ctx || ctx.name !== name)) {
    getPaginator(name) // R17: throw on unknown
    return { name, store: useScopeStore(), anchors: noopAnchors, hashAnchor: hashAnchorFor(name) }
  }
  if (!ctx) throw new Error(`${component} must be used inside <PaginatorHost> or receive name`)
  return ctx
}

export type StateAccessor<T> = (() => PaginatorState<T>) & {
  readonly current: PaginatorState<T>
}

/**
 * Реактивное состояние пагинатора на Svelte 5 runes.
 * Работает и как вызов `state().page`, и как геттер `state.current.page`.
 */
/**
 * Возможности источника текущего выбора: «что источник умеет». UI/панель обязаны
 * спрашивать здесь, а не угадывать: чего нет — то выключается, а не показывается
 * кнопкой-обманкой. Реактивно к `extra`: у переключателя источников возможности
 * меняются вместе с выбранным `kind`.
 */
export function usePaginatorCapabilities(name?: string): () => SourceCapabilities {
  const ctx = useCtx('usePaginatorCapabilities', name)
  const state = usePaginatorState<unknown>(ctx.name)
  return () => sourceCapabilities(getPaginator(ctx.name).source ?? undefined, state().extra)
}

export function usePaginatorState<T>(name?: string): StateAccessor<T> {
  const ctx = useCtx('usePaginatorState', name)
  const resolvedName = ctx.name
  const store = ctx.store

  let internalState = $state.raw<PaginatorState<T>>(getState<T>(store, resolvedName))

  $effect(() => {
    internalState = getState<T>(store, resolvedName)
    const unsub = store.subscribe?.(resolvedName, (next) => {
      internalState = next as PaginatorState<T>
    })
    return () => unsub?.()
  })

  const getter = () => internalState
  Object.defineProperty(getter, 'current', {
    get: () => internalState,
    enumerable: true,
  })

  return getter as StateAccessor<T>
}

export function usePaginatorOptions(name?: string): () => ResolvedHostOptions {
  const ctx = useCtx('usePaginatorOptions', name)
  return ctx.options ?? (() => DEFAULT_HOST_OPTIONS)
}

export function usePaginatorItems<T>(name?: string): () => T[] {
  const state = usePaginatorState<T>(name)
  const items = $derived(flattenPages(state()))
  return () => items
}

export function usePaginatorPages<T>(name?: string): () => PageGroup<T>[] {
  const state = usePaginatorState<T>(name)
  let prevGroups: PageGroup<T>[] = []
  const pages = $derived.by(() => {
    prevGroups = pagesList(state(), prevGroups)
    return prevGroups
  })
  return () => pages
}

export function usePaginatorViewState(name?: string): () => ViewState {
  const state = usePaginatorState<unknown>(name)
  return () => deriveViewState(state())
}

export type PaginatorActions = {
  goPage(page: number): void
  loadMore(dir: 1 | -1): void
  retry(): void
  reset(): void
  scrollToPage(page: number): void
  prefetchPage(page: number): void
  setPageSize(pageSize: number): void
  /** Патч extra: `undefined` — удалить ключ (снятие фильтра/переключение источника). */
  setExtra(patch: Record<string, ExtraValue | undefined>, options?: { reload?: boolean }): void
  loadPrev(): void
  requestMore(dir: 1 | -1): void
}

export function usePaginatorActions(nameArg?: string): PaginatorActions {
  const { name, store, requestMore } = useCtx('usePaginatorActions', nameArg)
  const req = (dir: 1 | -1) => (requestMore ? requestMore(dir) : void loadMore(store, name, dir))
  return {
    loadPrev: () => req(-1),
    requestMore: req,
    goPage: (page) => void goToPage(store, name, page),
    loadMore: (dir) => void loadMore(store, name, dir),
    retry: () => void retry(store, name),
    reset: () => void resetPaginator(store, name),
    scrollToPage: (page) => scrollToPage(store, name, page),
    prefetchPage: (page) => void prefetchPage(store, name, page),
    setPageSize: (pageSize) => void setPageSize(store, name, pageSize),
    setExtra: (patch, options) => void setExtra(store, name, patch, options),
  }
}

export function usePaginatorEvents(handler: (event: PaginatorEvent) => void, name?: string): void {
  const ctx = useCtx('usePaginatorEvents', name)
  $effect(() => {
    const unsub = getPaginator(ctx.name).emitter.on((event) => handler(event))
    return () => unsub()
  })
}

export function usePageHref(
  page: number | (() => number),
  name?: string,
): () => string | null {
  const ctx = useCtx('usePageHref', name)
  const pageOf = () => (typeof page === 'function' ? page() : page)
  const adapter = getPaginator(ctx.name).adapter
  if (!adapter.hrefFor) return () => null
  const currentSearch = ctx.currentSearch
  const hash = ctx.hashAnchor ? `#${ctx.hashAnchor}` : ''

  return () => {
    const p = pageOf()
    const search = currentSearch?.() ?? undefined
    const href = adapter.hrefFor!(p, { search })
    return href == null ? null : href + hash
  }
}

export function usePaginator<T>(name: string) {
  const state = usePaginatorState<T>(name)
  const items = usePaginatorItems<T>(name)
  const pages = usePaginatorPages<T>(name)
  const viewState = usePaginatorViewState(name)
  const actions = usePaginatorActions(name)

  return {
    state,
    items,
    pages,
    viewState,
    totalPages: () => state().totalPages,
    actions,
  }
}
