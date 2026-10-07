<script lang="ts">
  import { onMount, untrack, type Snippet } from 'svelte'
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
  import { readPaginatorSearch, type ExtraSearchSpec } from '../adapter-url'
  import {
    currentSearch as frameworkSearch,
    svelteKitRouter,
  } from '$lib/router/sveltekit'

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

  // D15: stale SSR-snapshot check. Снапшот мог приехать из адреса, которого уже нет
  // (back/forward, «мелкая» навигация): тогда он несовместим с текущим адресом и его
  // место занимает страница, которую называет адрес. Канон берёт её из пропа
  // `externalPage` (у роута — валидированный search); в порте её считает тот же
  // адаптер, что владеет адресом: `observeExternal`/ключ адреса.
  const initialExternalPage = ((): number | null => {
    if (externalPageProp != null) return externalPageProp
    const a = instance.adapter as {
      setRouter?: unknown
      observeExternal?: (search: Record<string, unknown>) => { page?: number | null } | null
      searchSpec?: { pageParam?: string }
    }
    if (typeof a.setRouter !== 'function') return null
    const search = currentSearchProp ? currentSearchProp() : frameworkSearch()
    if (!search) return null
    const observed = a.observeExternal?.(search)
    if (observed?.page != null) return observed.page
    const n = Number(search[a.searchSpec?.pageParam ?? 'page'])
    return Number.isInteger(n) && n >= 1 ? n : null
  })()

  let snap = snapProp
  if (snap && initialExternalPage != null && snap.status === 'idle' && snap.page !== initialExternalPage) {
    snap = {
      ...snap,
      loadedPages: [],
      pages: {},
      pending: null,
      error: null,
      status: 'init',
      page: initialExternalPage,
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
  const anchors: AnchorRegistry = createAnchorRegistry()
  const adapter = instance.adapter as any

  const options = $derived.by<ResolvedHostOptions>(() => ({
    mode,
    topTrigger,
    bottomTrigger,
    topZone,
    bottomZone,
    prependBehavior,
  }))

  const triggerOf = (dir: 1 | -1): EdgeTrigger =>
    dir === -1 ? options.topTrigger : options.bottomTrigger

  $effect(() => {
    instance.adapter.capabilities.append = options.mode === 'accumulate'
  })

  const nativeAnchoring =
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('overflow-anchor', 'auto')

  const sentinelVisible: Record<1 | -1, boolean> = { 1: false, [-1]: false }
  const armed: Record<1 | -1, boolean> = { 1: true, [-1]: false }
  let lastGesture: { dir: -1 | 0 | 1; at: number } = { dir: 0, at: 0 }
  let gestureBudget = 1
  let lastScrollTop = 0
  let programmaticUntil = 0
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
  const recentGesture = (dir: 1 | -1) => lastGesture.dir === dir && now() - lastGesture.at < 400

  const noteGesture = (dir: -1 | 1) => {
    if (now() < programmaticUntil) return
    if (lastGesture.dir !== dir || now() - lastGesture.at > 400) gestureBudget = 1
    lastGesture = { dir, at: now() }
    const chat = options.topTrigger === 'chat' || options.bottomTrigger === 'chat'
    if (chat) armed[dir === -1 ? 1 : -1] = false
    armed[dir] = armed[dir] || (dir === 1 && !chat)
  }

  const canAuto = (dir: 1 | -1): boolean => {
    if (!instance.adapter.capabilities.append) return false
    const s = getState<any>(store, name)
    if (s.status !== 'idle') return false
    if (!canLoadMore(dir, s)) return false
    const trig = triggerOf(dir)
    switch (trig) {
      case 'off':
      case 'manual':
        return false
      case 'edge': {
        const c = containerRef
        if (!c) return false
        const atEdge =
          dir === -1 ? c.scrollTop <= 2 : c.scrollTop + c.clientHeight >= c.scrollHeight - 2
        return recentGesture(dir) && atEdge
      }
      case 'chat':
        if (dir === 1) return lastGesture.dir === 1 || lastGesture.dir === 0
        return armed[-1] && recentGesture(-1) && gestureBudget > 0
      case 'direction':
      default:
        if (dir === 1) return true
        return armed[-1] && recentGesture(-1) && gestureBudget > 0
    }
  }

  const fire = (dir: 1 | -1) => {
    armed[dir] = false
    if (dir === -1) gestureBudget -= 1
    void loadMore(store, name, dir)
  }

  const maybeLoadMore = (dir: 1 | -1): void => {
    if (canAuto(dir)) fire(dir)
  }

  const requestMore = (dir: 1 | -1) => {
    if (triggerOf(dir) === 'off') return
    const s = getState<any>(store, name)
    if (s.status !== 'idle' || !canLoadMore(dir, s)) return
    lastGesture = { dir, at: now() }
    fire(dir)
  }

  let holdRaf = 0
  let prependRef: { page: number; top: number } | null = null

  /**
   * Захват опорной точки prepend-подгрузки — как в исходнике
   * (`createComputed(on(() => state(), …))` в Solid-версии): синхронно в момент
   * патча состояния, то есть ДО вставки слотов и до вызова `scrollDriver`/
   * `holdAbove`. Через `$effect` так не получается: эффекты Svelte выполняются
   * после обновления DOM, поэтому ссылка захватывалась бы уже по сдвинутой
   * геометрии (и не успевала к моменту чтения). Ещё одно следствие в исходнике —
   * гард перехода: повторные патчи внутри окна загрузки (например отчёт якоря
   * меняет `page`) НЕ перезаписывают опорную точку, иначе следующая подгрузка
   * сверху с тем же `belowPage` возьмёт протухшее значение.
   */
  let prevPendingMode: 'append' | 'prepend' | 'replace' | null = null

  function capturePrependRef(s: PaginatorState<any>): void {
    const c = containerRef
    const mode = s.pending?.mode ?? null
    const enteredPrepend = mode === 'prepend' && prevPendingMode !== 'prepend'
    prevPendingMode = mode
    if (!c || !enteredPrepend || !s.pending) return
    const page = s.pending.page + 1
    const el = anchors.getElement(`page:${page}`) ?? c.querySelector(`[data-pag-anchor="${page}"]`)
    if (el) {
      prependRef = {
        page,
        top: el.getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop,
      }
    }
  }

  function holdAbove(belowPage: number) {
    const c = containerRef
    if (!c || typeof requestAnimationFrame !== 'function') return
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(holdRaf)
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
    const tick = () => {
      const nowTop = contentTop()
      if (nowTop != null && nowTop !== last) {
        programmaticUntil = now() + 120
        c.scrollTop += nowTop - last
        lastScrollTop = c.scrollTop
        last = nowTop
      }
      const s = getState<any>(store, name)
      const busy = s.status === 'loading' && s.pending?.mode === 'prepend'
      if (busy) settleFrames = 0
      else settleFrames += 1
      if (settleFrames < 3) holdRaf = requestAnimationFrame(tick)
    }
    holdRaf = requestAnimationFrame(tick)
  }

  const scrollDriver: ScrollDriver = (intent) => {
    armed[-1] = false
    armed[1] = triggerOf(1) !== 'chat'
    gestureBudget = 0
    programmaticUntil = now() + 250
    if (intent.type === 'page' && intent.reason === 'prepend') {
      const pMode = options.prependBehavior
      const nativeOk = nativeAnchoring && (containerRef?.scrollTop ?? 0) > 0
      if (pMode === 'js' || (pMode === 'auto' && !nativeOk)) holdAbove(intent.page + 1)
      return
    }
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(holdRaf)
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

  $effect(() => {
    const c = containerRef
    if (!c) return
    const currentTopZone = options.topZone
    const currentBottomZone = options.bottomZone
    const tracker = createAnchorTracker(
      c,
      {
        onPassedPages: (pages) => {
          const s = getState<any>(store, name)
          reportAnchor(store, name, pickCurrentPage(pages, s.loadedPages[0] ?? s.page))
        },
        onSentinel: (dir, visible, _motion) => {
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
        topZone: currentTopZone,
        bottomZone: currentBottomZone,
        pageLine,
        pageHysteresis,
      },
    )
    anchors.setTracker(tracker)
    return () => {
      anchors.setTracker(null)
      tracker?.destroy()
    }
  })

  const handleScroll = () => {
    const c = containerRef
    if (!c) return
    const top = c.scrollTop
    const delta = top - lastScrollTop
    lastScrollTop = top
    if (delta === 0) return
    noteGesture(delta < 0 ? -1 : 1)
    const dir: 1 | -1 = delta < 0 ? -1 : 1
    if (sentinelVisible[dir]) maybeLoadMore(dir)
  }

  const handleWheel = (e: WheelEvent) => {
    const c = containerRef
    if (!c || e.deltaY === 0) return
    const dir: 1 | -1 = e.deltaY < 0 ? -1 : 1
    noteGesture(dir)
    if (dir === -1 && c.scrollTop <= 2) {
      armed[-1] = true
      if (sentinelVisible[-1]) maybeLoadMore(-1)
    }
  }

  let touchY = 0
  const handleTouchStart = (e: TouchEvent) => {
    touchY = e.touches[0]?.clientY ?? 0
  }
  const handleTouchMove = (e: TouchEvent) => {
    const y = e.touches[0]?.clientY ?? touchY
    const dy = y - touchY
    touchY = y
    if (dy === 0) return
    const dir: 1 | -1 = dy > 0 ? -1 : 1
    noteGesture(dir)
    if (dir === -1 && (containerRef?.scrollTop ?? 1) <= 2) {
      armed[-1] = true
      if (sentinelVisible[-1]) maybeLoadMore(-1)
    }
  }
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'Home') {
      noteGesture(-1)
      if ((containerRef?.scrollTop ?? 1) <= 2) {
        armed[-1] = true
        if (sentinelVisible[-1]) maybeLoadMore(-1)
      }
    } else if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === 'End' || e.key === ' ') {
      noteGesture(1)
    }
  }

  let lastStateKey: string | null = null
  $effect(() => {
    const s = currentState
    const key = `${s.loadedPages.length}:${s.status}`
    if (key === lastStateKey) return
    lastStateKey = key
    if (sentinelVisible[1]) maybeLoadMore(1)
    if (sentinelVisible[-1]) maybeLoadMore(-1)
  })

  // ── Адрес: только через адаптер ─────────────────────────────────────────────
  // Признак URL-транспорта — метод `setRouter` (канон: `bindsUrl`). У адаптеров без
  // адреса (local/memory) его нет, и хост адрес не читает ВООБЩЕ: иначе переключение
  // хранилища рождало гибрид «страница из storage, фильтры из URL» (ловится
  // probes/pag-store-hybrid.mjs). Ключи адреса тоже берём у адаптера (`searchSpec`),
  // чтобы спецификация не жила в двух местах.
  const bindsUrl = typeof adapter.setRouter === 'function'
  const spec = adapter.searchSpec ?? {}
  const effectivePageParam = pageParamProp ?? spec.pageParam ?? 'page'
  const effectiveExtraSearch = extraSearchProp ?? spec.extra
  const effectivePageSizes = pageSizesProp ?? spec.pageSizes

  // Срез поиска даёт слой фреймворка (SvelteKit) — не `window.location`:
  // прямое чтение адреса не реактивно и обходит роутер.
  const resolvedSearch = $derived.by((): Record<string, unknown> | null =>
    currentSearchProp ? currentSearchProp() : frameworkSearch(),
  )

  // Внешнее состояние читает ТРАНСПОРТ, не хост: хост отдаёт реактивный срез
  // поиска, а `adapter.observeExternal` решает, что он значит.
  const externalObserved = $derived.by(() => {
    if (!bindsUrl) return null
    const search = resolvedSearch
    return search && adapter.observeExternal ? adapter.observeExternal(search) : null
  })

  const effectiveExternalPage = $derived.by(() => {
    if (externalPageProp != null) return externalPageProp
    if (!bindsUrl) return null
    const observed = externalObserved
    if (observed && observed.page != null) return observed.page
    if (resolvedSearch && resolvedSearch[effectivePageParam] != null) {
      const n = Number(resolvedSearch[effectivePageParam])
      return Number.isInteger(n) && n >= 1 ? n : null
    }
    return null
  })

  const effectiveExternalRestorable = $derived.by(() => {
    if (!bindsUrl) return externalRestorableProp
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

  onMount(() => {
    // Единственное место, где библиотека касается навигации (канон D2): роутер
    // слоя фреймворка уезжает в URL-транспорт адаптера — фичи адрес не знают.
    if (bindsUrl) adapter.setRouter(svelteKitRouter())

    // Синхронная подписка на патчи состояния: тот же тайминг, что у Solid-эффекта
    // в исходнике (захват опорной точки до вставки слотов).
    const unsubscribe = store.subscribe?.(name, capturePrependRef)

    void initPaginator(store, name)

    return () => {
      unsubscribe?.()
      anchors.setTracker(null)
      instance.scrollDriver = null
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(holdRaf)
      if (bindsUrl) adapter.setRouter(null)
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

  setPaginatorContext({
    name,
    store,
    anchors,
    requestMore,
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
