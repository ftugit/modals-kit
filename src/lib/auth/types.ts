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
  /** Идентификатор identity (строка identity = псевдоним, приватность §4 плана). */
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

/** Коды результата. Русские тексты выбирает владелец — каркас несёт только коды. */
export type AuthCode =
  | 'auth.nonce-unknown'      // challenge истёк или уже потрачен
  | 'auth.signature'          // подпись nonce не сошлась
  | 'auth.identity-unknown'   // identity удалён
  | 'auth.token'              // токен не читается / подпись токена чужая
  | 'auth.kid-unknown'        // токен подписан неизвестным ключом (после ротации)
  | 'auth.expired'            // access истёк (статья: короткий exp)
  | 'auth.revoked'            // jti в чёрном списке (статья: blacklisting)
  | 'auth.session-unknown'    // брони сессии нет (выход, отзыв)
  | 'auth.version'            // tokenVersion не совпал (статья: versioning)
  | 'auth.anomaly'            // счётчик подсетей превысил порог (практики: мониторинг)
  | 'auth.unauthenticated'    // cookie нет — просто гость

/** Голый результат: ок с данными или код без данных. */
export type AuthResult<T> = { ok: true; value: T } | { ok: false; code: AuthCode }

/** Ответы API. */
export type Challenge = { nonce: string; expiresAt: number }
export type SessionView = { jti: string; createdAt: number; expiresAt: number; subnet: string | undefined }
export type KeyView = { kid: string; retired: readonly string[] }
export type RevocationEntry = { jti: string; until: number }
