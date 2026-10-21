// Цепочка ключей шагов: полный ключ — сегменты уровней через точку
// (`auth.restore`): первый сегмент — шаг хоста-корня, остаток — ключи
// аддонов на этом шаге (formSteps, вложенные шаги). Адрес несёт полный
// ключ целиком в значении ключа брони; каждый уровень читает свой
// сегмент. Чистые функции — без состояния и без адреса: их делят хост и
// аддоны.

/** Первый сегмент полного ключа — собственный шаг уровня (хоста). */
export function segmentOf(fullKey: string | null): string | null {
  if (!fullKey) return null
  const dot = fullKey.indexOf('.')
  return dot === -1 ? fullKey : fullKey.slice(0, dot)
}

/**
 * Остаток полного ключа после сегмента `at` — ключ следующего уровня
 * (аддона на шаге `at`). Полный ключ равен `at` — остаток пуст (мы внутри
 * шага, под-ключа нет); чужой первый сегмент — `null` (не наш куст).
 */
export function suffixOf(fullKey: string | null, at: string): string | null {
  if (!fullKey) return null
  if (fullKey === at) return ''
  return fullKey.startsWith(`${at}.`) ? fullKey.slice(at.length + 1) : null
}
