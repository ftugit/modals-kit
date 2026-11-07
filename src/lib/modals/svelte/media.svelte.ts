// Медиазапрос — единственное, что осталось от `shell.tsx` в слое фреймворка.
// Вся остальная геометрия живёт в `core.ts` чистыми функциями.
//
// Узкий экран приложения — `useIsMobile`. Он не живёт в `#hooks`: этот слой
// модалке импортировать нельзя, а порог один для оболочки, модалки и select.
import { browser } from '$app/env'
import { DEV } from 'esm-env'

/**
 * Реактивный медиазапрос.
 *
 * На сервере всегда `false`: узкий режим — свойство окна, а его нет.
 * Так же вёл себя оригинал (`useMediaQuery` возвращал false до монтирования).
 */
export function createMediaQuery(query: () => string) {
  let matches = $state(false)

  $effect(() => {
    if (!browser) return
    const mql = window.matchMedia(query())
    matches = mql.matches
    const onChange = (e: MediaQueryListEvent) => {
      matches = e.matches
    }
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  })

  return {
    get matches() {
      return matches
    },
  }
}

/**
 * Произвольный порог в пикселях. Не «узкий экран» приложения:
 * тот читает CSS `--mobile` через `useIsMobile`.
 *
 * Граница — `breakpoint - 1`, как в оригинале (`max-width: breakpoint - 1`).
 */
export function createIsNarrow(breakpoint: () => number) {
  return createMediaQuery(() => `(max-width: ${breakpoint() - 1}px)`)
}

const MOBILE_TOKEN = '--mobile'
let warnedMissingMobile = false

function readMobileQuery(): string | null {
  if (!browser || typeof document === 'undefined') return null
  const raw = getComputedStyle(document.documentElement).getPropertyValue(MOBILE_TOKEN).trim()
  const query = raw.replace(/^["']|["']$/g, '')
  if (!query) {
    if (DEV && !warnedMissingMobile) {
      warnedMissingMobile = true
      console.warn(`[mobile] нет ${MOBILE_TOKEN} на :root`)
    }
    return null
  }
  return query
}

/**
 * Узкий экран приложения.
 *
 * Запрос читается из CSS `--mobile` (`src/app.css`) и отдаётся в `matchMedia`.
 * Строка совпадает с Uno `max-lg`. Порог в JS не хранится.
 * До эффекта и без окна `matches` = false.
 */
export function useIsMobile() {
  let matches = $state(false)

  $effect(() => {
    if (!browser || typeof window.matchMedia !== 'function') return
    const query = readMobileQuery()
    if (!query) return
    let mql: MediaQueryList
    try {
      mql = window.matchMedia(query)
    } catch {
      return
    }
    matches = mql.matches
    const onChange = () => {
      matches = mql.matches
    }
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  })

  return {
    get matches() {
      return matches
    },
  }
}
