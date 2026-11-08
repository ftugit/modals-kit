/**
 * Реестр нарезанных блоков одной панели. Схема и слой имён — те, что панель
 * уже передала форме. Блок регистрируется сам, когда внутри ровно один ключ.
 */
import { getContext, setContext } from 'svelte'
import type { CatalogFilterSchema } from '#lib/paginate/filters/index.js'

const FILTER_BLOCKS = Symbol('filter-blocks')

export type FilterBlockEntry = {
  key: string
  label: string
  element: HTMLElement
  home: HTMLElement
}

export type FilterBlocksContext = {
  schema: CatalogFilterSchema
  prefix: string
  blocks: Record<string, FilterBlockEntry>
  openKey: string | null
  /** Куда открытая метка переносит свой блок. Пусто — всплывашка ещё не готова. */
  slot: HTMLElement | null
  setOpen: (key: string | null) => void
  setSlot: (slot: HTMLElement | null) => void
  claim: (entry: FilterBlockEntry) => boolean
  release: (key: string, element: HTMLElement) => void
  /** Вернуть открытый блок на место до того, как поверхность хоста исчезнет. */
  reclaim: () => void
}

export function provideFilterBlocks(read: () => { schema: CatalogFilterSchema; prefix: string }): FilterBlocksContext {
  const state = $state({
    blocks: {} as Record<string, FilterBlockEntry>,
    openKey: null as string | null,
    slot: null as HTMLElement | null,
  })

  const api: FilterBlocksContext = {
    get schema() {
      return read().schema
    },
    get prefix() {
      return read().prefix
    },
    get blocks() {
      return state.blocks
    },
    get openKey() {
      return state.openKey
    },
    get slot() {
      return state.slot
    },
    setOpen(key) {
      state.openKey = key
    },
    setSlot(slot) {
      state.slot = slot
    },
    claim(entry) {
      const current = state.blocks[entry.key]
      if (current?.element === entry.element) {
        if (current.label !== entry.label || current.home !== entry.home) state.blocks[entry.key] = entry
        return true
      }
      if (current) return false
      state.blocks[entry.key] = entry
      return true
    },
    release(key, element) {
      if (state.blocks[key]?.element !== element) return
      delete state.blocks[key]
      if (state.openKey === key) state.openKey = null
    },
    reclaim() {
      const key = state.openKey
      const entry = key ? state.blocks[key] : undefined
      if (!entry) return
      if (entry.element.parentElement !== entry.home) entry.home.appendChild(entry.element)
    },
  }

  setContext(FILTER_BLOCKS, api)
  return api
}

export function useFilterBlocks(): FilterBlocksContext | undefined {
  return getContext<FilterBlocksContext | undefined>(FILTER_BLOCKS)
}
