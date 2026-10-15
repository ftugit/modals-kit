/**
 * `#lib/paginate` under React Router: the `MinimalRouter` (three functions) and
 * the hooks of `svelte/context.svelte.ts` over `useSyncExternalStore`.
 *
 * `usePaginatorHost` repeats the address → paginator part of
 * `svelte/PaginatorHost.svelte` (external page from the address). That part is
 * framework-free logic living in a Svelte component; here it had to be copied
 * (audit finding: move it into the core as one function).
 * Scroll driving, edge sentinels, prepend scroll hold — DOM work of the host —
 * are not repeated.
 */
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import {
  viewState as deriveViewState,
  flattenPages,
  getPaginator,
  getState,
  goToPage,
  initPaginator,
  loadMore,
  onExternalPage,
  resetPaginator,
  retry,
  setExtra,
  setPageSize,
  type Extra,
  type MinimalRouter,
  type PaginatorState,
  type Store,
} from '#lib/paginate/index.js'
import type { RouterAddress } from './address'

/* ── router glue: copy of paginate/sveltekit/router.ts minus `$app` ───── */

function hrefOf(pathname: string, search: Record<string, unknown>): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(search)) {
    if (v == null) continue
    if (Array.isArray(v)) for (const item of v) params.append(k, String(item))
    else params.set(k, String(v))
  }
  const qs = params.toString()
  return `${pathname}${qs ? `?${qs}` : ''}`
}
const searchOf = (url: URL): Record<string, unknown> => Object.fromEntries(url.searchParams)

export function routerPaginateRouter(addr: RouterAddress): MinimalRouter {
  return {
    navigate(opts) {
      return addr.writer.write((cur) => ({ url: hrefOf(cur.url.pathname, opts.search(searchOf(cur.url))) }), {
        replace: opts.replace ?? true,
        load: true,
      })
    },
    syncAddress(opts) {
      void addr.writer.write((cur) => ({ url: hrefOf(cur.url.pathname, opts.search(searchOf(cur.url))) }), {
        replace: true,
      })
    },
    currentSearch: () => searchOf(addr.writer.visible().url),
  }
}

/* ── state hooks ──────────────────────────────────────────────────────── */

export function usePaginatorState<T>(store: Store, name: string): PaginatorState<T> {
  const subscribe = useMemo(() => (fn: () => void) => store.subscribe!(name, fn), [store, name])
  const read = () => getState<T>(store, name)
  return useSyncExternalStore(subscribe, read, read)
}

export function usePaginatorItems<T>(store: Store, name: string): T[] {
  const state = usePaginatorState<T>(store, name)
  return useMemo(() => flattenPages(state), [state])
}

export function usePaginatorViewState(store: Store, name: string) {
  return deriveViewState(usePaginatorState(store, name))
}

export function usePaginatorActions(store: Store, name: string) {
  return useMemo(
    () => ({
      goPage: (page: number) => void goToPage(store, name, page),
      loadMore: (dir: 1 | -1) => void loadMore(store, name, dir),
      retry: () => void retry(store, name),
      reset: () => void resetPaginator(store, name),
      setPageSize: (size: number) => void setPageSize(store, name, size),
      setExtra: (patch: Extra, options?: { reload?: boolean }) => void setExtra(store, name, patch, options),
    }),
    [store, name],
  )
}

/* ── host: init + address → paginator ─────────────────────────────────── */

/** The address search as a stable string snapshot (visible intent included). */
function useVisibleSearch(addr: RouterAddress | null): string {
  const subscribe = useMemo(
    // `visible()` = router reality + the writer's pending intent. The writer only
    // announces intent; a foreign navigation is announced by the router. Svelte
    // gets both for free (reading `page` inside `$derived`); here both are explicit.
    () => (fn: () => void) => {
      if (!addr) return () => {}
      const offIntent = addr.writer.subscribe(fn)
      const offRouter = addr.onChange(fn)
      return () => {
        offIntent()
        offRouter()
      }
    },
    [addr],
  )
  const read = () => (addr ? addr.writer.visible().url.search : '')
  return useSyncExternalStore(subscribe, read, read)
}

export function usePaginatorHost(store: Store, name: string, addr: RouterAddress | null): void {
  const instance = getPaginator(name)
  const adapter = instance.adapter as {
    setRouter?: (router: MinimalRouter | null) => void
    observeExternal?: (search: Record<string, unknown>) => { page?: number | null } | null
    searchSpec?: { pageParam?: string }
  }
  const bindsUrl = typeof adapter.setRouter === 'function' && addr !== null

  useEffect(() => {
    if (bindsUrl) adapter.setRouter!(routerPaginateRouter(addr!))
    // The first page comes from the injected router (set just above): the URL
    // adapter asks it before `window.location`.
    void initPaginator(store, name)
    return () => {
      if (bindsUrl) adapter.setRouter!(null)
    }
  }, [store, name]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── copied from PaginatorHost.svelte: `effectiveExternalPage` ──
  const search = useVisibleSearch(bindsUrl ? addr : null)
  const externalPage = useMemo((): number | null => {
    if (!bindsUrl) return null
    const record = Object.fromEntries(new URLSearchParams(search))
    const observed = adapter.observeExternal?.(record)
    if (observed && observed.page != null) return observed.page
    const raw = record[adapter.searchSpec?.pageParam ?? 'page']
    if (raw == null) return null
    const n = Number(raw)
    return Number.isInteger(n) && n >= 1 ? n : null
  }, [search, bindsUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  // The first value is the page init already reads from the address.
  const prev = useRef<number | null | undefined>(undefined)
  useEffect(() => {
    if (externalPage === prev.current) return
    const first = prev.current === undefined
    prev.current = externalPage
    if (first) return
    if (externalPage != null) void onExternalPage(store, name, externalPage)
  }, [externalPage, store, name])
}
