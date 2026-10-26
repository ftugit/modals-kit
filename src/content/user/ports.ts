/**
 * Порты ядра — что приложение обязано дать. Ни один порт не знает про
 * фреймворк; связка — `gateway.ts` (адаптеры на ресурсы `lib/db`).
 *
 * Где что живёт:
 *  - сессии, auth, профиль — ресурсы `schema.ts` через `db.resource` (ход 257);
 *  - nonce и настройки модуля — `#lib/cache` (`localStore`);
 *  - ключ запечатывания временного токена и nonce-секрет — `src/env.ts`
 *    (`defineEnvVars`), ротация по схеме курсорных `DB_CURSOR_KID`/`…_OLD_KEYS`.
 */
import type { SessionRecord } from './types.js'
import type { UserConfig } from './config.js'

/** Одноразовый nonce на подпись (TTL минуты, тратится один раз). */
export interface ChallengePort {
  issue(nonce: string, ttlSeconds: number): Promise<void>
  /** `true` — nonce был и потрачен; повторно тот же nonce не проходит. */
  consume(nonce: string): Promise<boolean>
}

/**
 * Сессии = устройства. Строка создаётся на входе, пересоздаётся при
 * продлении (старая софт-удаляется — повтор погашенного виден как 'revoked'),
 * гасится софт-удалением.
 */
export interface SessionStorePort {
  create(record: SessionRecord): Promise<void>
  /** Софт-удалённая строка ЧИТАЕТСЯ (guard отличит 'revoked'); нет — undefined. */
  get(jti: string): Promise<SessionRecord | undefined>
  listByAuth(authId: string): Promise<SessionRecord[]>
  /** Записать строку целиком: ротация продления (версия, срок, подсеть, активность). */
  save(record: SessionRecord): Promise<void>
  /** Отзыв = софт-удаление (deletedAt), не физическое удаление. */
  softDelete(jti: string, at: number): Promise<void>
  softDeleteAllByAuth(authId: string, at: number): Promise<void>
}

/** Таблица auth — носитель безопасности аккаунта. Личного — ничего. */
export interface AuthStorePort {
  /**
   * Живая строка по seed — обычный поиск политики: аккаунт с заявкой на
   * удаление НЕ виден (софт-удаление модели). Видеть удалённую строку —
   * только `findDeletedBySeed`, и только после доказательства владения.
   */
  findBySeed(seed: string): Promise<AuthRow | undefined>
  /** Удалённая строка по seed (привилегированный поиск восстановления). */
  findDeletedBySeed(seed: string): Promise<AuthRow | undefined>
  /** Создать аккаунт; `null` — seed занят (в т.ч. удалённой строкой: unique). */
  create(seed: string): Promise<AuthRow | null>
  get(id: string): Promise<AuthRow | undefined>
  /** Заявка на удаление: софт-метка; вход теперь получает `auth.deleted`. */
  markDeleted(id: string, at: number): Promise<void>
  /** Снять заявку (восстановление после доказательства владения). */
  clearDeleted(id: string): Promise<void>
  /** Исполнитель через срок: seed и security стираются — надгробие остаётся. */
  wipeCredentials(id: string): Promise<void>
  /** Заявки, у которых грейс вышел: — корма исполнителя удаления. */
  listDeletedBefore(cutoffMs: number): Promise<AuthRow[]>
}

/** Строка auth глазами адаптера. */
export type AuthRow = {
  id: string
  seed: string | null
  deletedAt: number | null
  /** Сферы блокировки; `auth` — вход закрыт, остальные — ограничения. */
  blocked: import('./types.js').Blocked[]
  /** Выданные права (`permissions.ts`): строки каталога, пусто — обычный юзер. */
  permissions: string[]
  /** Соль для хэшей подсетей сессий (на аккаунт). */
  subnetSalt: string
}

/** Профиль: создаётся при первом заполнении личных данных; нет — аноним. */
export interface ProfileStorePort {
  create(authId: string, patch: { nickname?: string; avatarUrl?: string }): Promise<void>
  get(authId: string): Promise<import('./types.js').ProfileView | undefined>
  update(authId: string, patch: { nickname?: string; avatarUrl?: string | null }): Promise<void>
  /** Исполнитель удаления (конечная смерть аккаунта уносит профиль цепочкой). */
  remove(authId: string): Promise<void>
}

/**
 * Ключ запечатывания временного токена (секрет — env, ротация как у курсорных):
 * id ключа печётся в строку, старые ключи читают до конца их срока.
 */
export interface SealKeysPort {
  current(): { id: string; secret: string }
  secretOf(id: string): string | undefined
  retire(id: string): Promise<void>
}

/** Запечатывание токенов (iron-webcrypto в адаптере): access и продление. */
export interface SealPort {
  seal(
    payload: import('./types.js').AccessTokenPayload | import('./types.js').RenewalPayload,
    ttlSeconds: number,
  ): Promise<string>
  unseal(
    token: string,
  ): Promise<import('./types.js').AccessTokenPayload | import('./types.js').RenewalPayload | undefined>
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
 * Куки — носитель у браузера: ОБА токена хранятся в куках (ставит только
 * сервер по явному POST); временный дополнительно вытягивается в память
 * (RAM-копия на вкладку, все вкладки с одним токеном до ближайшего
 * продления). Адаптер подставляет куки и REST-ответа, и POST-экшена.
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

/** Настройки модуля — файл конфиг (`config.ts`) поверх lib/cache. */
export type ConfigPort = UserConfig

/** Всё, что нужно ядру. Собирает адаптер. */
export interface AuthPorts {
  challenge: ChallengePort
  sessions: SessionStorePort
  auths: AuthStorePort
  profiles: ProfileStorePort
  sealKeys: SealKeysPort
  seal: SealPort
  crypto: CryptoPort
  cookies: CookiePort
  clock: ClockPort
  config: ConfigPort
}
