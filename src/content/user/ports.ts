/**
 * Порты ядра — что приложение обязано дать. Ни один порт не знает про
 * фреймворк; связка с хвостами проекта — `gateway.svelte.ts` (скелет, TODO
 * на месте каждой связки).
 *
 * Где что живёт:
 *  - записи продления, баны, nonce, отметка активности — `#lib/cache`
 *    (`Store`, область 'auth'); активность — НЕ колонка auth, чтобы не
 *    двигать её `updated_at` и не вести личный журнал (§4): TTL-ключ в кэше;
 *  - строки auth/профиль — ресурсы `schema.ts` через `lib/db`;
 *  - ключи подписи сервера и сроки — `src/env.ts` (ротация по схеме
 *    курсорных `DB_CURSOR_KID`/`…_OLD_KEYS`).
 */
import type { AccessTokenClaims, Blocked, ProfileView, RenewalClaims, SessionRecord } from './types.js'

/** Одноразовый nonce на подпись (TTL минуты, тратится один раз). */
export interface ChallengePort {
  issue(nonce: string, ttlSeconds: number): Promise<void>
  /** `true` — nonce был и потрачен; повторно тот же nonce не проходит. */
  consume(nonce: string): Promise<boolean>
}

/**
 * Записи токенов продления — единственное хранимое состояние сессий.
 * Блокировка (одноразовость, выход) держит запись до конца срока: повторное
 * предъявление погашенного токена — сигнал кражи, сессия гасится целиком.
 */
export interface RenewalStorePort {
  create(record: SessionRecord): Promise<void>
  /** Погашенная/отозванная запись — `undefined` (бан неотличим от отсутствия). */
  get(jti: string): Promise<SessionRecord | undefined>
  /** Погасить с сохранением до конца срока (одноразовость, выход). */
  block(jti: string, ttlSeconds: number): Promise<void>
  revokeAllByIdentity(sub: string): Promise<void>
}

/**
 * Таблица auth. «Двойной select» точки продления: строка auth спрашивается
 * ВМЕСТЕ с баном предъявленного jti (хранилище продлений) — два чтения в
 * один момент, отказ = кик. Реализация — на совести адаптера.
 */
export interface AuthStorePort {
  findBySeed(seed: string): Promise<{ id: string; tokenVersion: number; deleted: boolean } | undefined>
  create(seed: string): Promise<{ id: string; tokenVersion: number }>
  /** Живая строка для фаервола: версия, метка удаления, объект блокировки. */
  get(id: string): Promise<{ id: string; tokenVersion: number; deletedAt: number | null; blocked: Blocked | null } | undefined>
  bumpTokenVersion(id: string): Promise<number>
  /** Заявка на удаление: мягкая метка, вход закрыт, сессии гасятся. */
  markDeleted(id: string, at: number): Promise<void>
  /** Исполнитель через n дней: seed и security стираются, строка-надгробие остаётся. */
  wipeCredentials(id: string): Promise<void>
}

/** Профиль (никнейм, адрес аватара) — таблица `demo_profile`, владелец по auth_id. */
export interface ProfileStorePort {
  create(authId: string): Promise<void>
  get(authId: string): Promise<ProfileView | undefined>
  update(authId: string, patch: { nickname?: string; avatarUrl?: string | null }): Promise<void>
  /** Исполнитель удаления (через n дней после заявки). */
  remove(authId: string): Promise<void>
}

/**
 * Ключи подписи сервера (гайд, способ 3): текущий пишет, отставшие принимают
 * до конца их срока — та же схема, что у курсорных ключей `lib/db`.
 */
export interface KeysPort {
  current(): { kid: string; secret: string }
  secretOf(kid: string): string | undefined
  /** Вызывается после успешной ротации: старый ключ уходит в приём, не в запись. */
  retire(kid: string): Promise<void>
}

/** Подпись и разбор токенов (HS256 через WebCrypto или JWS — выбор реализации). */
export interface TokenPort {
  sign(claims: AccessTokenClaims | RenewalClaims, secret: string): Promise<string>
  verify(token: string, secret: string): Promise<AccessTokenClaims | RenewalClaims | 'bad-signature' | 'expired'>
}

/**
 * Подпись и проверка seed-модели. Реализация по умолчанию — `keys.ts`
 * (`@noble/ed25519`, изоморфно); подмена — в тестах.
 */
export interface CryptoPort {
  sign(payload: string, secret: string): Promise<string>
  verify(payload: string, signature: string, seed: string): Promise<boolean>
}

/**
 * Куки — единственный разрешённый носитель токенов (гайд: HttpOnly, Secure;
 * в localStorage не пишем). Access и продление — раздельные куки; имена —
 * константы `auth.ts`. Адаптер подставляет куки и REST-ответа, и POST-экшена.
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

/** Всё, что нужно ядру. Собирает адаптер. */
export interface AuthPorts {
  challenge: ChallengePort
  renewals: RenewalStorePort
  auths: AuthStorePort
  profiles: ProfileStorePort
  keys: KeysPort
  tokens: TokenPort
  crypto: CryptoPort
  cookies: CookiePort
  clock: ClockPort
}
