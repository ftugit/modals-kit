<script lang="ts">
  import { onMount, tick, untrack, type Snippet } from 'svelte'
  import {
    createAnchorRegistry,
    createAnchorTracker,
    type AnchorRegistry,
    type TriggerZone,
  } from '../anchors'
  import {
    getState,
    initPaginator,
    loadMore,
    onExternalPage,
    reportAnchor,
    setExtra,
    setPageSize,
  } from '../core'
  import { canLoadMore, pickCurrentPage } from '../pure'
  import { getPaginator } from '../registry'
  import { createPaginatorStore, getClientStore, type Store } from '../store'
  import type {
    EdgeTrigger,
    Extra,
    ExtraValue,
    PaginatorState,
    PrependBehavior,
    ScrollDriver,
  } from '../types'
  import {
    DEFAULT_HOST_OPTIONS,
    hashAnchorFor,
    setPaginatorContext,
    useScopeStore,
    type ResolvedHostOptions,
  } from './context.svelte'
  import {
    readPaginatorSearch,
    type ExtraSearchSpec,
    type MinimalRouter,
  } from '../adapter-url'

  interface Props<T> {
    name: string
    class?: string
    ariaLabel?: string
    pageParam?: string
    extraSearch?: ExtraSearchSpec
    pageSizes?: readonly number[]
    extraDefaults?: Extra
    snapshot?: PaginatorState<T> | null
    externalPage?: number | null
    externalRestorable?: { pageSize?: number; extra: Extra } | null
    router?: MinimalRouter | null
    currentSearch?: () => Record<string, unknown> | null
    mode?: 'accumulate' | 'single'
    topTrigger?: EdgeTrigger
    bottomTrigger?: EdgeTrigger
    topZone?: TriggerZone
    bottomZone?: TriggerZone
    prependBehavior?: PrependBehavior
    hashAnchor?: string | null
    pageLine?: number
    pageHysteresis?: number
    toolbar?: Snippet
    children?: Snippet
  }

  let {
    name,
    class: className,
    ariaLabel,
    pageParam: pageParamProp,
    extraSearch: extraSearchProp,
    pageSizes: pageSizesProp,
    extraDefaults,
    snapshot: snapProp,
    externalPage: externalPageProp,
    externalRestorable: externalRestorableProp,
    router,
    currentSearch: currentSearchProp,
    mode = DEFAULT_HOST_OPTIONS.mode,
    topTrigger = DEFAULT_HOST_OPTIONS.topTrigger,
    bottomTrigger = DEFAULT_HOST_OPTIONS.bottomTrigger,
    topZone = DEFAULT_HOST_OPTIONS.topZone,
    bottomZone = DEFAULT_HOST_OPTIONS.bottomZone,
    prependBehavior = DEFAULT_HOST_OPTIONS.prependBehavior,
    hashAnchor: hashAnchorProp,
    pageLine = 0.2,
    pageHysteresis = 48,
    toolbar,
    children,
  }: Props<any> = $props()

  const instance = getPaginator(name)
  const store = useScopeStore()

  // D15: stale SSR-snapshot check
  let snap = snapProp
  if (snap && externalPageProp != null && snap.status === 'idle' && snap.page !== externalPageProp) {
    snap = {
      ...snap,
      loadedPages: [],
      pages: {},
      error: null,
      status: 'init',
      page: externalPageProp,
    }
  }

  if (snap) store.hydrate(name, snap)

  if (extraDefaults) {
    store.update(name, (s) => ({ ...s, extra: { ...extraDefaults, ...s.extra } }))
  }

  let currentState = $state.raw<PaginatorState<any>>(getState(store, name))

  $effect(() => {
    currentState = getState(store, name)
    const unsub = store.subscribe?.(name, (next) => {
      currentState = next
    })
    return () => unsub?.()
  })

  let containerRef: HTMLDivElement | undefined = $state()
  let nativeAnchoring = $state(true)

  const anchors: AnchorRegistry = createAnchorRegistry()
  const adapter = instance.adapter as any

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
  const safeCancelRaf = (id: number) => {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id)
  }

  const sentinelVisible = { [-1]: false, [1]: false }
  const armed = { [-1]: true, [1]: true }

  let lastScrollTop = 0
  let lastGesture = { dir: 0 as -1 | 0 | 1, at: 0 }
  let gestureBudget = 0
  let programmaticUntil = 0
  let holdRaf = 0
  let prependRef: { page: number; top: number } | null = null

  const GESTURE_TTL = 1500
  const BUDGET_CAP = 300
  const BUDGET_TRIGGER = 24

  const isUserGesture = () => now() > programmaticUntil

  const noteGesture = (dir: 1 | -1, delta = 0) => {
    if (!isUserGesture()) return
    const t = now()
    if (lastGesture.dir !== dir || t - lastGesture.at > 350) gestureBudget = 0
    gestureBudget = Math.min(BUDGET_CAP, gestureBudget + (delta ? Math.abs(delta) : 30))
    lastGesture = { dir, at: t }
  }

  const triggerOf = (dir: 1 | -1): EdgeTrigger => {
    if (mode !== 'accumulate') return 'off'
    return dir === 1 ? bottomTrigger : topTrigger
  }

  function maybeLoadMore(dir: 1 | -1) {
    const trigger = triggerOf(dir)
    if (trigger === 'off' || trigger === 'manual') return
    const s = getState(store, name)
    if (!canLoadMore(dir, s)) return
    if (s.status === 'loading') return

    if (trigger === 'direction' || trigger === 'chat') {
      const budgetOk = lastGesture.dir === dir && gestureBudget >= BUDGET_TRIGGER
      const recent = now() - lastGesture.at < GESTURE_TTL
      if (!budgetOk || !recent || !armed[dir]) return
    }

    armed[dir] = false
    void loadMore(store, name, dir)
  }

  function holdAbove(belowPage: number) {
    const c = containerRef
    if (!c || typeof requestAnimationFrame !== 'function') return
    safeCancelRaf(holdRaf)

    const contentTop = () => {
      const el =
        anchors.getElement(`page:${belowPage}`) ??
        c.querySelector(`[data-pag-anchor="${belowPage}"]`)
      return el
        ? (el as HTMLElement).getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop
        : null
    }

    const start = prependRef && prependRef.page === belowPage ? prependRef.top : contentTop()
    prependRef = null
    if (start == null) return

    let last: number = start
    let settleFrames = 0
    const frameTick = () => {
      const nowTop = contentTop()
      if (nowTop != null && nowTop !== last) {
        programmaticUntil = now() + 120
        c.scrollTop += nowTop - last
        lastScrollTop = c.scrollTop
        last = nowTop
      }
      const s = getState(store, name)
      const busy = s.status === 'loading' && s.pending?.mode === 'prepend'
      if (busy) settleFrames = 0
      else settleFrames += 1
      if (settleFrames < 3) holdRaf = requestAnimationFrame(frameTick)
    }
    holdRaf = requestAnimationFrame(frameTick)
  }

  const scrollDriver: ScrollDriver = (intent) => {
    armed[-1] = false
    armed[1] = triggerOf(1) !== 'chat'
    gestureBudget = 0
    programmaticUntil = now() + 250

    if (intent.type === 'page' && intent.reason === 'prepend') {
      const pMode = prependBehavior
      const nativeOk = nativeAnchoring && (containerRef?.scrollTop ?? 0) > 0
      if (pMode === 'js' || (pMode === 'auto' && !nativeOk)) {
        holdAbove(intent.page + 1)
      }
      return
    }

    safeCancelRaf(holdRaf)
    const run = () => {
      const c = containerRef
      if (!c) return
      if (intent.type === 'top') {
        c.scrollTo({ top: 0 })
      } else {
        const el = anchors.getElement(`page:${intent.page}`)
        if (el) {
          const elTop =
            el.getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop
          c.scrollTo({ top: elTop })
        }
      }
      lastScrollTop = c.scrollTop
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
    else run()
  }

  instance.scrollDriver = scrollDriver

  function handleScroll() {
    const c = containerRef
    if (!c) return
    const top = c.scrollTop
    const delta = top - lastScrollTop
    lastScrollTop = top
    if (delta === 0) return
    noteGesture(delta < 0 ? -1 : 1, Math.abs(delta))
    const dir: 1 | -1 = delta < 0 ? -1 : 1
    if (sentinelVisible[dir]) maybeLoadMore(dir)
  }

  function handleWheel(e: WheelEvent) {
    const c = containerRef
    if (!c || e.deltaY === 0) return
    const dir: 1 | -1 = e.deltaY < 0 ? -1 : 1
    noteGesture(dir, Math.abs(e.deltaY))
    if (dir === -1 && c.scrollTop <= 2) {
      armed[-1] = true
      if (sentinelVisible[-1]) maybeLoadMore(-1)
    }
  }

  let touchY = 0
  function handleTouchStart(e: TouchEvent) {
    touchY = e.touches[0]?.clientY ?? 0
  }

  function handleTouchMove(e: TouchEvent) {
    const y = e.touches[0]?.clientY ?? 0
    const delta = y - touchY
    touchY = y
    if (delta === 0) return
    const dir: 1 | -1 = delta > 0 ? -1 : 1
    noteGesture(dir, Math.abs(delta))
    const c = containerRef
    if (dir === -1 && c && c.scrollTop <= 2) {
      armed[-1] = true
      if (sentinelVisible[-1]) maybeLoadMore(-1)
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Home') {
      e.preventDefault()
      scrollDriver({ type: 'top' })
    }
  }

  // URL observation
  const spec = adapter.searchSpec ?? {}
  const effectivePageParam = pageParamProp ?? spec.pageParam ?? 'page'
  const effectiveExtraSearch = extraSearchProp ?? spec.extra
  const effectivePageSizes = pageSizesProp ?? spec.pageSizes

  const resolvedSearch = $derived.by((): Record<string, unknown> | null => {
    if (currentSearchProp) return currentSearchProp()
    if (router?.currentSearch) return router.currentSearch()
    if (typeof window !== 'undefined') {
      return Object.fromEntries(new URLSearchParams(window.location.search))
    }
    return null
  })

  const externalObserved = $derived.by(() => {
    if (resolvedSearch && adapter.observeExternal) {
      return adapter.observeExternal(resolvedSearch)
    }
    return null
  })

  const effectiveExternalPage = $derived.by(() => {
    if (externalPageProp != null) return externalPageProp
    if (externalObserved && externalObserved.page != null) return externalObserved.page
    if (resolvedSearch && resolvedSearch[effectivePageParam] != null) {
      const n = Number(resolvedSearch[effectivePageParam])
      return Number.isInteger(n) && n >= 1 ? n : null
    }
    return null
  })

  const effectiveExternalRestorable = $derived.by(() => {
    if (externalObserved && externalObserved.restorable) return externalObserved.restorable
    if (!effectiveExtraSearch && !effectivePageSizes) return externalRestorableProp
    if (resolvedSearch) {
      const params = new URLSearchParams()
      for (const [k, v] of Object.entries(resolvedSearch)) {
        if (v == null) continue
        params.set(k, String(v))
      }
      const r = readPaginatorSearch(params, {
        pageParam: effectivePageParam,
        extra: effectiveExtraSearch,
        pageSizes: effectivePageSizes,
      })
      const extra: Extra = { ...(extraDefaults ?? {}), ...r.extra }
      return { pageSize: r.pageSize ?? instance.pageSize, extra }
    }
    return null
  })

  const fallbackRouter: MinimalRouter = {
    navigate(opts: Parameters<MinimalRouter['navigate']>[0]) {
      if (typeof window === 'undefined') return
      const searchParams = new URLSearchParams(window.location.search)
      const current = Object.fromEntries(searchParams)
      const next = opts.search(current)
      const nextParams = new URLSearchParams()
      for (const [k, v] of Object.entries(next)) {
        if (v != null) nextParams.set(k, String(v))
      }
      const qs = nextParams.toString() ? `?${nextParams.toString()}` : ''
      const url = `${window.location.pathname}${qs}${window.location.hash}`
      if (opts.replace ?? true) {
        window.history.replaceState(window.history.state, '', url)
      } else {
        window.history.pushState(window.history.state, '', url)
      }
      window.dispatchEvent(new Event('popstate'))
    },
    currentSearch() {
      if (typeof window === 'undefined') return {}
      return Object.fromEntries(new URLSearchParams(window.location.search))
    },
  }

  onMount(() => {
    const r = router ?? (typeof window !== 'undefined' ? fallbackRouter : null)
    if (r && typeof adapter.setRouter === 'function') {
      adapter.setRouter(r)
    }

    const c = containerRef
    if (c) {
      const tracker = createAnchorTracker(
        c,
        {
          onPassedPages: (pages) => {
            const s = getState(store, name)
            reportAnchor(store, name, pickCurrentPage(pages, s.loadedPages[0] ?? s.page))
          },
          onSentinel: (dir, visible) => {
            sentinelVisible[dir] = visible
            if (!visible) {
              if (dir === 1 || triggerOf(-1) !== 'chat' || lastGesture.dir === -1) {
                armed[dir] = true
              }
              return
            }
            maybeLoadMore(dir)
          },
        },
        {
          topZone,
          bottomZone,
          pageLine,
          pageHysteresis,
        }
      )
      anchors.setTracker(tracker)

      if (typeof CSS !== 'undefined' && CSS.supports) {
        nativeAnchoring = CSS.supports('overflow-anchor', 'auto')
      }
    }

    void initPaginator(store, name)

    return () => {
      anchors.setTracker(null)
      instance.scrollDriver = null
      safeCancelRaf(holdRaf)
      if (typeof adapter.setRouter === 'function') {
        adapter.setRouter(null)
      }
    }
  })

  let prevExternalPage: number | null = null
  $effect(() => {
    const p = effectiveExternalPage
    if (p !== prevExternalPage) {
      prevExternalPage = p
      if (p != null) void onExternalPage(store, name, p)
    }
  })

  $effect(() => {
    const ext = effectiveExternalRestorable
    if (!ext) return
    untrack(() => {
      const s = getState(store, name)
      if (ext.extra) {
        const diff: Extra = {}
        for (const [k, v] of Object.entries(ext.extra)) {
          if (s.extra[k] !== v) diff[k] = v as ExtraValue
        }
        if (Object.keys(diff).length > 0) {
          void setExtra(store, name, diff)
        }
      }
      if (ext.pageSize && ext.pageSize !== s.pageSize) {
        void setPageSize(store, name, ext.pageSize)
      }
    })
  })

  const effectiveHashAnchor = $derived(
    hashAnchorProp === undefined ? hashAnchorFor(name) : hashAnchorProp
  )

  const options = $derived.by(
    (): ResolvedHostOptions => ({
      mode,
      topTrigger,
      bottomTrigger,
      topZone,
      bottomZone,
      prependBehavior,
    })
  )

  setPaginatorContext({
    name,
    store,
    anchors,
    requestMore: (dir) => {
      noteGesture(dir, 100)
      armed[dir] = true
      maybeLoadMore(dir)
    },
    currentSearch: () => resolvedSearch,
    hashAnchor: effectiveHashAnchor,
    options: () => options,
  })
</script>

{#if toolbar}
  {@render toolbar()}
{/if}

<div
  bind:this={containerRef}
  class={className}
  id={effectiveHashAnchor ?? undefined}
  data-paginator-host={name}
  role="feed"
  aria-busy={currentState.status === 'loading'}
  aria-label={ariaLabel ?? `Пагинатор ${name}`}
  onscroll={handleScroll}
  onwheel={handleWheel}
  ontouchstart={handleTouchStart}
  ontouchmove={handleTouchMove}
  onkeydown={handleKeyDown}
  tabindex={0}
  style:overflow-anchor={prependBehavior !== 'js' && nativeAnchoring ? 'auto' : 'none'}
>
  <div
    class="sr-only"
    aria-live="polite"
    aria-atomic="true"
    style="position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;"
  >
    {currentState.status === 'loading'
      ? 'Загрузка элементов...'
      : currentState.error
        ? `Ошибка: ${currentState.error}`
        : `Страница ${currentState.page}`}
  </div>
  {#if children}
    {@render children()}
  {/if}
</div>
