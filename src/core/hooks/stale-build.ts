// Свежесть билда: SvelteKit 3 сообщает о новом деплое через `updated.current`
// (`x-sveltekit-version` + проверки на focus/visibility). Ленивый чанк, который
// отдаёт 404 после деплоя, повтором не лечится: страница держит старую карту
// модулей. Единственное восстановление — полная перезагрузка, и она однократна.

const STALE_KEY = 'kit:stale-reload'
const GUARD_MS = 10_000

const STALE_RE =
  /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|error loading dynamically imported module/i

/** Похоже ли на устаревший чанк (деплой сменился), а не на сетевой обрыв. */
export function isStaleChunkError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? '')
  return STALE_RE.test(text)
}

/**
 * Перезагрузить страницу один раз за окно защиты.
 * Возвращает `true`, если перезагрузка запущена.
 */
export function reloadOnceForStale(
  reload: () => void = () => location.reload(),
  now: number = Date.now(),
): boolean {
  try {
    const last = Number(sessionStorage.getItem(STALE_KEY) ?? 0)
    if (Number.isFinite(last) && last > 0 && now - last < GUARD_MS) return false
    sessionStorage.setItem(STALE_KEY, String(now))
  } catch {
    // Приватный режим или запрет storage: не блокируем восстановление.
  }
  reload()
  return true
}
