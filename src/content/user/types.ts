/**
 * Типы модуля пользователя. Ядро (`auth.ts`) не знает ни Request/Response,
 * ни SvelteKit: голые данные на входе, голый факт на выходе — перевод в HTTP
 * делает gateway, в ошибки формы — инструкции (`error.ts`).
 */

/**
 * Временный токен: короткий (15 минут), БЕЗ jti — не хранится и не банится
 * (запрещается у точки продления — `renew`, «фаервол приложения»). Подпись и
 * exp проверяются без обращения к хранилищу.
 */
export type AccessTokenClaims = {
  /** Чей токен — id строки auth. */
  sub: string
  /** Версия токенов identity: не совпала — все токены мертвы (гайд, способ 4). */
  ver: number
  /** Ключ подписи сервера: ротация (гайд, способ 3). */
  kid: string
  iat: number
  exp: number
}

/** Токен продления: одноразовый; запись хранится и при использовании блокируется. */
export type RenewalClaims = {
  /** Ключ записи в хранилище (и бана на остаток срока — для ловли повтора). */
  jti: string
  sub: string
  iat: number
  exp: number
}

/** Запись токена продления — единственное хранимое состояние сессии. */
export type SessionRecord = {
  jti: string
  sub: string
  createdAt: number
  expiresAt: number
}

/** Объект блокировки аккаунта (поле `blocked` таблицы auth). */
export type Blocked = {
  reason: string
  at: number
  /** До какого времени; нет — бессрочно. */
  until?: number
}

/** Доверенный principal — из клеймов access без похода в хранилище. */
export type Principal = { id: string }

/** Ответы API — данные без ошибок; ошибки (код+путь) — `error.ts`. */
export type Challenge = { nonce: string; expiresAt: number }
/** Профиль: никнейм и адрес аватара — и больше никаких данных (§4). */
export type ProfileView = {
  id: string
  authId: string
  nickname: string
  avatarUrl: string | null
  createdAt: number
  updatedAt: number
}
