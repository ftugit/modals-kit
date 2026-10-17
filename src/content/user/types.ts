/**
 * Типы модуля пользователя. Ядро (`auth.ts`) не знает ни Request/Response,
 * ни SvelteKit: голые данные на входе, голый факт на выходе — перевод в HTTP
 * делает gateway, в ошибки формы — инструкции (`error.ts`).
 */

/**
 * Содержимое временного токена — запечатанная строка (iron-webcrypto), которую
 * юзер носит сам. Короткая; сервер НИЧЕГО о ней не хранит.
 */
export type AccessTokenPayload = {
  /** Чей токен — id строки auth. */
  sub: string
  /** Девайс-токен (jti строки сессии) — по нему guard узнаёт сессию. */
  dt: string
  /** Витрина профиля из последнего продления/сохранения. */
  prof: { nickname: string | null; avatarUrl: string | null }
  iat: number
  exp: number
}

/** Сведения о подсети в истории сессии (полный IP и маска не хранятся). */
export type SubnetEntry = { hash: string; country: string | null; at: number }

/**
 * Строка сессии = устройство. Единственное хранимое состояние входов;
 * «заблокировать устройство» = софт-удаление (deletedAt), отдельных банов нет.
 */
export type SessionRecord = {
  jti: string
  authId: string
  deviceName: string | null
  /** Хэш текущей подсети (с солью аккаунта) — полный IP не храним. */
  subnetHash: string | null
  country: string | null
  /** Прежние подсети/страны — складируются в режиме 'update' конфига. */
  history: SubnetEntry[]
  createdAt: number
  expiresAt: number
  /** Софт-удаление = отзыв сессии. */
  deletedAt: number | null
  lastSeenAt: number | null
}

/** Объект блокировки аккаунта (поле `blocked` таблицы auth). */
export type Blocked = {
  reason: string
  at: number
  /** До какого времени; нет — бессрочно. */
  until?: number
}

/** Доверенный principal — из содержимого временного токена без похода в БД. */
export type Principal = { id: string }

/** Ответы API — данные без ошибок; ошибки (код+путь) — `error.ts`. */
export type Challenge = { nonce: string; expiresAt: number }

/** Профиль: никнейм и адрес аватара, если юзер их внёс; иначе — аноним. */
export type ProfileView = {
  id: string
  authId: string
  nickname: string | null
  avatarUrl: string | null
  createdAt: number
  updatedAt: number
}

/** Статус сессии глазами фаервола (один PK-lookup; эмуляция session-status). */
export type SessionStatus = 'ok' | 'revoked' | 'expired' | 'unknown'
