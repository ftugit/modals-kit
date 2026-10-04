// Медиазапрос — единственное, что осталось от `shell.tsx` в слое фреймворка.
// Вся остальная геометрия живёт в `core.ts` чистыми функциями.
import { browser } from '$app/environment'

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
 * Мобильный режим включается по ширине окна.
 *
 * Порог реактивный: приходит из настроек хоста. Граница — `breakpoint - 1`,
 * как в оригинале (`max-width: breakpoint - 1`), поэтому при `768`
 * мобильным считается всё до 767 включительно.
 */
export function createIsNarrow(breakpoint: () => number) {
  return createMediaQuery(() => `(max-width: ${breakpoint() - 1}px)`)
}
