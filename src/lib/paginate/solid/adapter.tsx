// SolidJS биндинги для paginator (headless: хосты, якоря, сентинелы, слоты, хуки — без UI).
// Host — скролл-контейнер, владеет name, трекером якорей и scrollDriver; дети получают всё через контекст БЕЗ name (R15).
// Роутер отделен: адаптер принимает любой MinimalRouter через props.router или setRouter.
import {
  createComputed,
  createEffect,
  on,
  createMemo,
  Show,
  createContext,
  onCleanup,
  onMount,
  useContext,
  children,
  untrack,
  type Accessor,
  type JSX,
} from 'solid-js'
import { isServer } from 'solid-js/web'
import { createAnchorRegistry, createAnchorTracker } from '../anchors'
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
import { createPaginatorStore, getClientStore, type Store } from '../store'
import { readPaginatorSearch, type ExtraSearchSpec, type MinimalRouter } from '../adapter-url'
import type { PaginatorAdapter } from '../types'
import type { Extra, PageGroup, PaginatorEvent, PaginatorState, ViewState } from '../types'

type PaginatorContextValue = {
  name: string
  store: Store
  anchors: AnchorRegistry
  /** Явная подгрузка в направлении dir (кнопка/ссылка) — минуя условия триггера. */
  requestMore?: (dir: 1 | -1) => void
  /** Текущий поиск для hrefFor (SSR-гонко-безопасно: из контекста рендера). */
  currentSearch?: () => Record<string, unknown> | null
  /** id контейнера — суффикс `#id` у href страниц (no-JS скролл к пагинатору); null — без якоря. */
  hashAnchor?: string | null
  /** Реактивные опции хоста — читают EdgeSentinel/LoadMoreSlot/PendingIndicator. */
  options?: Accessor<ResolvedHostOptions>
}

const PaginatorCtx = createContext<PaginatorContextValue | null>(null)

/**
 * Область store: один Store на всё поддерево. На сервере — обязательна, если компоненты
 * по `name` стоят ВНЕ хоста (иначе каждый получил бы свой пустой store и SSR-разметка
 * навигации/панели была бы «без данных»). `snapshots` гидрируются сразу (один раз на имя),
 * до рендера детей. На клиенте — глобальный store (состояние переживает unmount).
 */
const ScopeCtx = createContext<Store | null>(null)

export function PaginatorScope(props: {
  snapshots?: Record<string, PaginatorState<unknown> | null | undefined>
  children?: JSX.Element
}) {
  const store = isServer ? createPaginatorStore() : getClientStore()
  for (const [name, snap] of Object.entries(props.snapshots ?? {})) {
    if (snap) store.hydrate(name, snap)
  }
  return <ScopeCtx.Provider value={store}>{props.children}</ScopeCtx.Provider>
}

/** Store текущей области: scope → глобальный клиентский → свежий серверный. */
function useScopeStore(): Store {
  return useContext(ScopeCtx) ?? (isServer ? createPaginatorStore() : getClientStore())
}

/**
 * Контекст пагинатора: внутри хоста — из провайдера; с явным `name` — по имени, без хоста
 * (компоненты/хуки могут стоять где угодно на странице: шапка, сайдбар, вторая колонка).
 * На сервере вне хоста нужен <PaginatorScope snapshots> — иначе store свежий и пустой.
 */
function useCtx(component: string, name?: string): PaginatorContextValue {
  const ctx = useContext(PaginatorCtx)
  if (name && (!ctx || ctx.name !== name)) {
    getPaginator(name) // R17: неизвестный name → throw
    return { name, store: useScopeStore(), anchors: noopAnchors, hashAnchor: hashAnchorFor(name) }
  }
  if (!ctx) throw new Error(`${component} must be used inside <PaginatorHost> or receive name`)
  return ctx
}

/** id контейнера хоста для `#`-якоря ссылок; одинаков для хоста и компонентов вне его (по name). */
export function hashAnchorFor(name: string): string {
  return `paginator-${name}`
}

const noopAnchors: AnchorRegistry = {
  observe() {},
  unobserve() {},
  setTracker() {},
  getElement: () => null,
}

/** Триггер автоподгрузки края. */
export type EdgeTrigger = 'off' | 'direction' | 'edge' | 'chat' | 'manual'
/** Позиция при подгрузке сверху (prepend). */
export type PrependBehavior = 'auto' | 'native' | 'js'

export type ResolvedHostOptions = {
  mode: 'accumulate' | 'single'
  topTrigger: EdgeTrigger
  bottomTrigger: EdgeTrigger
  topZone: TriggerZone
  bottomZone: TriggerZone
  prependBehavior: PrependBehavior
}

export type PaginatorHostProps<T> = {
  name: string
  class?: string
  /** SSR-снапшот: гидрирует store до первого рендера детей, повторно — игнорируется (R8). */
  snapshot?: PaginatorState<T> | null
  /** Внешняя страница из URL (D1): back/forward/ссылки. Эхо (=== page) игнорируется в ядре. */
  externalPage?: number | null
  /** Поиск текущего рендера для adapter.hrefFor (гонко-безопасно на SSR; подставляет сам хост). */
  currentSearch?: () => Record<string, unknown> | null
  /** ARIA-метка контейнера для скринридеров (WCAG AA). */
  ariaLabel?: string
  /**
   * Якорь для ссылок без JS: href страниц получают `#<id>`, и браузер после перехода
   * прокручивает к пагинатору, а не к верху документа. По умолчанию `paginator-<name>`
   * (`hashAnchorFor(name)` — то же значение используют компоненты вне хоста, найденные по name);
   * `false` — без якоря.
   */
  hashAnchor?: string | false
  /**
   * Дефолты ключей потребителя (RestorableState.extra). Кладутся в state ДО init —
   * хранилище (URL/localStorage) перекрывает их своими значениями.
   */
  extraDefaults?: Extra
  /**
   * Внешние pageSize/extra из URL (back/forward): применяются как setPageSize/setExtra
   * без persist-эха. Обычно считаются самим хостом из адреса.
   */
  externalRestorable?: { pageSize?: number; extra?: Extra } | null
  /**
   * Переопределения спецификации адреса. По умолчанию хост берёт их у адаптера
   * (`searchSpec`), чтобы одна и та же спецификация не жила в двух местах;
   * задавайте руками только если транспорт объявлен где-то ещё.
   */
  pageParam?: string
  extraSearch?: ExtraSearchSpec
  pageSizes?: readonly number[]
  /**
   * Разметка ВНЕ скролл-контейнера, но ВНУТРИ контекста пагинатора (панель настроек,
   * счётчики): хуки usePaginator* доступны, а скролл списка её не уносит.
   */
  toolbar?: JSX.Element
  /**
   * Режим: 'accumulate' (default) — страницы складываются (подгрузка по краям);
   * 'single' — классическая смена (любой переход = REPLACE), сентинелы не рендерятся.
   * Живой флип без пересоздания (D14).
   */
  mode?: 'accumulate' | 'single'
  /**
   * Триггер автоподгрузки СВЕРХУ / СНИЗУ (симметрично):
   * - 'direction' (default): edge-вход сентинела в зону + недавний жест в его сторону + rearm
   *   (сентинел выходил из зоны); ≤ 1 автоподгрузка на жест сверху.
   * - 'edge': только жест (колесо/тач/клавиши) у самой кромки; зона не используется.
   * - 'chat': грузим только в сторону движения; противоположный край молчит до смены направления.
   * - 'manual': автоподгрузки нет, зона выключена — только <LoadMoreSlot>/actions.loadMore (гибрид).
   * - 'off': край выключен полностью (сентинел не рендерится, loadMore в эту сторону — no-op).
   */
  topTrigger?: EdgeTrigger
  bottomTrigger?: EdgeTrigger
  /**
   * Зона триггера края: 'edge' — сам край; число — px; строка — CSS-длина ('40%', '300px').
   * Проценты считает браузер нативно (rootMargin IO). Default: '40%' для обоих краёв.
   */
  topZone?: TriggerZone
  bottomZone?: TriggerZone
  /**
   * Позиция при подгрузке сверху — вьюпорт ВСЕГДА остаётся на странице, перед которой
   * подгружается новая:
   * - 'auto' (default): нативный CSS overflow-anchor, если браузер умеет и scrollTop > 0;
   *   иначе JS-компенсация (holdAbove);
   * - 'native': только overflow-anchor (Safari/scrollTop=0 — позиция может уехать);
   * - 'js': всегда JS-компенсация.
   */
  prependBehavior?: PrependBehavior
  /**
   * Линия детекта текущей страницы от верха контейнера: доля высоты (0..1) или px. Default 0.2.
   * Страница N «текущая», когда её маркер (начало страницы) прошёл линию вверх.
   */
  pageLine?: number
  /** Запас обратного хода, px (гистерезис против дрожания руки). Default 48. */
  pageHysteresis?: number
  /** Опциональный роутер для привязки URL-транспорта. */
  router?: MinimalRouter | null
  children?: JSX.Element
}

/**
 * Внутренняя часть хоста: скролл-контейнер, контекст, якоря, триггеры.
 * Про адрес не знает ничего — URL-props ей передаёт публичный `PaginatorHost`.
 */
function ContainerHost<T>(props: PaginatorHostProps<T>) {
  const instance = getPaginator(props.name) // R17: неизвестный name → throw
  // snapshot/externalPage читаются один раз при создании (гидрация — фаза setup).
  const snapProp = props.snapshot ?? null
  const externalAtMount = props.externalPage ?? null

  // D15: stale SSR-снапшот при гидрации сверяется с externalPage (URL) → meta-состояние
  // с page из URL, без flash старой страницей и без затирания URL stale-значением.
  let snap: PaginatorState<T> | null = snapProp
  if (snap && externalAtMount != null && snap.status === 'idle' && snap.page !== externalAtMount) {
    snap = {
      ...snap,
      pages: {},
      loadedPages: [],
      pending: null,
      error: null,
      status: 'init',
      page: externalAtMount,
    }
  }

  // SSR: локальный store на рендер — никаких общих мутабельных ячеек между запросами.
  // Клиент: глобальный store — состояние переживает unmount хоста.
  const store: Store = useScopeStore()
  if (snap) store.hydrate<T>(props.name, snap)
  const state = store.state<T>(props.name, instance.pageSize)
  // Дефолты extra — под уже восстановленные значения (state/snapshot имеют приоритет).
  if (props.extraDefaults) {
    const defaults = props.extraDefaults
    store.update<T>(props.name, (s) => ({ ...s, extra: { ...defaults, ...s.extra } }))
  }

  const anchors = createAnchorRegistry()
  let containerRef: HTMLDivElement | undefined
  const sentinelVisible: Record<1 | -1, boolean> = { 1: false, [-1]: false }
  const options = createMemo<ResolvedHostOptions>(() => ({
    mode: props.mode ?? 'accumulate',
    topTrigger: props.topTrigger ?? 'direction',
    bottomTrigger: props.bottomTrigger ?? 'direction',
    topZone: props.topZone ?? '40%',
    bottomZone: props.bottomZone ?? '40%',
    prependBehavior: props.prependBehavior ?? 'auto',
  }))
  const triggerOf = (dir: 1 | -1): EdgeTrigger =>
    dir === -1 ? options().topTrigger : options().bottomTrigger
  const topTrigger = () => options().topTrigger
  const prependBehavior = () => options().prependBehavior
  // D14: режим — живой флип append-способности адаптера без пересоздания (state/URL целы).
  createEffect(() => {
    instance.adapter.capabilities.append = options().mode === 'accumulate'
  })
  const nativeAnchoring =
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('overflow-anchor', 'auto')

  // ── Модель триггеров (симметричная, edge + направление + rearm) ────────────────────
  const armed: Record<1 | -1, boolean> = { 1: true, [-1]: false }
  let lastGesture: { dir: -1 | 0 | 1; at: number } = { dir: 0, at: 0 }
  let gestureBudget = 1
  let lastScrollTop = 0
  let programmaticUntil = 0
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
  const recentGesture = (dir: 1 | -1) => lastGesture.dir === dir && now() - lastGesture.at < 400

  const noteGesture = (dir: -1 | 1) => {
    if (now() < programmaticUntil) return // хвост программного скролла — не жест
    if (lastGesture.dir !== dir || now() - lastGesture.at > 400) gestureBudget = 1
    lastGesture = { dir, at: now() }
    const chat = topTrigger() === 'chat' || options().bottomTrigger === 'chat'
    if (chat) armed[dir === -1 ? 1 : -1] = false
    armed[dir] = armed[dir] || (dir === 1 && !chat)
  }

  const canAuto = (dir: 1 | -1): boolean => {
    if (!instance.adapter.capabilities.append) return false
    const s = getState<T>(store, props.name)
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
    void loadMore<T>(store, props.name, dir)
  }

  const maybeLoadMore = (dir: 1 | -1): void => {
    if (canAuto(dir)) fire(dir)
  }

  /** Явный запрос пользователя (кнопка/ссылка LoadMoreSlot): без edge-условий, но не при 'off'. */
  const requestMore = (dir: 1 | -1) => {
    if (triggerOf(dir) === 'off') return
    const s = getState<T>(store, props.name)
    if (s.status !== 'idle' || !canLoadMore(dir, s)) return
    lastGesture = { dir, at: now() }
    fire(dir)
  }

  onMount(() => {
    void initPaginator<T>(store, props.name)
  })

  // Внешняя смена страницы (URL → ядро)
  {
    let prevExternal: number | null | undefined
    createEffect(() => {
      const page = props.externalPage ?? null
      if (page === prevExternal) return
      prevExternal = page
      if (page != null) void onExternalPage<T>(store, props.name, page)
    })
  }

  // Внешние pageSize/extra (URL после back/forward)
  createEffect(() => {
    const ext = props.externalRestorable
    if (!ext) return
    untrack(() => {
      const s = state()
      if (ext.extra) {
        const diff: Extra = {}
        for (const [k, v] of Object.entries(ext.extra)) if (s.extra[k] !== v) diff[k] = v
        if (Object.keys(diff).length > 0) void setExtra<T>(store, props.name, diff)
      }
      if (ext.pageSize != null && ext.pageSize !== s.pageSize)
        void setPageSize<T>(store, props.name, ext.pageSize)
    })
  })

  // Трекер якорей + scrollDriver
  createEffect(
    on(
      () => [options().topZone, options().bottomZone],
      () => {
        let holdRaf = 0
        let prependRef: { page: number; top: number } | null = null
        createComputed(
          on(
            () => state(),
            (s, prev) => {
              const c = containerRef
              if (
                !c ||
                !s.pending ||
                s.pending.mode !== 'prepend' ||
                prev?.pending?.mode === 'prepend'
              )
                return
              const page = s.pending.page + 1
              const el =
                anchors.getElement(`page:${page}`) ?? c.querySelector(`[data-pag-anchor="${page}"]`)
              if (el)
                prependRef = {
                  page,
                  top: el.getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop,
                }
            },
          ),
        )
        const holdAbove = (belowPage: number) => {
          const c = containerRef
          if (!c || typeof requestAnimationFrame !== 'function') return
          cancelAnimationFrame(holdRaf)
          const contentTop = () => {
            const el =
              anchors.getElement(`page:${belowPage}`) ??
              c.querySelector(`[data-pag-anchor="${belowPage}"]`)
            return el
              ? el.getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop
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
            const s = getState<T>(store, props.name)
            const busy = s.status === 'loading' && s.pending?.mode === 'prepend'
            if (busy) settleFrames = 0
            else settleFrames += 1
            if (settleFrames < 3) holdRaf = requestAnimationFrame(tick)
          }
          holdRaf = requestAnimationFrame(tick)
        }
        instance.scrollDriver = (intent) => {
          armed[-1] = false
          armed[1] = triggerOf(1) !== 'chat'
          gestureBudget = 0
          programmaticUntil = now() + 250
          if (intent.type === 'page' && intent.reason === 'prepend') {
            const mode = prependBehavior()
            const nativeOk = nativeAnchoring && (containerRef?.scrollTop ?? 0) > 0
            if (mode === 'js' || (mode === 'auto' && !nativeOk)) holdAbove(intent.page + 1)
            return
          }
          cancelAnimationFrame(holdRaf)
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
        const tracker = createAnchorTracker(
          containerRef ?? null,
          {
            onPassedPages: (pages) => {
              const s = getState<T>(store, props.name)
              reportAnchor<T>(store, props.name, pickCurrentPage(pages, s.loadedPages[0] ?? s.page))
            },
            onSentinel: (dir, visible, _motion) => {
              sentinelVisible[dir] = visible
              if (!visible) {
                if (dir === 1 || triggerOf(-1) !== 'chat' || lastGesture.dir === -1)
                  armed[dir] = true
                return
              }
              maybeLoadMore(dir)
            },
          },
          {
            topZone: options().topZone,
            bottomZone: options().bottomZone,
            pageLine: props.pageLine,
            pageHysteresis: props.pageHysteresis,
          },
        )
        anchors.setTracker(tracker)
        onCleanup(() => {
          anchors.setTracker(null)
          tracker?.destroy()
          instance.scrollDriver = null
          cancelAnimationFrame(holdRaf)
        })
      },
    ),
  )

  // Пользовательский скролл
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

  {
    let lastKey: string | null = null
    createEffect(() => {
      const s = state()
      const key = `${s.loadedPages.length}:${s.status}`
      if (key === lastKey) return
      lastKey = key
      if (sentinelVisible[1]) maybeLoadMore(1)
      if (sentinelVisible[-1]) maybeLoadMore(-1)
    })
  }

  const hashAnchor = () =>
    props.hashAnchor === false ? null : (props.hashAnchor ?? hashAnchorFor(props.name))

  const ctx: PaginatorContextValue = {
    name: props.name,
    store,
    anchors,
    requestMore,
    currentSearch: props.currentSearch,
    hashAnchor: hashAnchor(),
    options,
  }
  return (
    <PaginatorCtx.Provider value={ctx}>
      {props.toolbar}
      {/* Роль `region`, а не `feed`: `feed` требует детей только `article`,
          а в хосте живут индикатор загрузки, навигация и строка «конец»
          (axe: aria-required-children). Паритет с Svelte-хостом. */}
      <div
        ref={containerRef}
        class={props.class}
        id={hashAnchor() ?? undefined}
        data-paginator-host={props.name}
        role="region"
        aria-busy={state().status === 'loading'}
        aria-label={props.ariaLabel ?? `Пагинатор ${props.name}`}
        onScroll={handleScroll}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        style={{
          'overflow-anchor': prependBehavior() !== 'js' && nativeAnchoring ? 'auto' : 'none',
        }}
      >
        <div
          class="sr-only"
          aria-live="polite"
          aria-atomic="true"
          style={{
            position: 'absolute',
            width: '1px',
            height: '1px',
            padding: '0',
            margin: '-1px',
            overflow: 'hidden',
            clip: 'rect(0, 0, 0, 0)',
            'white-space': 'nowrap',
            border: '0',
          }}
        >
          {state().status === 'loading'
            ? 'Загрузка элементов...'
            : state().error
              ? `Ошибка: ${state().error}`
              : `Страница ${state().page}`}
        </div>
        {props.children}
      </div>
    </PaginatorCtx.Provider>
  )
}

// ── Хуки внутри Host (без name, R15) ────────────────────────────────────────

export function usePaginatorState<T>(name?: string): Accessor<PaginatorState<T>> {
  const ctx = useCtx('usePaginatorState', name)
  return ctx.store.state<T>(ctx.name, getPaginator(ctx.name).pageSize)
}

/** Реактивные опции хоста (режим/триггеры/зоны); вне хоста — дефолты. */
export function usePaginatorOptions(name?: string): Accessor<ResolvedHostOptions> {
  const ctx = useCtx('usePaginatorOptions', name)
  return ctx.options ?? (() => DEFAULT_HOST_OPTIONS)
}

export const DEFAULT_HOST_OPTIONS: ResolvedHostOptions = {
  mode: 'accumulate',
  topTrigger: 'direction',
  bottomTrigger: 'direction',
  topZone: '40%',
  bottomZone: '40%',
  prependBehavior: 'auto',
}

export function usePaginatorItems<T>(name?: string): Accessor<T[]> {
  const state = usePaginatorState<T>(name)
  const loaded = createMemo(() => state().loadedPages)
  const pages = createMemo(() => state().pages)
  return createMemo(() => {
    loaded()
    pages()
    return flattenPages(untrack(state))
  })
}

/**
 * Группы страниц ВКЛЮЧАЯ pending-слоты. Ссылки на неизменившиеся группы стабильны
 * (pure.pagesList) — Solid <For> не пересоздаёт DOM загруженных страниц.
 */
export function usePaginatorPages<T>(name?: string): Accessor<PageGroup<T>[]> {
  const state = usePaginatorState<T>(name)
  const loaded = createMemo(() => state().loadedPages)
  const pages = createMemo(() => state().pages)
  const pending = createMemo(() => state().pending)
  let prev: PageGroup<T>[] = []
  return createMemo(() => {
    loaded()
    pages()
    pending()
    prev = pagesList(untrack(state), prev)
    return prev
  })
}

export function usePaginatorViewState(name?: string): Accessor<ViewState> {
  const state = usePaginatorState<unknown>(name)
  const status = createMemo(() => state().status)
  const loaded = createMemo(() => state().loadedPages)
  const pages = createMemo(() => state().pages)
  return createMemo(() => {
    status()
    loaded()
    pages()
    return deriveViewState(untrack(state))
  })
}

export type PaginatorActions = {
  goPage(page: number): void
  loadMore(dir: 1 | -1): void
  retry(): void
  reset(): void
  scrollToPage(page: number): void
  prefetchPage(page: number): void
  setPageSize(pageSize: number): void
  setExtra(patch: Extra, options?: { reload?: boolean }): void
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
  onCleanup(getPaginator(ctx.name).emitter.on((event) => handler(event)))
}

export function usePageHref(
  page: number | Accessor<number>,
  name?: string,
): Accessor<string | null> {
  const ctx = useCtx('usePageHref', name)
  const pageOf = () => (typeof page === 'function' ? page() : page)
  const adapter = getPaginator(ctx.name).adapter
  if (!adapter.hrefFor) return () => null
  const currentSearch = ctx.currentSearch
  const hash = ctx.hashAnchor ? `#${ctx.hashAnchor}` : ''
  return createMemo(() => {
    const href = adapter.hrefFor!(pageOf(), { search: currentSearch?.() ?? undefined })
    return href == null ? null : href + hash
  })
}

// ── Escape-hatch вне Host (явный name) ───────────────────────────────────────

export function usePaginator<T>(name: string) {
  const instance = getPaginator(name)
  const store = getClientStore()
  const state = store.state<T>(name, instance.pageSize)
  const loaded = createMemo(() => state().loadedPages)
  const pagesData = createMemo(() => state().pages)
  const pending = createMemo(() => state().pending)
  let prev: PageGroup<T>[] = []
  const pages = createMemo(() => {
    loaded()
    pagesData()
    pending()
    prev = pagesList(untrack(state), prev)
    return prev
  })
  return {
    state,
    items: createMemo(() => {
      loaded()
      pagesData()
      return flattenPages(untrack(state))
    }),
    pages,
    viewState: createMemo(() => deriveViewState(state())),
    totalPages: createMemo(() => state().totalPages),
    actions: {
      goPage: (page: number) => void goToPage<T>(store, name, page),
      scrollToPage: (page: number) => void scrollToPage<T>(store, name, page),
      loadMore: (dir: 1 | -1) => void loadMore<T>(store, name, dir),
      retry: () => void retry<T>(store, name),
      reset: () => void resetPaginator<T>(store, name),
      prefetchPage: (page: number) => void prefetchPage<T>(store, name, page),
      setPageSize: (pageSize: number) => void setPageSize<T>(store, name, pageSize),
      setExtra: (patch: Extra, options?: { reload?: boolean }) =>
        void setExtra<T>(store, name, patch, options),
      loadPrev: () => void loadMore<T>(store, name, -1),
      requestMore: (dir: 1 | -1) => void loadMore<T>(store, name, dir),
    } satisfies PaginatorActions,
  }
}

// ── Якоря и сентинелы (R3, R10) ─────────────────────────────────────────────

export function PageAnchor(props: {
  page: number
  class?: string
  name?: string
  marker?: boolean
  children?: JSX.Element
}) {
  const { anchors } = useCtx('PageAnchor', props.name)
  let ref: HTMLDivElement | undefined
  let marker: HTMLDivElement | undefined
  const resolved = children(() => props.children)
  createEffect(() => {
    const page = props.page
    const el = props.marker === false ? null : marker
    if (!el) return
    const key = `page:${page}`
    anchors.observe(key, el, { type: 'page', page })
    onCleanup(() => anchors.unobserve(key, el))
  })
  return (
    <div
      ref={ref}
      class={props.class}
      data-pag-anchor={props.page}
      aria-hidden={!resolved() ? 'true' : undefined}
    >
      <Show when={props.marker !== false}>
        <div
          ref={marker}
          data-pag-marker={props.page}
          style={{ height: '0', overflow: 'hidden' }}
        />
      </Show>
      {resolved()}
    </div>
  )
}

export function EdgeSentinel(props: { dir: 1 | -1; name?: string }) {
  const { anchors } = useCtx('EdgeSentinel', props.name)
  const options = usePaginatorOptions(props.name)
  const active = () => {
    const o = options()
    const trig = props.dir === -1 ? o.topTrigger : o.bottomTrigger
    return o.mode === 'accumulate' && trig !== 'off' && trig !== 'manual'
  }
  return (
    <Show when={active()}>
      <SentinelEl dir={props.dir} anchors={anchors} />
    </Show>
  )
}

function SentinelEl(props: { dir: 1 | -1; anchors: AnchorRegistry }) {
  let ref: HTMLDivElement | undefined
  createEffect(() => {
    const dir = props.dir
    const el = ref
    if (!el) return
    const key = `sentinel:${dir}`
    props.anchors.observe(key, el, { type: 'sentinel', dir })
    onCleanup(() => props.anchors.unobserve(key))
  })
  return (
    <div
      ref={ref}
      data-pag-sentinel={props.dir}
      aria-hidden="true"
      style={{ height: '1px', width: '100%', 'flex-shrink': 0 }}
    />
  )
}

// ── Headless-слоты в потоке ───────────────────────────────────────────────

export type LoadMoreSlotRender = {
  page: number
  href: string | null
  load(): void
  onClick(e: Event): void
  loading: boolean
  action: 'load' | 'go'
  dir: 1 | -1
}

export function LoadMoreSlot(props: {
  dir: 1 | -1
  name?: string
  action?: 'auto' | 'load' | 'go'
  always?: boolean
  children: (p: LoadMoreSlotRender) => JSX.Element
}) {
  const state = usePaginatorState<unknown>(props.name)
  const options = usePaginatorOptions(props.name)
  const actions = usePaginatorActions(props.name)
  const action = (): 'load' | 'go' => {
    if (props.action && props.action !== 'auto') return props.action
    return options().mode === 'accumulate' ? 'load' : 'go'
  }
  const page = () => {
    const s = state()
    if (action() === 'go') return s.page + props.dir
    const loaded = s.loadedPages
    if (loaded.length === 0) return s.page + props.dir
    return props.dir === -1 ? Math.min(...loaded) - 1 : Math.max(...loaded) + 1
  }
  const href = usePageHref(page, props.name)
  const visible = () => {
    const o = options()
    const trig = props.dir === -1 ? o.topTrigger : o.bottomTrigger
    if (trig === 'off') return false
    if (action() === 'load') {
      if (!props.always && trig !== 'manual') return false
      return canLoadMore(props.dir, state())
    }
    return canGo(props.dir, state())
  }
  const loading = () => {
    const p = state().pending
    return (
      !!p &&
      (action() === 'go'
        ? p.mode === 'replace'
        : p.mode === (props.dir === -1 ? 'prepend' : 'append'))
    )
  }
  const load = () => {
    if (action() === 'go') actions.goPage(page())
    else actions.requestMore(props.dir)
  }
  return (
    <Show when={visible()}>
      {props.children({
        get page() {
          return page()
        },
        get href() {
          return href()
        },
        get loading() {
          return loading()
        },
        get action() {
          return action()
        },
        dir: props.dir,
        load,
        onClick: (e) => {
          e.preventDefault()
          load()
        },
      })}
    </Show>
  )
}

export type PendingIndicatorRender = { page: number; dir: 1 | -1 }

export function PendingIndicator(props: {
  name?: string
  class?: string
  children: (p: PendingIndicatorRender) => JSX.Element
}) {
  const state = usePaginatorState<unknown>(props.name)
  const current = (): PendingIndicatorRender | null => {
    const s = state()
    if (s.pending) return { page: s.pending.page, dir: s.pending.mode === 'prepend' ? -1 : 1 }
    if (s.status === 'loading') return { page: s.page, dir: 1 }
    return null
  }
  return (
    <Show when={current()}>
      {(p) => (
        <div
          data-pag-pending-indicator={p().dir}
          style={{ position: 'sticky', top: '0', height: '0', 'z-index': 10 }}
        >
          <div
            class={props.class}
            style={{ position: 'absolute', left: '0', right: '0', top: '0' }}
          >
            {props.children(p())}
          </div>
        </div>
      )}
    </Show>
  )
}

// ── Публичный хост ──────────────────────────────────────────────────────────

function readPage(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isInteger(n) && n >= 1 ? n : null
}

export function PaginatorHost<T>(props: PaginatorHostProps<T>) {
  const adapter = getPaginator(props.name).adapter as PaginatorAdapter<unknown> & {
    setRouter?(router: MinimalRouter | null): void
    searchSpec?: { pageParam?: string; extra?: ExtraSearchSpec; pageSizes?: readonly number[] }
  }
  const bindsUrl = typeof adapter.setRouter === 'function'
  const router = props.router

  if (!bindsUrl || !router) {
    return <ContainerHost<T> {...props} />
  }

  const spec = adapter.searchSpec ?? {}
  const pageParam = props.pageParam ?? spec.pageParam ?? 'page'
  const extraSearch = props.extraSearch ?? spec.extra
  const pageSizes = props.pageSizes ?? spec.pageSizes

  const currentSearch = (): Record<string, unknown> => router.currentSearch?.() ?? {}

  const externalState = createMemo(() => adapter.observeExternal?.(currentSearch()) ?? null)

  const externalPage = createMemo(() => {
    const explicit = props.externalPage
    if (explicit != null) return explicit
    return externalState()?.page ?? readPage(currentSearch()[pageParam])
  })

  const externalRestorable = createMemo(
    () => {
      const ext = externalState()
      if (ext) return ext.restorable
      if (!extraSearch && !pageSizes) return props.externalRestorable ?? null
      const params = new URLSearchParams()
      for (const [k, v] of Object.entries(currentSearch())) {
        if (v == null) continue
        params.set(k, String(v))
      }
      const r = readPaginatorSearch(params, { pageParam, extra: extraSearch, pageSizes })
      const instance = getPaginator(props.name)
      const extra: Extra = { ...(props.extraDefaults ?? {}), ...r.extra }
      return { pageSize: r.pageSize ?? instance.pageSize, extra }
    },
    undefined,
    { equals: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
  )

  onMount(() => {
    adapter.setRouter?.(router)
    onCleanup(() => adapter.setRouter?.(null))
  })

  return (
    <ContainerHost<T>
      {...props}
      externalPage={externalPage()}
      externalRestorable={externalRestorable()}
      currentSearch={props.currentSearch ?? currentSearch}
    />
  )
}
