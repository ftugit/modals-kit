/**
 * Чистая математика и типы автопродления сессии (`0` внешних зависимостей и `0` UI/сети).
 *
 * Правило владельца: выстрел ЗА 5% времени жизни, НЕ МЕНЕЕ 60 с; точка выстрела
 * выбирается случайно внутри лид-окна (джиттер), чтобы вкладки не стреляли разом.
 */

export type VaultProfile = {
  readonly nickname: string | null
  readonly avatarUrl: string | null
}

/**
 * Публичные метаданные сессии для клиентского `vault` (из SSR `load` или ответа POST).
 * Сами криптографические токены (`auth_sid` и `auth_tmp`) остаются строго в `HttpOnly`-куках
 * и никогда не сериализуются в HTML страницы, JSON или `BroadcastChannel`.
 */
export type VaultSessionMeta = {
  /** Идентификатор субъекта (`user_auth.id`). */
  readonly sub: string
  /** Серверное время выпуска снимка (мс от эпохи). */
  readonly iat: number
  /** Серверное время истечения короткого `auth_tmp` (мс от эпохи). */
  readonly expiresAt: number
  /** Полный срок жизни короткого токена (мс), из которого считается лид-окно. */
  readonly ttlMs: number
  /** Публичная витрина профиля. */
  readonly prof: VaultProfile
  /** Выданные аккаунту права в текущей сессии (`user_auth.permissions`). */
  readonly permissions: readonly string[]
}

export type RenewData = VaultSessionMeta

/** Стабильный ключ сравнения поколений снимка сессии. */
export function snapshotKeyOf(payload: VaultSessionMeta | null | undefined): string {
  if (!payload) return 'guest'
  const permsKey = payload.permissions?.length ? [...payload.permissions].sort().join(',') : ''
  return `${payload.sub}:${payload.iat}:${payload.expiresAt}:${payload.prof.nickname ?? ''}:${payload.prof.avatarUrl ?? ''}:${permsKey}`
}

/** Лид-окно в миллисекундах: 5% срока жизни, но не меньше 60 с. */
export function leadFor(ttlMs: number): number {
  return Math.max(Math.round(ttlMs * 0.05), 60_000)
}

/**
 * Момент выстрела: конец лид-окна минус случайная доля окна. При часе TTL
 * окно 3 мин — вкладки стреляют в разные секунды третьей минуты.
 */
export function fireAt(expiresAtMs: number, ttlMs: number, rand: () => number = Math.random): number {
  const lead = leadFor(ttlMs)
  const jitter = Math.round(lead * rand())
  return expiresAtMs - lead + jitter
}

/** Пора ли продлевать при вызове API / пробуждении вкладки (страховка от замороженных таймеров). */
export function overdue(expiresAtMs: number, nowMs: number): boolean {
  return nowMs >= expiresAtMs - leadFor(60_000)
}
