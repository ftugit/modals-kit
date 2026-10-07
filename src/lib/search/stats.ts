// Живая статистика перехвата (скачано/подошло/выдано) — ОБЩИЙ канал lib/search.
//
// Зачем отдельным модулем: статистику наполняет декоратор `withLibSearch`
// (аккумулятор), а читают панели и хуки. Реестр поисков (`./registry`) уже
// импортирует аккумулятор, поэтому канал живёт сбоку от него — иначе получился
// бы цикл импортов. Тип — только `import type`: на рантайме связи с
// аккумулятором нет.
//
// Смысл канала тот же, что у подписи коррекции: состояние принадлежит lib/search,
// а не странице, поэтому потребителю не нужно изобретать собственный реестр;
// `null` — перехват сейчас не в цепочке (у источника нет усиления или запрос
// пуст), счётчики панели при этом гаснут.
import type { SearchInterceptStats } from './accumulator'

const stats = new Map<string, SearchInterceptStats | null>()
const listeners = new Map<string, Set<(stats: SearchInterceptStats | null) => void>>()

export function reportSearchStats(name: string, next: SearchInterceptStats | null): void {
  stats.set(name, next)
  for (const listener of listeners.get(name) ?? []) listener(next)
}

export function getSearchStats(name: string): SearchInterceptStats | null {
  return stats.get(name) ?? null
}

/** Подписка отдаёт текущее значение сразу (как реестр коррекции). */
export function onSearchStats(
  name: string,
  listener: (stats: SearchInterceptStats | null) => void,
): () => void {
  const set = listeners.get(name) ?? new Set<(stats: SearchInterceptStats | null) => void>()
  listeners.set(name, set)
  set.add(listener)
  listener(getSearchStats(name))
  return () => {
    set.delete(listener)
    if (!set.size) listeners.delete(name)
  }
}

/** Только для тестов: сброс канала. */
export function resetSearchStats(): void {
  stats.clear()
  listeners.clear()
}
