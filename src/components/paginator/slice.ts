import type { Extra } from '#lib/paginate/index.js'
import type { ResolvedHostOptions } from '#lib/paginate/svelte/index.js'

/**
 * Извлекает ISO-время активного среза из `state.extra`.
 *
 * Поддерживает:
 * - `extra.sliceAt` — явная ISO-строка произвольного источника;
 * - `extra.asof` — постраничный срез формата `<ISO>|<id>` (либо чистый ISO);
 * - `extra.begAt` — курсорная отсечка (ISO-время закладки или выпуска токена).
 *
 * На чистой 1-й странице ни один из этих ключей не заполнен (`asofHead` и `headAt`
 * сюда намеренно не входят), поэтому возвращается `null`.
 */
export function resolveSliceTimestamp(extra: Extra | undefined): string | null {
  if (!extra) return null
  for (const key of ['sliceAt', 'asof', 'begAt'] as const) {
    const raw = extra[key]
    if (typeof raw !== 'string' || raw.length === 0) continue
    const cut = raw.lastIndexOf('|')
    const iso = cut > 0 ? raw.slice(0, cut) : raw
    if (!Number.isNaN(Date.parse(iso))) return iso
  }
  return null
}

/** Поток чата направлен снизу вверх (история догружается вверх). */
export function isChatStreamMode(
  opts: Pick<ResolvedHostOptions, 'topTrigger' | 'bottomTrigger'>,
): boolean {
  return opts.topTrigger === 'chat' || opts.bottomTrigger === 'chat'
}

/**
 * Шаг прогресса плавного скрытия `progress ∈ [0, 1]` при прокрутке.
 *
 * - Обычный поток (`!chatMode`): скролл вниз (`deltaY > 0`) скрывает плашку (`progress → 1`),
 *   скролл вверх (`deltaY < 0`) возвращает её (`progress → 0`).
 * - Поток чата (`chatMode`): скролл вверх (`deltaY < 0`) скрывает плашку (`progress → 1`),
 *   скролл вниз (`deltaY > 0`) возвращает её (`progress → 0`).
 */
export function nextSliceScrollProgress(
  prevProgress: number,
  scrollDeltaY: number,
  distancePx: number,
  chatMode: boolean,
): number {
  if (scrollDeltaY === 0) return prevProgress
  const directedDelta = chatMode ? -scrollDeltaY : scrollDeltaY
  const span = Math.max(24, distancePx)
  return Math.min(1, Math.max(0, prevProgress + directedDelta / span))
}

/**
 * Решение о рендере плашки среза.
 *
 * - Без активной метки времени (`sliceAt === null`) отображать нечего → `false`.
 * - `enable === false` принудительно скрывает плашку.
 * - `jsOnly && !hydrated` скрывает плашку при отсутствии JavaScript (на SSR / до гидрации).
 * - `enable === true` принудительно включает отображение в обход сценария `firstPageOnly`
 *   (например, в раскладке карточек или в режиме одной страницы `mode="single"`).
 * - При `enable === undefined` действует сценарий `firstPageOnly` (`currentPage === 1`).
 */
export function shouldRenderPageSlice(params: {
  sliceAt: string | null
  enable?: boolean
  firstPageOnly?: boolean
  currentPage: number
  jsOnly?: boolean
  hydrated: boolean
}): boolean {
  if (!params.sliceAt) return false
  if (params.enable === false) return false
  if (params.jsOnly && !params.hydrated) return false
  if (params.enable === true) return true
  if (params.firstPageOnly && params.currentPage !== 1) return false
  return true
}
