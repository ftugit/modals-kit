/**
 * Активные фильтры списка. Ключи те же, что у счётчика кнопки:
 * отличие extra от умолчания и нестандартный размер порции.
 * Подписи приходят от вызывающего — из описания его формы, не из второй схемы.
 */
import type { ListingFilters } from './types.js'

export type ActiveFilterItem = {
  key: string
  /** `extra` снимается ключом. `pageSize` — размером порции, это не ключ extra. */
  kind: 'extra' | 'pageSize'
  value: string
  label: string
  text: string
}

const SIZE_KEY = 'size'

export function activeFilterItems(
  filters: Pick<ListingFilters, 'keys' | 'defaults' | 'ignore' | 'pageSize' | 'labels' | 'text' | 'sizeKey'>,
  extra: Record<string, unknown>,
  pageSize: number,
): ActiveFilterItem[] {
  const items: ActiveFilterItem[] = []
  for (const key of filters.keys) {
    if (filters.ignore?.includes(key)) continue
    const raw = extra[key]
    if (typeof raw !== 'string' || raw === '' || raw === filters.defaults[key]) continue
    items.push({
      key,
      kind: 'extra',
      value: raw,
      label: filters.labels?.[key] ?? key,
      text: filters.text?.(key, raw) ?? raw,
    })
  }
  if (pageSize !== filters.pageSize) {
    const key = filters.sizeKey ?? SIZE_KEY
    const value = String(pageSize)
    items.push({
      key,
      kind: 'pageSize',
      value,
      label: filters.labels?.[key] ?? key,
      text: filters.text?.(key, value) ?? value,
    })
  }
  return items
}
