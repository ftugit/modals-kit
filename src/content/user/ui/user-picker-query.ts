// Разбор адреса пикера пользователей. Чистые функции: адрес — внешний ввод, и
// слепые касты в компоненте (`as 'pick' | 'chosen' | null`) расхождение между
// адресом и разметкой не ловили вовсе.
//
// Лимит общий со страницей `/users/pick`: одно и то же намерение не должно
// принимать разное количество id на модалке и на странице.

/** Предел набора выбранных: столько же, сколько принимает `/users/pick`. */
export const USER_PICKER_IDS_MAX = 500

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const STEPS = ['pick', 'chosen'] as const
export type UserPickerStep = (typeof STEPS)[number]

/**
 * Набор выбранных из адреса: split/trim, пустые и не-UUID вон, обрезка по
 * пределу. Пустой параметр (`?picked=`) — это явный пустой выбор, а не
 * «нет параметра»: только во втором случае берётся `fallback`.
 */
export function parsePickedIds(
  raw: string | null | undefined,
  fallback: readonly string[] = [],
  limit: number = USER_PICKER_IDS_MAX,
): string[] {
  if (raw === null || raw === undefined) return [...fallback]
  const out: string[] = []
  for (const part of raw.split(',')) {
    const id = part.trim().toLowerCase()
    if (!UUID_RE.test(id)) continue
    if (!out.includes(id)) out.push(id)
    if (out.length >= limit) break
  }
  return out
}

/** Шаг пикера из адреса. Мусор — первый шаг, а не пустота. */
export function parsePickerStep(raw: string | null | undefined): UserPickerStep {
  const value = raw?.trim().toLowerCase()
  return STEPS.includes(value as UserPickerStep) ? (value as UserPickerStep) : 'pick'
}
