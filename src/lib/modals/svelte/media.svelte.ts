// Общий `matchMedia` без токена приложения. Узкий экран — `useIsMobile` в
// `#hooks/mobile.svelte.ts`: модалка его не вызывает, флаг приходит пропом.
import { browser } from '$app/env'

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

