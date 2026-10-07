// Svelte 5-хук lib search: живая статистика перехвата (скачано/подошло/…).
//
// Слой тот же, что у подписи коррекции (`correction.svelte.ts`): lib не знает
// фреймворка приложения, реактивность — в тонком биндинге. Реестр статистики
// живёт в `../registry` и наполняется декоратором `withSearch`.
import { untrack } from 'svelte'
import { getSearchStats, onSearchStats } from '../registry'
import type { SearchInterceptStats } from '../accumulator'

/** Статистика перехвата поиска: `null` — усиление сейчас не в цепочке. */
export function useSearchStats(name: string): () => SearchInterceptStats | null {
  const searchName = untrack(() => name)
  let stats = $state.raw<SearchInterceptStats | null>(getSearchStats(searchName))

  $effect(() => {
    stats = getSearchStats(searchName)
    const off = onSearchStats(searchName, (next) => {
      stats = next
    })
    return () => off()
  })

  return () => stats
}
