// Svelte 5-хук lib search: живая статистика перехвата (скачано/подошло/…).
//
// Слой тот же, что у подписи коррекции (`correction.svelte.ts`): ядро lib/search
// о фреймворке не знает, реактивность живёт в тонком биндинге, а состояние —
// в общем канале (`../stats`), поэтому несколько хуков на одно имя видят одни
// и те же числа.
import { untrack } from 'svelte'
import { getSearchStats, onSearchStats } from '../stats'
import type { SearchInterceptStats } from '../accumulator'

export type SearchStatsAccessor = (() => SearchInterceptStats | null) & {
  readonly current: SearchInterceptStats | null
}

/** Статистика перехвата поиска: `null` — усиление сейчас не в цепочке. */
export function useSearchStats(name: string): SearchStatsAccessor {
  const searchName = untrack(() => name)
  let stats = $state.raw<SearchInterceptStats | null>(getSearchStats(searchName))

  $effect(() => {
    stats = getSearchStats(searchName)
    const off = onSearchStats(searchName, (next) => {
      stats = next
    })
    return () => off()
  })

  const getter = () => stats
  Object.defineProperty(getter, 'current', {
    get: () => stats,
    enumerable: true,
  })

  return getter as SearchStatsAccessor
}
