/**
 * Порты каркаса авторизации — что приложение обязано дать ядру. Ни один порт
 * не знает про фреймворк; связка с существующими хвостами проекта — в
 * `sveltekit.ts` (каркас, TODO на месте каждой связки).
 *
 * Где что живёт (план: docs/design/auth-seed.md §5):
 *  - challenge/сессии/чёрный список — `#lib/cache` (`Store`, область 'auth'),
 *    для форм, пишущих в базу, — Postgres-хранилище из README `lib/cache` §6;
 *  - identity — ресурс `lib/db` (`defineResource` + ключи доступа, README §7);
 *  - ключи подписи и срок жизни — `src/env.ts` (`defineEnvVars`), ротация по
 *    схеме курсорных ключей (`DB_CURSOR_KID`/`DB_CURSOR_OLD_KEYS`);
 *  - подпись nonce — WebCrypto в браузере пользователя, проверка — на сервере.
 */
import type { AccessTokenClaims, SessionRecord } from './types.js'

/** Одноразовый challenge на вход (TTL минуты, тратится один раз). */
export interface ChallengePort {
  issue(nonce: string, ttlSeconds: number): Promise<void>
  /** `true` — nonce был и потрачен; повторно тот же nonce не проходит. */
  consume(nonce: string): Promise<boolean>
}

/** Живые сессии (брони). Отзыв = удалить запись. */
export interface SessionStorePort {
  create(record: SessionRecord): Promise<void>
  get(jti: string): Promise<SessionRecord | undefined>
  revoke(jti: string): Promise<void>
  listByIdentity(sub: string): Promise<SessionRecord[]>
  revokeAllByIdentity(sub: string): Promise<void>
}

/** Чёрный список `jti` (статья, способ 1). Запись с TTL = остаток жизни токена. */
export interface BlacklistPort {
  add(jti: string, ttlSeconds: number): Promise<void>
  has(jti: string): Promise<boolean>
}

/** Identity: строка (pubkey, createdAt, tokenVersion) — больше ничего (§4). */
export interface IdentityStorePort {
  findByPubkey(pubkey: string): Promise<{ id: string; tokenVersion: number } | undefined>
  create(pubkey: string): Promise<{ id: string; tokenVersion: number }>
  remove(id: string): Promise<void>
  tokenVersion(id: string): Promise<number | undefined>
  bumpTokenVersion(id: string): Promise<number>
}

/**
 * Ключи подписи (статья, способ 3): текущий пишет, отставшие принимают до
 * конца их срока — та же схема, что у курсорных ключей `lib/db`.
 */
export interface KeysPort {
  current(): { kid: string; secret: string }
  secretOf(kid: string): string | undefined
  /** Вызывается после успешной ротации: старый ключ уходит в приём, не в запись. */
  retire(kid: string): Promise<void>
}

/** Подпись и разбор токена (HS256 через WebCrypto или JWS-библиотека — выбор реализации). */
export interface TokenPort {
  sign(claims: AccessTokenClaims, secret: string): Promise<string>
  verify(token: string, secret: string): Promise<AccessTokenClaims | 'bad-signature' | 'expired'>
}

/** Проверка подписи challenge публичным ключом пользователя. */
export interface CryptoPort {
  verifySignature(args: { message: string; signature: string; pubkey: string }): Promise<boolean>
}

/**
 * Куки — единственный разрешённый носитель токена (практики статьи: HttpOnly,
 * Secure; в localStorage токен не пишем). Каркас не знает Response: адаптер
 * подставляет куки и REST-ответа, и POST-экшена.
 */
export interface CookiePort {
  get(name: string): string | undefined
  set(name: string, value: string, ttlSeconds: number): void
  delete(name: string): void
}

/** Время — только через порт (никаких новых часов клиента в проекте). */
export interface ClockPort {
  now(): number
}

/**
 * Мониторинг аномалий (практики статьи): «токен ходит из многих мест».
 * Хеш подсети, счётчик в памяти с TTL минут; сам IP не хранится (§4).
 */
export interface NetworkPort {
  subnetHash(): string | undefined
  count(otherSubnetHash: string): number
}

/** Настройки — только из доверенного окружения (прецедент `src/env.ts`). */
export interface ConfigPort {
  get(name: string): string | undefined
}

/** Всё, что нужно ядру. Собирает адаптер. */
export interface AuthPorts {
  challenge: ChallengePort
  sessions: SessionStorePort
  blacklist: BlacklistPort
  identities: IdentityStorePort
  keys: KeysPort
  tokens: TokenPort
  crypto: CryptoPort
  cookies: CookiePort
  clock: ClockPort
  network: NetworkPort
  config: ConfigPort
}
