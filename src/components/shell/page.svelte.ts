// Состояние страницы: SEO-метаданные, 3-рядная шапка и 3-зонный сайдбар на Svelte 5 Runes.
import { getContext, setContext, type Snippet } from 'svelte'

export type HeaderRow = 'top' | 'middle' | 'bottom'
export type HeaderSide = 'start' | 'center' | 'end'
export type HeaderSlotPath = `${HeaderRow}.${HeaderSide}`

export type SidebarZone = 'top' | 'middle' | 'bottom'
/** `auto` — не зона, а просьба занять свободную сверху вниз. */
export type SidebarPlace = SidebarZone | 'auto'
export type SidebarSlotPath = `sidebar.${SidebarPlace}` | SidebarPlace

export const HEADER_ROWS: readonly HeaderRow[] = ['top', 'middle', 'bottom']
export const HEADER_SIDES: readonly HeaderSide[] = ['start', 'center', 'end']
export const SIDEBAR_ZONES: readonly SidebarZone[] = ['top', 'middle', 'bottom']

export interface HeadSeo {
  /** Базовый (в корневом layout) или полный переопределяющий заголовок страницы (`<title>`). */
  title?: string
  /** Заголовок раздела/страницы: склеивается с базовым `title` через `titleSeparator` (`"${subTitle}${titleSeparator}${title}"`). */
  subTitle?: string
  /** Короткий заголовок для слота шапки (`PageTitleSlot`), когда `title` задан в полном формате. */
  headerTitle?: string
  /** Разделитель между `subTitle` и `title` (по умолчанию `' — '`). */
  titleSeparator?: string
  description?: string
  image?: string
  imageAlt?: string
  url?: string
  type?: string
  card?: string
  keywords?: string
  author?: string
  siteName?: string
  locale?: string
  /** Явная директива `<meta name="robots" content="...">` (перекрывает `noindex`). */
  robots?: string
  /** Закрыть служебный или приватный маршрут от индексации (`noindex, nofollow`). */
  noindex?: boolean
}

export interface HeadSeoOptions {
  enabled?: boolean | (() => boolean)
  /** Не бросать ошибку, если компонент отрендерен вне `setPageContext()` (например `ErrorPage` / `Error500` в изолированном тесте). */
  optional?: boolean
}

export type SeoLayer = {
  id: number
  resolve: () => HeadSeo | null | undefined
}

export type SlotItem = {
  id: number
  snippet: Snippet
  offset?: number
  /**
   * Каркас оболочки. Слот виден, но зону для `auto` не занимает:
   * layout всегда сидит во всех трёх, иначе свободной зоны не было бы.
   */
  frame?: boolean
  /** Поставлен режимом `auto`, а не явной зоной. */
  auto?: boolean
}

export type RowSlots = Record<HeaderSide, SlotItem[]>
export type HeaderSlots = Record<HeaderRow, RowSlots>
export type HeaderRows = HeaderSlots
export type SidebarSlots = Record<SidebarZone, SlotItem[]>

function createEmptyHeaderSlots(): HeaderSlots {
  return {
    top: { start: [], center: [], end: [] },
    middle: { start: [], center: [], end: [] },
    bottom: { start: [], center: [], end: [] },
  }
}

function createEmptySidebarSlots(): SidebarSlots {
  return {
    top: [],
    middle: [],
    bottom: [],
  }
}

function cloneHeaderSlots(src: HeaderSlots): HeaderSlots {
  return {
    top: { start: [...src.top.start], center: [...src.top.center], end: [...src.top.end] },
    middle: { start: [...src.middle.start], center: [...src.middle.center], end: [...src.middle.end] },
    bottom: { start: [...src.bottom.start], center: [...src.bottom.center], end: [...src.bottom.end] },
  }
}

function cloneSidebarSlots(src: SidebarSlots): SidebarSlots {
  return {
    top: [...src.top],
    middle: [...src.middle],
    bottom: [...src.bottom],
  }
}

function applySeoPatch(target: HeadSeo, patch: HeadSeo | null | undefined, resetSubTitleOnFullTitle: boolean): void {
  if (!patch) return
  if (resetSubTitleOnFullTitle && patch.title !== undefined && patch.subTitle === undefined) {
    target.subTitle = undefined
  }
  for (const key of Object.keys(patch) as (keyof HeadSeo)[]) {
    const value = patch[key]
    if (value !== undefined) {
      ;(target as Record<string, unknown>)[key] = value
    }
  }
}

export function rowHasSlots(row: RowSlots | undefined): boolean {
  if (!row) return false
  return row.start.length > 0 || row.center.length > 0 || row.end.length > 0
}

export function headerHasSlots(header: HeaderSlots | undefined): boolean {
  if (!header) return false
  return rowHasSlots(header.top) || rowHasSlots(header.middle) || rowHasSlots(header.bottom)
}

export function sidebarHasSlots(sidebar: SidebarSlots | undefined): boolean {
  if (!sidebar) return false
  return sidebar.top.length > 0 || sidebar.middle.length > 0 || sidebar.bottom.length > 0
}

export class PageState {
  // Каноническое состояние слоёв хранится в обычных полях (не `$state`-прокси),
  // а реактивность сигнализируется записью ревизии/снимка без чтения `$state`.
  // В Svelte 5 чтение `$state` внутри teardown-функции (`is_destroying_effect`)
  // возвращает `old_values` начала батча и затирает слой новой страницы,
  // успевшей зарегистрироваться в том же flush при клиентской навигации.
  private readonly rawSeoBase: HeadSeo
  private rawSeoPatch: HeadSeo = {}
  private rawSeoLayers: SeoLayer[] = []
  private rawHeader: HeaderSlots = createEmptyHeaderSlots()
  private rawSidebar: SidebarSlots = createEmptySidebarSlots()
  private revSeq = 0
  private seoRev = $state(0)

  /** Сводный срез активных слоёв маршрутов (без базового `initialSeo` корневого layout). */
  readonly activeSeo = $derived.by<HeadSeo>(() => {
    void this.seoRev
    const acc: HeadSeo = {}
    applySeoPatch(acc, this.rawSeoPatch, true)
    for (const layer of this.rawSeoLayers) {
      applySeoPatch(acc, layer.resolve(), true)
    }
    return acc
  })

  /** Итоговые SEO-метаданные: базовые значения корневого layout + активные слои маршрутов. */
  readonly seo = $derived.by<HeadSeo>(() => {
    void this.seoRev
    const acc: HeadSeo = {}
    applySeoPatch(acc, this.rawSeoBase, false)
    applySeoPatch(acc, this.rawSeoPatch, true)
    for (const layer of this.rawSeoLayers) {
      applySeoPatch(acc, layer.resolve(), true)
    }
    return acc
  })

  header = $state.raw<HeaderSlots>(createEmptyHeaderSlots())
  sidebar = $state.raw<SidebarSlots>(createEmptySidebarSlots())

  private seq = 0

  constructor(initialSeo: HeadSeo = {}) {
    this.rawSeoBase = { ...initialSeo }
  }

  private bumpSeo(): void {
    this.seoRev = ++this.revSeq
  }

  private syncHeader(): void {
    this.header = cloneHeaderSlots(this.rawHeader)
  }

  private syncSidebar(): void {
    this.reflowSidebar()
  }

  /** `auto` в порядке регистрации. Не лежит в зоне, пока reflow его не поставит. */
  private autos: SlotItem[] = []
  private autoWarnTimer: ReturnType<typeof setTimeout> | undefined

  private reflowSidebar(): void {
    const { slots, warn } = placeSidebarSlots(this.rawSidebar, this.autos)
    this.sidebar = slots
    this.scheduleAutoWarn(warn)
  }

  /**
   * Жалоба только в браузере: SSR и клиент ставят `auto` одним кодом,
   * отдельная серверная функция для этого не нужна. Таймер сбрасывается,
   * если в том же ходе регистрация ещё доехала.
   */
  private scheduleAutoWarn(message: string | null): void {
    if (this.autoWarnTimer !== undefined) {
      clearTimeout(this.autoWarnTimer)
      this.autoWarnTimer = undefined
    }
    if (!message || typeof window === 'undefined') return
    this.autoWarnTimer = setTimeout(() => {
      this.autoWarnTimer = undefined
      console.warn(message)
    }, 0)
  }

  /** Императивный патч SEO поверх базового контекста (сохранён для обратной совместимости). */
  setSeo(patch: HeadSeo) {
    const next: HeadSeo = { ...this.rawSeoPatch }
    applySeoPatch(next, patch, true)
    this.rawSeoPatch = next
    this.bumpSeo()
  }

  /** Сбросить императивный патч до базового `initialSeo`. */
  resetSeo() {
    this.rawSeoPatch = {}
    this.bumpSeo()
  }

  /**
   * Зарегистрировать реактивный слой SEO с функцией отписки при размонтировании.
   * Вызывается синхронно в `<script>` компонента (работает в SSR и браузере).
   */
  registerSeo(resolve: () => HeadSeo | null | undefined): () => void {
    const id = ++this.seq
    this.rawSeoLayers = [...this.rawSeoLayers, { id, resolve }]
    this.bumpSeo()
    return () => {
      this.rawSeoLayers = this.rawSeoLayers.filter((x) => x.id !== id)
      this.bumpSeo()
    }
  }

  registerHeaderSlot(path: HeaderSlotPath, snippet: Snippet, offset?: number): () => void {
    const [row, side] = path.split('.') as [HeaderRow, HeaderSide]
    const id = ++this.seq
    const item: SlotItem = { id, snippet, offset }
    const current = [...this.rawHeader[row][side]]

    if (offset !== undefined) {
      const idx = Math.max(0, Math.min(offset, current.length))
      current.splice(idx, 0, item)
    } else {
      current.push(item)
    }

    this.rawHeader[row][side] = current
    this.syncHeader()

    return () => {
      this.rawHeader[row][side] = this.rawHeader[row][side].filter((x) => x.id !== id)
      this.syncHeader()
    }
  }

  /**
   * Зона `top` / `middle` / `bottom` или `auto`.
   * `auto` занимает свободные зоны сверху вниз, но только если хотя бы одна
   * зона уже занята не-каркасной регистрацией. Иначе блок не рисуется.
   * Каркас (`frame`) виден и в «занятости» не считается.
   */
  registerSidebarSlot(
    zone: SidebarSlotPath,
    snippet: Snippet,
    offset?: number,
    options?: { frame?: boolean },
  ): () => void {
    const raw = zone.startsWith('sidebar.') ? zone.slice('sidebar.'.length) : zone
    const id = ++this.seq
    const item: SlotItem = {
      id,
      snippet,
      offset,
      ...(options?.frame ? { frame: true } : {}),
      ...(raw === 'auto' ? { auto: true } : {}),
    }

    if (raw === 'auto') {
      this.autos = [...this.autos, item]
      this.reflowSidebar()
      return () => {
        this.autos = this.autos.filter((entry) => entry.id !== id)
        this.reflowSidebar()
      }
    }

    const rawZone = raw as SidebarZone
    const current = [...this.rawSidebar[rawZone]]
    if (offset !== undefined) {
      const idx = Math.max(0, Math.min(offset, current.length))
      current.splice(idx, 0, item)
    } else {
      current.push(item)
    }
    this.rawSidebar[rawZone] = current
    this.reflowSidebar()

    return () => {
      this.rawSidebar[rawZone] = this.rawSidebar[rawZone].filter((entry) => entry.id !== id)
      this.reflowSidebar()
    }
  }

  clearAll() {
    this.rawSeoPatch = {}
    this.rawSeoLayers = []
    this.rawHeader = createEmptyHeaderSlots()
    this.rawSidebar = createEmptySidebarSlots()
    this.autos = []
    this.bumpSeo()
    this.syncHeader()
    this.syncSidebar()
  }
}


const AUTO_NO_ANCHOR = '[sidebar] auto: нет занятого слота, блок не показан'
const AUTO_NO_ROOM = '[sidebar] auto: свободной зоны нет, блок не показан'

/**
 * `auto` заполняет зоны без явной регистрации, сверху вниз.
 * Каркас (`frame`) зону не занимает. Нет ни одной занятой зоны — `auto` не рисуется.
 */
export function placeSidebarSlots(
  fixed: SidebarSlots,
  autos: readonly SlotItem[],
): { slots: SidebarSlots; warn: string | null } {
  const slots = cloneSidebarSlots(fixed)
  if (autos.length === 0) return { slots, warn: null }
  const occupied = SIDEBAR_ZONES.filter((zone) => slots[zone].some((item) => !item.frame))
  if (occupied.length === 0) return { slots, warn: AUTO_NO_ANCHOR }
  const free = SIDEBAR_ZONES.filter((zone) => !occupied.includes(zone))
  let dropped = false
  for (const item of autos) {
    const zone = free.shift()
    if (!zone) {
      dropped = true
      continue
    }
    const current = slots[zone]
    if (item.offset !== undefined) {
      const idx = Math.max(0, Math.min(item.offset, current.length))
      current.splice(idx, 0, item)
    } else {
      current.push(item)
    }
  }
  return { slots, warn: dropped ? AUTO_NO_ROOM : null }
}

const PAGE_CONTEXT_KEY = Symbol('PAGE_CONTEXT')

export function setPageContext(initialSeo: HeadSeo = {}): PageState {
  const state = new PageState(initialSeo)
  setContext(PAGE_CONTEXT_KEY, state)
  return state
}

export function tryUsePage(): PageState | undefined {
  return getContext<PageState | undefined>(PAGE_CONTEXT_KEY)
}

export function usePage(): PageState {
  const ctx = tryUsePage()
  if (!ctx) {
    throw new Error('usePage() must be used inside root layout with setPageContext()')
  }
  return ctx
}

export interface SlotOptions {
  offset?: number
  enabled?: boolean | (() => boolean)
  /** Каркас оболочки: виден, но для `auto` зону не занимает. */
  frame?: boolean
}

/**
 * Синхронная регистрация сниппета в шапку (SSR-safe).
 * Вызывается прямо в теле <script> страницы.
 */
export function useHeaderSlot(
  path: HeaderSlotPath,
  snippet: Snippet,
  options: SlotOptions = {},
): void {
  const page = usePage()
  const isEnabled = typeof options.enabled === 'function' ? options.enabled() : (options.enabled ?? true)

  if (isEnabled) {
    const unregister = page.registerHeaderSlot(path, snippet, options.offset)
    $effect(() => {
      return () => unregister()
    })
  }
}

/**
 * Синхронная регистрация нескольких слотов в шапку.
 */
export function useHeaderSlots(
  slots: Partial<Record<HeaderSlotPath, Snippet>>,
  options: SlotOptions = {},
): void {
  const page = usePage()
  const isEnabled = typeof options.enabled === 'function' ? options.enabled() : (options.enabled ?? true)

  if (isEnabled) {
    const cleanups: (() => void)[] = []
    for (const [path, snippet] of Object.entries(slots) as [HeaderSlotPath, Snippet][]) {
      if (snippet) {
        cleanups.push(page.registerHeaderSlot(path, snippet, options.offset))
      }
    }
    $effect(() => {
      return () => {
        cleanups.forEach((fn) => fn())
      }
    })
  }
}

/**
 * Синхронная регистрация сниппета в сайдбар (3 зоны: top / middle / bottom).
 */
export function useSidebarSlot(
  zone: SidebarSlotPath,
  snippet: Snippet,
  options: SlotOptions = {},
): void {
  const page = usePage()
  const isEnabled = typeof options.enabled === 'function' ? options.enabled() : (options.enabled ?? true)

  if (isEnabled) {
    const unregister = page.registerSidebarSlot(zone, snippet, options.offset, { frame: options.frame })
    $effect(() => {
      return () => unregister()
    })
  }
}

/**
 * Декларативная установка SEO-метаданных маршрута (SSR-safe + реактивна + авто-очистка при уходе).
 * Принимает статический объект `HeadSeo` или геттер `() => HeadSeo`, отслеживаемый в `$derived`.
 */
export function useHeadSeo(
  seo: HeadSeo | (() => HeadSeo),
  options: HeadSeoOptions = {},
): void {
  const page = options.optional ? tryUsePage() : usePage()
  if (!page) return

  const unregister = page.registerSeo(() => {
    const isEnabled = typeof options.enabled === 'function' ? options.enabled() : (options.enabled ?? true)
    if (!isEnabled) return null
    return typeof seo === 'function' ? seo() : seo
  })

  $effect(() => {
    return () => unregister()
  })
}
