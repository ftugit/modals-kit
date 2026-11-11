/** Общие правила захвата и возврата нарезанного блока фильтров. */
export type FilterBlockEntry = {
  key: string
  label: string
  element: HTMLElement
  home: HTMLElement
}

export type ClaimDecision = 'reject' | 'keep' | 'replace'

/** Панель не меняет владельца, список может сменить отсоединённый экземпляр. */
export function decideBlockClaim(
  current: FilterBlockEntry | undefined,
  entry: FilterBlockEntry,
  replaceDisconnected: boolean,
): ClaimDecision {
  if (!current) return 'replace'
  if (current.element === entry.element) {
    return current.label === entry.label && current.home === entry.home ? 'keep' : 'replace'
  }
  return replaceDisconnected && !current.element.isConnected ? 'replace' : 'reject'
}

/** Вернуть открытый блок на место перед исчезновением поверхностного хоста. */
export function reclaimBlock(blocks: Record<string, FilterBlockEntry>, key: string | null): void {
  const entry = key ? blocks[key] : undefined
  if (entry && entry.element.parentElement !== entry.home) entry.home.appendChild(entry.element)
}
