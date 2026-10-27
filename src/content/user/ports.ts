/**
 * Порты ядра — что приложение обязано дать. Ни один порт не знает про
 * фреймворк; связка — `gateway.ts` (адаптеры на ресурсы `lib/db`).
 *
 * Где что живёт:
 *  - сессии, auth, профиль — ресурсы `schema.ts` через `db.resource` (ход 257);
 *  - настройки модуля — `#lib/cache` (`localStore`); challenge входа —
 *    stateless запечатанный токен (`seal`), серверного хранилища у него нет;
 *  - ключ запечатывания токенов (access/renewal/challenge) — `src/env.ts`
 *    (`defineEnvVars`), ротация по схеме курсорных `DB_CURSOR_KID`/`…_OLD_KEYS`.
 */
import type { DataContext, Filter, Order } from '#lib/db/index.js'
import type { Blocked, SessionRecord } from './types.js'

/**
 * Строка аккаунта для списка seed-юзеров — то, что адаптер получил из DB под
 * контекстом вызывающего. Отдельный тип, а не `AuthRow`: списку нужны времена
 * создания, а фаерволу (`AuthRow`) — соль подсети, которой в списке нет.
 */
export type SeedAccountRow = {
  id: string
  seed: string | null
  permissions: string[]
  blocked: Blocked[]
  createdAt: number
  deletedAt: number | null
  /** Никнейм профиля, если адаптер его подтягивал (`withNickname`); `undefined` — не запрашивали. */
  nickname?: string | null
}
import type { UserConfig } from './config.js'

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
  /**
   * Записать список прав аккаунта (перезапись целиком). Контекст обязателен:
   * пишет только администратор, и модель проверяет это ещё раз маской поля.
   */
  setPermissions(ctx: DataContext, id: string, permissions: readonly string[]): Promise<void>
  /**
   * Порция списка аккаунтов для экрана seed-юзеров: строки под контекстом
   * вызывающего (`account.read`/`admin` — решает политика модели, включая
   * удалённые строки) и полное число строк на том же срезе.
   */
  listPage(
    ctx: DataContext,
    args: {
      page: number
      pageSize: number
      /** Серверный фильтр слоя БД (поиск/диапазоны дат собрал домен); счётчик — на том же срезе. */
      filter?: Filter
      /** Порядок слоя БД; без него — порядок модели (`created_at desc`). */
      order?: Order
      /** Видеть удалённые строки (по умолчанию слоя — нет; решает домен по состоянию фильтра). */
      includeDeleted?: boolean
      /**
       * Подстрока seed (без учёта регистра). Не DB-фильтр: слой валидирует
       * значения фильтров схемой поля (у seed — 43–44 знака). Адаптер
       * применяет подстроку к выбранному срезу до нарезки порции.
       */
      searchSeed?: string
      /**
       * Подтянуть профиль каждой строки (include по связи модели) и дать
       * никнейм в строке; поиск `searchSeed` тогда совпадает и по никнейму.
       * Решает домен: только при правах на профили и включённом параметре.
       */
      withNickname?: boolean
    },
  ): Promise<{ rows: SeedAccountRow[]; total: number }>
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
/**
 * Профиль — таблица прав ЧЕЛОВЕКА, а не сервера: кто читает и правит, решают
 * `policy` и владение строкой (`ownerOrRoles('auth_id', …)`). Поэтому каждая
 * операция принимает контекст вызывающего: обычные чтение/правка идут от
 * владельца (его `id` и выданные права), создание строки — только от сервера
 * (`policy.insert: roles(['server'])`), удаление при смерти аккаунта — тоже
 * от сервера, вместе с цепочкой.
 */
export interface ProfileStorePort {
  create(ctx: DataContext, authId: string, patch: { nickname?: string; avatarUrl?: string }): Promise<void>
  get(ctx: DataContext, authId: string): Promise<import('./types.js').ProfileView | undefined>
  update(ctx: DataContext, authId: string, patch: { nickname?: string; avatarUrl?: string | null }): Promise<void>
  /** Исполнитель удаления (конечная смерть аккаунта уносит профиль цепочкой). */
  remove(ctx: DataContext, authId: string): Promise<void>
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

/** Запечатывание токенов (iron-webcrypto в адаптере): access, продление, challenge. */
export interface SealPort {
  seal(
    payload:
      | import('./types.js').AccessTokenPayload
      | import('./types.js').RenewalPayload
      | import('./types.js').ChallengePayload,
    ttlSeconds: number,
  ): Promise<string>
  unseal(
    token: string,
  ): Promise<
    | import('./types.js').AccessTokenPayload
    | import('./types.js').RenewalPayload
    | import('./types.js').ChallengePayload
    | undefined
  >
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
