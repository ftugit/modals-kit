/**
 * Конфиг модуля (файл настроек): реестр ключей со значениями по умолчанию +
 * `get`/`set`/`reset` поверх `#lib/cache`. Настройка ПЕРЕОПРЕДЕЛЯЕТ умолчание;
 * переопределения хранятся по области — «глобально», «пользователь»
 * (`user:<id>`) или «устройство» (`device:<jti>`); в БД переедут, когда
 * появятся ACL и роли. Файл изоморфный: хранилище подставляет вызвавший.
 */

/** Контракт хранилища «ключ → значение со сроком» (либ/cache). */
export type StoreLike = {
  get<T>(key: string): T | undefined | Promise<T | undefined>
  set<T>(key: string, value: T, ttlMs: number): void | Promise<void>
  delete(key: string): void | Promise<void>
  /** Область ключей (у lib/cache Store есть); в тестах можно опустить. */
  scope?(name: string): StoreLike
}

/** Значения по умолчанию — единственное место чисел и списков модуля. */
export const defaults: ConfigValues = {
  /** Срок временного токена (по умолчанию — час). */
  accessTtlSec: 3600,
  /** Срок девайс-токена (по умолчанию — год). */
  deviceTtlSec: 60 * 60 * 24 * 365,
  /**
   * Поведение при пересоздании сессии: 'update' — обновить сведения о
   * подсети, прежние сложить в историю; 'strict' — смена подсети запрещена,
   * сессия не пересоздаётся.
   */
  sessionRecreate: 'update' as 'update' | 'strict',
  /** Запрещённые никнеймы (служебные имена); остальное — любой, неуникальный. */
  nicknameForbidden: [
    'admin', 'administrator', 'mod', 'moderator', 'support', 'root', 'system',
  ],
  /** Срок жизни одноразового nonce для подписи, секунд. */
  challengeTtlSec: 120,
  /**
   * Заявка на удаление живёт столько дней, потом исполнитель стирает аккаунт.
   * Дефолт модуля — неделя (чек-лист §6: софт → окончательно через 7 дней);
   * приложение задаёт своё значение через `createUserConfig`.
   */
  deleteGraceDays: 7,
  /** Сколько держать HoldButton создания аккаунта, секунд (ход 261: было 5). */
  holdSeconds: 2,
  /** Аватар: меньшая сторона до этого размера, большая режется по центру до него. */
  avatarEdge: 200,
  /** Аватар: предел веса готового JPEG, байт. */
  avatarMaxBytes: 20_480,
  /** Аватар: разрешённые форматы base64-поля (белый список серверного валидатора). */
  avatarFormats: ['jpeg'] as readonly string[],
}

/**
 * Типы значений: числа — любые числа (умолчание — лишь пример),
 * перечисление — по набору, список — только строки.
 */
export type ConfigValues = {
  accessTtlSec: number
  deviceTtlSec: number
  sessionRecreate: 'update' | 'strict'
  nicknameForbidden: readonly string[]
  challengeTtlSec: number
  deleteGraceDays: number
  holdSeconds: number
  avatarEdge: number
  avatarMaxBytes: number
  avatarFormats: readonly string[]
}
export type ConfigKey = keyof ConfigValues
/** Область переопределения: 'global' | `user:<id>` | `device:<jti>`. */
export type ConfigScope = string

/** Настройки модуля: значения по умолчанию + переопределения в хранилище. */
export type UserConfig = {
  defaults: ConfigValues
  get<K extends ConfigKey>(key: K, scope?: ConfigScope): Promise<ConfigValues[K]>
  set<K extends ConfigKey>(key: K, value: ConfigValues[K], scope?: ConfigScope): Promise<void>
  reset<K extends ConfigKey>(key: K, scope?: ConfigScope): Promise<void>
}

const AREA_PREFIX = 'user-config'

function validate(key: ConfigKey, value: unknown): void {
  if (!(key in defaults)) throw new Error(`config: неизвестный ключ «${String(key)}»`)
  const sample = defaults[key]
  if (key === 'nicknameForbidden') {
    if (!Array.isArray(value) || !value.every((v) => typeof v === 'string'))
      throw new Error('config.nicknameForbidden: список строк')
    return
  }
  if (key === 'sessionRecreate') {
    if (value !== 'update' && value !== 'strict')
      throw new Error('config.sessionRecreate: «update» или «strict»')
    return
  }
  if (key === 'avatarFormats') {
    if (
      !Array.isArray(value) ||
      value.length === 0 ||
      !value.every((v) => typeof v === 'string' && v !== '')
    )
      throw new Error('config.avatarFormats: непустой список форматов («jpeg», «png», «webp»)')
    return
  }
  if (typeof sample === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
      throw new Error(`config.${key}: положительное число`)
  }
}

function scopeKey(scope: ConfigScope, key: ConfigKey): string {
  return `${scope || 'global'}:${key}`
}

/** Собрать настройки поверх хранилища (сервер — lib/cache, тесты — память). */
export function createUserConfig(store: StoreLike): UserConfig {
  const area: StoreLike = store.scope?.(AREA_PREFIX) ?? store
  const get = async <K extends ConfigKey>(key: K, scope?: ConfigScope) => {
    const override = await area.get<unknown>(scopeKey(scope ?? 'global', key))
    return (override === undefined ? defaults[key] : override) as (typeof defaults)[K]
  }
  return {
    defaults,
    get,
    async set(key, value, scope) {
      validate(key, value)
      await area.set(scopeKey(scope ?? 'global', key), value, Infinity)
    },
    async reset(key, scope) {
      await area.delete(scopeKey(scope ?? 'global', key))
    },
  }
}
