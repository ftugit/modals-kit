// Svelte 5-хук lib search: живая статистика перехвата (скачано/подошло/…).
//
// Слой тот же, что у подписи коррекции (`correction.svelte.ts`): ядро lib/search
// о фреймворке не знает, реактивность живёт в тонком биндинге, а состояние —
// в общем канале (`../stats`), поэтому несколько хуков на одно имя видят одни
// и те же числа.
import { createSubscriber } from 'svelte/reactivity'
import { getSearchStats, onSearchStats } from '../stats'
import type { SearchInterceptStats } from '../accumulator'

export type SearchStatsAccessor = (() => SearchInterceptStats | null) & {
  readonly current: SearchInterceptStats | null
}

/**
 * Статистика перехвата поиска: `null` — усиление сейчас не в цепочке.
 * Канал подключён через `createSubscriber` — как и подпись коррекции (C8).
 */
export function useSearchStats(name: string): SearchStatsAccessor {
  const subscribe = createSubscriber((update) => onSearchStats(name, update))
  const read = (): SearchInterceptStats | null => {
    subscribe()
    return getSearchStats(name)
  }
  Object.defineProperty(read, 'current', { get: read, enumerable: true })
  return read as SearchStatsAccessor
}
