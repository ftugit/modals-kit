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
  /**
   * Правило места при складывании, не разовая вставка.
   * Нет поля — дописать в конец. Снятие соседа пересчитывает позицию.
   */
  offset?: number
  /**
   * Каркас оболочки. Слот виден, но зону для `auto` не занимает:
   * layout всегда сидит во всех трёх, иначе свободной зоны не было бы.
   */
  frame?: boolean
  /** Поставлен режимом `auto`, а не явной зоной. */
  auto?: boolean
}

/** Слот как есть — в конец. Пара — вставка на `offset` уже сложенного списка. */
export type MergeEntry = SlotItem | readonly [offset: number, item: SlotItem]

const MERGE_MARKER = Symbol('page.merge')

interface MergeMarker {
  [MERGE_MARKER]: true
  entries: readonly MergeEntry[]
}

/**
 * Помечает регистрацию как слияние, а не замену ячейки.
 * Сам слот не читает и сниппеты не склеивает: это делает `applySlot`.
 */
export function mergeSlot(entries: readonly MergeEntry[]): SlotItem[] {
  const marker: MergeMarker = { [MERGE_MARKER]: true, entries }
  return marker as unknown as SlotItem[]
}

/** Маркер `mergeSlot`, а не готовый массив слотов. */
export function isMergeSlot(value: SlotItem[] | undefined): value is SlotItem[] & MergeMarker {
  return (
    value !== undefined &&
    !Array.isArray(value) &&
    typeof value === 'object' &&
    MERGE_MARKER in value
  )
}

/**
 * Следующий набор к уже лежащему.
 * Без маркера `next` заменяет `base`. С маркером элементы вставляются по offset
 * или дописываются в конец. `next === undefined` оставляет `base`.
 * Одна функция на ячейку шапки и на зону sidebar.
 */
export function applySlot(
  base: readonly SlotItem[] | undefined,
  next: SlotItem[] | undefined,
): SlotItem[] | undefined {
  if (next === undefined) return base as SlotItem[] | undefined
  if (!isMergeSlot(next)) return next

  const result = [...(base ?? [])]
  for (const entry of (next as unknown as MergeMarker).entries) {
    if (isOffsetEntry(entry)) {
      const [offset, item] = entry
      const index = Math.min(Math.max(0, offset), result.length)
      result.splice(index, 0, item)
    } else {
      result.push(entry)
    }
  }
  return result
}

function isOffsetEntry(entry: MergeEntry): entry is readonly [number, SlotItem] {
  return Array.isArray(entry)
}

export function entryOf(item: SlotItem): MergeEntry {
  return item.offset === undefined ? item : [item.offset, item]
}

function foldMerged(entries: readonly MergeEntry[]): SlotItem[] {
  return applySlot(undefined, mergeSlot(entries)) ?? []
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
  /** Регистрации ячеек шапки. Порядок — порядок складывания, не готовая вёрстка. */
  private headerRegs: HeaderReg[] = []
  /** Явные зоны sidebar. `auto` здесь не лежит. */
  private sidebarRegs: SidebarReg[] = []
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
    this.header = this.foldHeader()
  }

  private syncSidebar(): void {
    this.reflowSidebar()
  }

  /** `auto` в порядке регистрации. Не лежит в зоне, пока reflow его не поставит. */
  private autos: SlotItem[] = []
  private autoWarnTimer: ReturnType<typeof setTimeout> | undefined

  private foldHeader(): HeaderSlots {
    const out = createEmptyHeaderSlots()
    for (const row of HEADER_ROWS) {
      for (const side of HEADER_SIDES) {
        const path = `${row}.${side}` as HeaderSlotPath
        out[row][side] = foldMerged(
          this.headerRegs.filter((reg) => reg.path === path).map((reg) => entryOf(reg.item)),
        )
      }
    }
    return out
  }

  private foldSidebar(): SidebarSlots {
    const out = createEmptySidebarSlots()
    for (const zone of SIDEBAR_ZONES) {
      out[zone] = foldMerged(
        this.sidebarRegs.filter((reg) => reg.zone === zone).map((reg) => entryOf(reg.item)),
      )
    }
    return out
  }

  private reflowSidebar(): void {
    const { slots, warn } = placeSidebarSlots(this.foldSidebar(), this.autos)
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

  /**
   * Всегда слияние: сниппет дописывается или встаёт на `offset`.
   * Ячейку целиком эта регистрация не заменяет. Снятие убирает только свой id,
   * остальные позиции складываются заново.
   */
  registerHeaderSlot(
    path: HeaderSlotPath,
    snippet: Snippet,
    options: SlotRegisterOptions = {},
  ): () => void {
    const id = ++this.seq
    const item = slotItem(id, snippet, options)
    this.headerRegs = [...this.headerRegs, { id, path, item }]
    this.syncHeader()

    return () => {
      this.headerRegs = this.headerRegs.filter((reg) => reg.id !== id)
      this.syncHeader()
    }
  }

  /**
   * Зона `top` / `middle` / `bottom` или `auto`.
   * Явная зона сливается так же, как ячейка шапки. `auto` ищет свободную зону
   * и в слияние не входит: своей `applySlot` он пользуется уже внутри выбранной зоны.
   * Каркас (`frame`) виден и в «занятости» не считается.
   */
  registerSidebarSlot(
    zone: SidebarSlotPath,
    snippet: Snippet,
    options: SlotRegisterOptions = {},
  ): () => void {
    const raw = zone.startsWith('sidebar.') ? zone.slice('sidebar.'.length) : zone
    const id = ++this.seq
    const item: SlotItem = {
      ...slotItem(id, snippet, options),
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
    this.sidebarRegs = [...this.sidebarRegs, { id, zone: rawZone, item }]
    this.reflowSidebar()

    return () => {
      this.sidebarRegs = this.sidebarRegs.filter((reg) => reg.id !== id)
      this.reflowSidebar()
    }
  }

  clearAll() {
    this.rawSeoPatch = {}
    this.rawSeoLayers = []
    this.headerRegs = []
    this.sidebarRegs = []
    this.autos = []
    this.bumpSeo()
    this.syncHeader()
    this.syncSidebar()
  }
}

type HeaderReg = { id: number; path: HeaderSlotPath; item: SlotItem }
type SidebarReg = { id: number; zone: SidebarZone; item: SlotItem }

function slotItem(id: number, snippet: Snippet, options: SlotRegisterOptions): SlotItem {
  return {
    id,
    snippet,
    ...(options.offset !== undefined ? { offset: options.offset } : {}),
    ...(options.frame ? { frame: true } : {}),
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
    slots[zone] = applySlot(slots[zone], mergeSlot([entryOf(item)])) ?? []
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

export interface SlotRegisterOptions {
  /** Позиция при складывании. Нет — дописать в конец. */
  offset?: number
  /** Каркас оболочки: виден, но для `auto` зону не занимает. */
  frame?: boolean
}

export interface SlotOptions extends SlotRegisterOptions {
  enabled?: boolean | (() => boolean)
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
    const unregister = page.registerHeaderSlot(path, snippet, { offset: options.offset })
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
        cleanups.push(page.registerHeaderSlot(path, snippet, { offset: options.offset }))
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
    const unregister = page.registerSidebarSlot(zone, snippet, {
      offset: options.offset,
      frame: options.frame,
    })
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
