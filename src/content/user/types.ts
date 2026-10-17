/**
 * Типы каркаса авторизации. Ядро (`api.ts`) не знает ни Request/Response, ни
 * SvelteKit: голые данные на входе, голый результат с кодом на выходе —
 * один и тот же вызов годится для REST (`+server.ts`) и POST-экшена
 * (`+page.server.ts`), перевод — в адаптере (`sveltekit.ts`).
 *
 * Каркас без реализации: тела бросают `Error` с указанием на план
 * (`docs/design/auth-seed.md`). Оценивается ЦЕПОЧКА вызова и покрытие
 * правил статьи об отзыве токенов, не поведение.
 */

/** Токен доступа: короткий (15 минут, статья §«short lifespan»). */
export type AccessTokenClaims = {
  /** JWT ID — ключ сессии и ключ чёрного списка. */
  jti: string
  /** Идентификатор строки auth (seed = псевдоним, приватность §4 плана). */
  sub: string
  /** Версия токенов identity: не совпала — все токены мертвы (статья, «versioning»). */
  ver: number
  /** Ключ подписи: ротация секрета (статья, «rotating secrets»). */
  kid: string
  iat: number
  exp: number
}

/** Сессия в хранилище (бронь `#lib/cache`): источник правды о живости. */
export type SessionRecord = {
  jti: string
  sub: string
  /** Хеш подсети клиента для счётчика аномалий; сам IP не хранится (§4 плана). */
  subnet: string | undefined
  createdAt: number
  expiresAt: number
}

/** Результат `verify` — то, что получает `dbHandle` как доверенный principal. */
export type Principal = { id: string }

/** Ответы API — данные без ошибок; ошибки (код+путь) — `error.ts`. */
export type Challenge = { nonce: string; expiresAt: number }
export type SessionView = { jti: string; createdAt: number; expiresAt: number; subnet: string | undefined }
export type KeyView = { kid: string; retired: readonly string[] }
export type RevocationEntry = { jti: string; until: number }
/** Профиль: никнейм и адрес аватара — и больше никаких данных (§4). */
export type ProfileView = {
  id: string
  authId: string
  nickname: string
  avatarUrl: string | null
  createdAt: number
  updatedAt: number
}
