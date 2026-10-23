// Состояние страницы: SEO-метаданные, 3-рядная шапка и 3-зонный сайдбар на Svelte 5 Runes.
import { getContext, setContext, type Snippet } from 'svelte'

export type HeaderRow = 'top' | 'middle' | 'bottom'
export type HeaderSide = 'start' | 'center' | 'end'
export type HeaderSlotPath = `${HeaderRow}.${HeaderSide}`

export type SidebarZone = 'top' | 'middle' | 'bottom'
export type SidebarSlotPath = `sidebar.${SidebarZone}` | SidebarZone

export const HEADER_ROWS: readonly HeaderRow[] = ['top', 'middle', 'bottom']
export const HEADER_SIDES: readonly HeaderSide[] = ['start', 'center', 'end']
export const SIDEBAR_ZONES: readonly SidebarZone[] = ['top', 'middle', 'bottom']

export interface HeadSeo {
  title?: string
  subTitle?: string
  titleSeparator?: string
  description?: string
  image?: string
  url?: string
  type?: string
  card?: string
  keywords?: string
  author?: string
  siteName?: string
  locale?: string
}

export type SlotItem = {
  id: number
  snippet: Snippet
  offset?: number
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

export function rowHasSlots(row: RowSlots | undefined): boolean {
  if (!row) return false
  return (row.start.length > 0 || row.center.length > 0 || row.end.length > 0)
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
  seo = $state<HeadSeo>({})
  header = $state<HeaderSlots>(createEmptyHeaderSlots())
  sidebar = $state<SidebarSlots>(createEmptySidebarSlots())

  private seq = 0

  constructor(initialSeo: HeadSeo = {}) {
    this.seo = initialSeo
  }

  setSeo(patch: HeadSeo) {
    this.seo = { ...this.seo, ...patch }
  }

  registerHeaderSlot(path: HeaderSlotPath, snippet: Snippet, offset?: number): () => void {
    const [row, side] = path.split('.') as [HeaderRow, HeaderSide]
    const id = ++this.seq
    const item: SlotItem = { id, snippet, offset }
    const current = [...this.header[row][side]]

    if (offset !== undefined) {
      const idx = Math.max(0, Math.min(offset, current.length))
      current.splice(idx, 0, item)
    } else {
      current.push(item)
    }

    this.header[row][side] = current

    return () => {
      this.header[row][side] = this.header[row][side].filter((x) => x.id !== id)
    }
  }

  registerSidebarSlot(zone: SidebarZone | SidebarSlotPath, snippet: Snippet, offset?: number): () => void {
    const rawZone = zone.startsWith('sidebar.') ? (zone.replace('sidebar.', '') as SidebarZone) : (zone as SidebarZone)
    const id = ++this.seq
    const item: SlotItem = { id, snippet, offset }
    const current = [...this.sidebar[rawZone]]

    if (offset !== undefined) {
      const idx = Math.max(0, Math.min(offset, current.length))
      current.splice(idx, 0, item)
    } else {
      current.push(item)
    }

    this.sidebar[rawZone] = current

    return () => {
      this.sidebar[rawZone] = this.sidebar[rawZone].filter((x) => x.id !== id)
    }
  }

  clearAll() {
    this.header = createEmptyHeaderSlots()
    this.sidebar = createEmptySidebarSlots()
  }
}

const PAGE_CONTEXT_KEY = Symbol('PAGE_CONTEXT')

export function setPageContext(initialSeo: HeadSeo = {}): PageState {
  const state = new PageState(initialSeo)
  setContext(PAGE_CONTEXT_KEY, state)
  return state
}

export function usePage(): PageState {
  const ctx = getContext<PageState>(PAGE_CONTEXT_KEY)
  if (!ctx) {
    throw new Error('usePage() must be used inside root layout with setPageContext()')
  }
  return ctx
}

export interface SlotOptions {
  offset?: number
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
  zone: SidebarZone | SidebarSlotPath,
  snippet: Snippet,
  options: SlotOptions = {},
): void {
  const page = usePage()
  const isEnabled = typeof options.enabled === 'function' ? options.enabled() : (options.enabled ?? true)

  if (isEnabled) {
    const unregister = page.registerSidebarSlot(zone, snippet, options.offset)
    $effect(() => {
      return () => unregister()
    })
  }
}

/**
 * Установка SEO-метаданных страницы.
 */
export function useHeadSeo(seo: HeadSeo | (() => HeadSeo)): void {
  const page = usePage()
  const data = typeof seo === 'function' ? seo() : seo
  page.setSeo(data)
}
