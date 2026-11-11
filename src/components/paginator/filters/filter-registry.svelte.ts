/**
 * Реестр нарезанных блоков по имени списка.
 *
 * Форма рисуется в sidebar и в модалке, не ребёнком `Listing`. Контекст
 * списка до блока не доходит, поэтому блоки пишутся сюда, а список читает
 * их по своему имени. Контекст ниже ставит сама форма: только чтобы блок
 * знал, в какой список регистрироваться. `Listing` контекст не ставит.
 */
import { getContext, setContext } from 'svelte'
import type { CatalogFilterSchema } from '#lib/paginate/filters/index.js'
import { decideBlockClaim, reclaimBlock, type FilterBlockEntry } from './filter-block-store.js'

const FILTER_LIST = Symbol('filter-list')

export type FilterListMeta = {
  schema?: CatalogFilterSchema | null
  prefix?: string
  /** Имя поля или ключ чипа → подпись из описания формы. */
  labels?: Readonly<Record<string, string>>
  /** Имя поля → ключ чипа, если это не само имя (`sc.login` → `scopes`). */
  aliases?: Readonly<Record<string, string>>
}

export type FilterListRecord = {
  schema: CatalogFilterSchema | null
  prefix: string
  labels: Record<string, string>
  aliases: Record<string, string>
  blocks: Record<string, FilterBlockEntry>
  openKey: string | null
  slot: HTMLElement | null
}

function blank(): FilterListRecord {
  return {
    schema: null,
    prefix: '',
    labels: {},
    aliases: {},
    blocks: {},
    openKey: null,
    slot: null,
  }
}

export const filterLists = $state<Record<string, FilterListRecord>>({})

export function provideFilterList(name: string, meta: FilterListMeta = {}): void {
  setContext(FILTER_LIST, name)
  if (!filterLists[name]) filterLists[name] = blank()
  const list = filterLists[name]
  if (meta.schema !== undefined) list.schema = meta.schema
  if (meta.prefix !== undefined) list.prefix = meta.prefix
  if (meta.labels) list.labels = { ...meta.labels }
  if (meta.aliases) list.aliases = { ...meta.aliases }
}

export function useFilterListName(): string | undefined {
  return getContext<string | undefined>(FILTER_LIST)
}

export function claimFilterList(name: string, entry: FilterBlockEntry): boolean {
  const list = filterLists[name]
  if (!list) return false
  // Список переживает пересоздание формы, поэтому отсоединённый блок можно заменить.
  const decision = decideBlockClaim(list.blocks[entry.key], entry, true)
  if (decision === 'reject') return false
  if (decision === 'replace') list.blocks = { ...list.blocks, [entry.key]: entry }
  return true
}

export function releaseFilterList(name: string, key: string, element: HTMLElement): void {
  const list = filterLists[name]
  const current = list?.blocks[key]
  if (!list || current?.element !== element) return
  const next = { ...list.blocks }
  delete next[key]
  list.blocks = next
  if (list.openKey === key) list.openKey = null
}

export function setFilterListOpen(name: string, key: string | null): void {
  const list = filterLists[name]
  if (!list) return
  list.openKey = key
}

export function setFilterListSlot(name: string, slot: HTMLElement | null): void {
  const list = filterLists[name]
  if (!list) return
  list.slot = slot
}

export function reclaimFilterList(name: string): void {
  const list = filterLists[name]
  if (!list) return
  reclaimBlock(list.blocks, list.openKey)
}

export function resetFilterList(name: string): void {
  delete filterLists[name]
}
