// Узкий экран приложения. Не часть модалки: токен `--mobile` принадлежит CSS
// приложения, а `#lib` не должен его читать.
//
// Запрос берётся из `src/app.css` и отдаётся в `matchMedia`. Строка совпадает
// с Uno `max-lg`. Порог в JS не хранится. До эффекта и без окна `matches` = false.
import { browser } from '$app/env'
import { DEV } from 'esm-env'

const TOKEN = '--mobile'
let warned = false

function readMobileQuery(): string | null {
  if (!browser || typeof document === 'undefined') return null
  const raw = getComputedStyle(document.documentElement).getPropertyValue(TOKEN).trim()
  const query = raw.replace(/^["']|["']$/g, '')
  if (!query) {
    if (DEV && !warned) {
      warned = true
      console.warn(`[mobile] нет ${TOKEN} на :root`)
    }
    return null
  }
  return query
}

/** `matches` — окно попало в запрос `--mobile`. До эффекта и без окна `false`: это ПК. */
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
