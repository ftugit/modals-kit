/**
 * Конфиг-API: работа с конфиг-моделью (`user.config`, этап 10 плана
 * seed-списка) от системы. Порт исполняет операции системным контекстом,
 * а права проверяет этот API — по схеме ключа из самой модели:
 *
 * - новый ключ умолчания создаёт только администратор (на уровне модели
 *   то же держит роль `insert`); существующее умолчание меняет тот, кто
 *   проходит `editDefault` его схемы;
 * - ключ за юзером создают проходящие `assign` схемы умолчания; меняют и
 *   снимают — по упрощённой схеме самой строки юзера, а без неё — по
 *   `editUser` / `deleteUser` схемы умолчания. Роль и право в `#lib/db`
 *   технически тождественны: любая валидная строка токена (`owner`,
 *   `admin`, `moderator`, `config.edit`, `a.b.c`) сверяется через
 *   `checkGrants`;
 * - значения, совпадающие с эффективным умолчанием, не хранятся:
 *   запись такого значения удаляет строку юзера, а без строки — молча
 *   ничего не сохраняет (успех без записи).
 *
 * Эффективное значение: строка юзера → строка умолчания → бутстрап кода
 * (`spec-config.ts`). Строки умолчаний API кэширует в области порта и
 * сбрасывает кэш каждой записью умолчания; строки юзеров не кэшируются.
 */
import { checkGrants, grants } from '#lib/db/index.js'
import { fail, guard, ok, principalOfRow, type UserResult } from './auth.js'
import type { AuthFact } from './error.js'
import { ADMIN_ROLE } from './permissions.js'
import type { AuthPorts } from './ports.js'
import { config as configResource } from './schema.js'
import {
  ALL_CONFIG_KEYS,
  CONFIG_KEYS,
  bootstrapOf,
  decodeConfigValue,
  fieldNameOf,
  isConfigKey,
} from './spec-config.js'
import type {
  ConfigKeyRow,
  ConfigKeySchema,
  UserConfigItem,
  UserConfigSlice,
} from './types.js'

const gConfig = grants(configResource)
const DEFAULTS_CACHE_KEY = 'defaults.v1'
const SCHEMA_RULES = ['editDefault', 'assign', 'editUser', 'deleteUser'] as const

/** Допустимый строковый идентификатор права/роли в схеме ключа (`owner`, `admin`, `moderator`, `a.b.c`). */
const GRANT_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/

type Actor = { id: string; perms: readonly string[] }

const toPrincipal = (a: Actor) => principalOfRow({ id: a.id, permissions: a.perms }).principal

/** Проходит ли актор по списку ролей/прав правила `ConfigKeySchema` (плюс `owner` целевой строки и `admin`). */
function ruleAllows(a: Actor, targetUserId: string | null, roles: readonly string[] | undefined): boolean {
  return checkGrants(
    toPrincipal(a),
    roles?.length ? [...roles, ADMIN_ROLE] : [ADMIN_ROLE],
    { ownerId: targetUserId },
  )
}

/**
 * Схема из присланного: известные правила и валидные строковые токены прав/ролей.
 * В `#lib/db` роль и право технически идентичны, поэтому `validSchema` не
 * ограничивает токены статическим каталогом `PERMISSIONS`.
 */
function validSchema(schema: unknown, simplified: boolean): schema is ConfigKeySchema {
  if (schema === null) return true
  if (typeof schema !== 'object' || Array.isArray(schema)) return false
  const allowed: readonly string[] = simplified ? ['editUser', 'deleteUser'] : SCHEMA_RULES
  for (const [rule, roles] of Object.entries(schema as Record<string, unknown>)) {
    if (!allowed.includes(rule)) return false
    if (!Array.isArray(roles) || roles.length > 16) return false
    for (const r of roles) {
      if (typeof r !== 'string' || !GRANT_TOKEN_RE.test(r)) return false
    }
  }
  return true
}

/** Глубокое равенство значений конфига (значения — JSON). */
const sameValue = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** Строки умолчаний из кэша порта; заполняет первая читающая операция. */
async function defaultsOf(ports: AuthPorts): Promise<ConfigKeyRow[]> {
  const cached = await ports.settings.cache.get<ConfigKeyRow[]>(DEFAULTS_CACHE_KEY)
  if (cached) return cached
  const rows = await ports.settings.defaults()
  await ports.settings.cache.set(DEFAULTS_CACHE_KEY, rows, Infinity)
  return rows
}

const invalidateDefaults = async (ports: AuthPorts): Promise<void> => {
  await ports.settings.cache.delete(DEFAULTS_CACHE_KEY)
}

const defaultRowOf = async (ports: AuthPorts, key: string): Promise<ConfigKeyRow | undefined> =>
  (await defaultsOf(ports)).find((r) => r.key === key)

function defaultValueFromRow(row: ConfigKeyRow | undefined, key: string): unknown {
  return row && row.value !== null && row.value !== undefined ? row.value : bootstrapOf(key)
}

/** Значение умолчания ключа: строка умолчания, а без значения в ней — бутстрап кода. */
async function defaultValueOf(ports: AuthPorts, key: string): Promise<unknown> {
  return defaultValueFromRow(await defaultRowOf(ports, key), key)
}

/** Пакетное чтение всех строк одного пользователя (1 SQL-запрос через `rowsByUser` либо fallback по ключам каталога). */
async function userRowsOf(ports: AuthPorts, userId: string): Promise<Map<string, ConfigKeyRow>> {
  if (ports.settings.rowsByUser) {
    const rows = await ports.settings.rowsByUser(userId)
    return new Map(rows.map((r) => [r.key, r]))
  }
  const pairs = await Promise.all(
    ALL_CONFIG_KEYS.map(async (k) => [k, await ports.settings.row(userId, k)] as const),
  )
  const map = new Map<string, ConfigKeyRow>()
  for (const [k, row] of pairs) {
    if (row) map.set(k, row)
  }
  return map
}

/**
 * Доступность целевого аккаунта для операций с конфигом:
 * несуществующий ИЛИ софт-удалённый чужой аккаунт без прав чтения удалённых (`admin` или `account.read` + `account.readDeleted`)
 * неотличимо отдаёт `auth.identity-unknown`.
 */
async function checkTargetReachable(
  ports: AuthPorts,
  a: Actor,
  targetUserId: string,
): Promise<AuthFact | null> {
  const target = await ports.auths.get(targetUserId)
  if (!target) return { code: 'auth.identity-unknown' }
  if (target.deletedAt !== null && a.id !== targetUserId) {
    const canSeeDeleted =
      a.perms.includes(ADMIN_ROLE) ||
      (a.perms.includes('account.read') && a.perms.includes('account.readDeleted'))
    if (!canSeeDeleted) return { code: 'auth.identity-unknown' }
  }
  return null
}

/**
 * Эффективное значение ключа для юзера (`userId = null` — само умолчание).
 * Внутреннее чтение потребителей кода (приватность, сессии): актор не
 * нужен, права здесь не проверяются — это не показ человеку.
 */
export async function getEffective(ports: AuthPorts, userId: string | null, key: string): Promise<unknown> {
  if (userId) {
    const own = await ports.settings.row(userId, key)
    if (own) return own.value
  }
  return defaultValueOf(ports, key)
}

/** Вошедший актор или доменный факт guard — общий вход операций с правами. */
async function actorOf(ports: AuthPorts, accessToken: string | undefined): Promise<Actor | AuthFact> {
  const g = await guard(ports, accessToken)
  if ('code' in g) return g
  return { id: g.sub, perms: g.perms }
}

/**
 * Вправе ли актор открыть экран настроек цели (`UserConfig`):
 * `true`, если актор проходит `CONFIG_ACL.read` (`owner`, `config.read`, `admin`)
 * ИЛИ если хотя бы один ключ каталога открыт ему на редактирование схемой ключа.
 */
export async function canOpenUserConfig(
  ports: AuthPorts,
  a: Actor,
  targetUserId: string,
): Promise<boolean> {
  if (await checkTargetReachable(ports, a, targetUserId)) return false
  if (checkGrants(toPrincipal(a), gConfig.select, { ownerId: targetUserId })) return true
  const [defaults, ownMap] = await Promise.all([defaultsOf(ports), userRowsOf(ports, targetUserId)])
  const defMap = new Map(defaults.map((r) => [r.key, r]))
  for (const key of ALL_CONFIG_KEYS) {
    const def = defMap.get(key)
    const own = ownMap.get(key)
    const roles = own ? (own.schema?.editUser ?? def?.schema?.editUser) : def?.schema?.assign
    if (ruleAllows(a, targetUserId, roles)) return true
  }
  return false
}

/**
 * Пакетное чтение среза `UserConfig` для целевого пользователя (`subject` пуст — свой конфиг).
 * Незнакомые ключи БД вне `CONFIG_KEYS` игнорируются; доступные только для чтения ключи
 * приходят с `editable: false` и показываются как `read-only` строки.
 */
export async function listUserConfig(
  ports: AuthPorts,
  accessToken: string | undefined,
  subject?: string | null,
): Promise<UserResult<UserConfigSlice>> {
  const a = await actorOf(ports, accessToken)
  if ('code' in a) return fail(a)
  const targetId = subject?.trim() || a.id
  const unreachable = await checkTargetReachable(ports, a, targetId)
  if (unreachable) return fail(unreachable)

  const [defaults, ownMap] = await Promise.all([defaultsOf(ports), userRowsOf(ports, targetId)])
  const defMap = new Map(defaults.map((r) => [r.key, r]))
  const canReadAll = checkGrants(toPrincipal(a), gConfig.select, { ownerId: targetId })

  const items: UserConfigItem[] = []
  for (const key of ALL_CONFIG_KEYS) {
    const info = CONFIG_KEYS[key]
    const def = defMap.get(key)
    const own = ownMap.get(key)
    const defaultValue = defaultValueFromRow(def, key)
    const value = own !== undefined ? own.value : defaultValue
    const editable = ruleAllows(
      a,
      targetId,
      own ? (own.schema?.editUser ?? def?.schema?.editUser) : def?.schema?.assign,
    )
    const deletable =
      own !== undefined && ruleAllows(a, targetId, own.schema?.deleteUser ?? def?.schema?.deleteUser)

    if (!canReadAll && !editable) continue

    items.push({
      key,
      fieldName: info.fieldName,
      group: info.group,
      kind: info.kind,
      title: info.title,
      description: info.description,
      value,
      defaultValue,
      overridden: own !== undefined,
      editable,
      deletable,
    })
  }

  if (items.length === 0 && !canReadAll) {
    return fail({ code: 'auth.forbidden' })
  }

  return ok({
    uid: targetId,
    isOwn: a.id === targetId,
    canSave: items.some((i) => i.editable),
    items,
  })
}

export interface SaveUserConfigArgs {
  targetId?: string | null
  /** Карта `ConfigKey -> новое значение` для сохранения редактируемых полей. */
  patch?: Readonly<Record<string, unknown>>
  /** Сброс одного ключа к эффективному умолчанию (`intent = reset:<key>`). */
  resetKey?: string | null
}

/**
 * Атомарно проверить и сохранить изменения настроек пользователя либо сбросить
 * один переопределённый ключ к умолчанию; возвращает свежий `UserConfigSlice`.
 */
export async function saveUserConfig(
  ports: AuthPorts,
  accessToken: string | undefined,
  args: SaveUserConfigArgs,
): Promise<UserResult<UserConfigSlice>> {
  const a = await actorOf(ports, accessToken)
  if ('code' in a) return fail(a)
  const targetId = args.targetId?.trim() || a.id
  const unreachable = await checkTargetReachable(ports, a, targetId)
  if (unreachable) return fail(unreachable)

  const [defaults, ownMap] = await Promise.all([defaultsOf(ports), userRowsOf(ports, targetId)])
  const defMap = new Map(defaults.map((r) => [r.key, r]))

  if (args.resetKey) {
    const key = args.resetKey.trim()
    if (!isConfigKey(key)) return fail({ code: 'config.key-unknown' })
    const own = ownMap.get(key)
    if (!own) return listUserConfig(ports, accessToken, targetId)
    const def = defMap.get(key)
    if (!ruleAllows(a, targetId, own.schema?.deleteUser ?? def?.schema?.deleteUser)) {
      return fail({ code: 'config.rule-forbidden', path: fieldNameOf(key) })
    }
    await ports.settings.remove(own.id)
    return listUserConfig(ports, accessToken, targetId)
  }

  const entries = Object.entries(args.patch ?? {})
  if (entries.length === 0) {
    // Нет ни одного поля в патче — проверяем, есть ли вообще право правки хотя бы одного ключа.
    const anyEditable = ALL_CONFIG_KEYS.some((key) => {
      const def = defMap.get(key)
      const own = ownMap.get(key)
      return ruleAllows(a, targetId, own ? (own.schema?.editUser ?? def?.schema?.editUser) : def?.schema?.assign)
    })
    if (!anyEditable) return fail({ code: 'auth.forbidden' })
    return listUserConfig(ports, accessToken, targetId)
  }

  const planned: Array<{
    key: typeof ALL_CONFIG_KEYS[number]
    own: ConfigKeyRow | undefined
    defaultValue: unknown
    nextValue: unknown
  }> = []

  // Предварительная проверка ВСЕХ присланных ключей до записи в БД.
  for (const [rawKey, rawVal] of entries) {
    if (!isConfigKey(rawKey)) {
      return fail({ code: 'config.key-unknown' })
    }
    const decoded = decodeConfigValue(rawKey, rawVal)
    if (!decoded.ok) {
      return fail({ code: decoded.code, path: fieldNameOf(rawKey) })
    }
    const def = defMap.get(rawKey)
    const own = ownMap.get(rawKey)
    const defaultValue = defaultValueFromRow(def, rawKey)
    const currentEffective = own ? own.value : defaultValue
    const roles = own ? (own.schema?.editUser ?? def?.schema?.editUser) : def?.schema?.assign
    if (!ruleAllows(a, targetId, roles)) {
      if (sameValue(decoded.value, currentEffective)) continue
      return fail({ code: 'config.rule-forbidden', path: fieldNameOf(rawKey) })
    }
    planned.push({
      key: rawKey,
      own,
      defaultValue,
      nextValue: decoded.value,
    })
  }

  for (const op of planned) {
    if (sameValue(op.nextValue, op.defaultValue)) {
      if (op.own) await ports.settings.remove(op.own.id)
    } else if (op.own) {
      if (!sameValue(op.nextValue, op.own.value)) {
        await ports.settings.update(op.own.id, { value: op.nextValue })
      }
    } else {
      await ports.settings.insert({ authId: targetId, key: op.key, value: op.nextValue, schema: null })
    }
  }

  return listUserConfig(ports, accessToken, targetId)
}

/**
 * Прочитать ключ глазами человека: эффективное значение и факт закрепления.
 * Владелец читает своё (пример — `session.ipLock`: закреплено админом,
 * меняется не владельцем), админ и `config.read` — чужое.
 */
export async function getUserKey(
  ports: AuthPorts,
  accessToken: string | undefined,
  userId: string,
  key: string,
): Promise<UserResult<{ key: string; value: unknown; assigned: boolean }>> {
  const a = await actorOf(ports, accessToken)
  if ('code' in a) return fail(a)
  if (!checkGrants(toPrincipal(a), gConfig.select, { ownerId: userId })) {
    return fail({ code: 'auth.forbidden' })
  }
  if (a.id !== userId) {
    const unreachable = await checkTargetReachable(ports, a, userId)
    if (unreachable) return fail(unreachable)
  }
  const own = await ports.settings.row(userId, key)
  return ok({ key, value: own ? own.value : await defaultValueOf(ports, key), assigned: own !== undefined })
}

/**
 * Создать ключ за юзером (право — `assign` схемы умолчания). Если строка
 * уже есть — ведёт себя как `setUserKey` (право редактирования).
 * Значение, равное умолчанию, не сохраняется.
 */
export async function createUserKey(
  ports: AuthPorts,
  accessToken: string | undefined,
  userId: string,
  key: string,
  value: unknown,
  simplifiedSchema?: ConfigKeySchema | null,
): Promise<UserResult<{ stored: boolean }>> {
  const a = await actorOf(ports, accessToken)
  if ('code' in a) return fail(a)
  if (simplifiedSchema !== undefined && !validSchema(simplifiedSchema, true)) return fail({ code: 'permissions.unknown' })
  const unreachable = await checkTargetReachable(ports, a, userId)
  if (unreachable) return fail(unreachable)
  const existing = await ports.settings.row(userId, key)
  if (existing) return setUserKey(ports, accessToken, userId, key, value)
  const def = await defaultRowOf(ports, key)
  if (!ruleAllows(a, userId, def?.schema?.assign)) return fail({ code: 'auth.forbidden' })
  if (sameValue(value, await defaultValueOf(ports, key))) return ok({ stored: false })
  await ports.settings.insert({ authId: userId, key, value, schema: simplifiedSchema ?? null })
  return ok({ stored: true })
}

/**
 * Записать значение ключа юзера. Право: упрощённая схема строки, без неё —
 * `editUser` схемы умолчания; строки ещё нет — право создания (`assign`).
 * Значение = умолчание: строка удаляется (или не создаётся) — не хранится.
 */
export async function setUserKey(
  ports: AuthPorts,
  accessToken: string | undefined,
  userId: string,
  key: string,
  value: unknown,
): Promise<UserResult<{ stored: boolean }>> {
  const a = await actorOf(ports, accessToken)
  if ('code' in a) return fail(a)
  const unreachable = await checkTargetReachable(ports, a, userId)
  if (unreachable) return fail(unreachable)
  const existing = await ports.settings.row(userId, key)
  const def = await defaultRowOf(ports, key)
  const roles = existing ? (existing.schema?.editUser ?? def?.schema?.editUser) : def?.schema?.assign
  if (!ruleAllows(a, userId, roles)) return fail({ code: 'auth.forbidden' })
  if (sameValue(value, await defaultValueOf(ports, key))) {
    if (existing) await ports.settings.remove(existing.id)
    return ok({ stored: false })
  }
  if (existing) await ports.settings.update(existing.id, { value })
  else await ports.settings.insert({ authId: userId, key, value, schema: null })
  return ok({ stored: true })
}

/** Снять ключ юзера (право: упрощённая схема строки, без неё — `deleteUser` умолчания). */
export async function removeUserKey(
  ports: AuthPorts,
  accessToken: string | undefined,
  userId: string,
  key: string,
): Promise<UserResult<{ stored: boolean }>> {
  const a = await actorOf(ports, accessToken)
  if ('code' in a) return fail(a)
  const unreachable = await checkTargetReachable(ports, a, userId)
  if (unreachable) return fail(unreachable)
  const existing = await ports.settings.row(userId, key)
  if (!existing) return ok({ stored: false })
  const def = await defaultRowOf(ports, key)
  if (!ruleAllows(a, userId, existing.schema?.deleteUser ?? def?.schema?.deleteUser)) return fail({ code: 'auth.forbidden' })
  await ports.settings.remove(existing.id)
  return ok({ stored: false })
}

/**
 * Записать умолчание ключа (значение и/или схему). Нового ключа ещё нет —
 * право администратора (модель то же держит ролью `insert`); существующее
 * умолчание меняет проходящий `editDefault` его схемы. Без `schema` в
 * патче схема не трогается; `schema: null` — схему снять.
 */
export async function setDefault(
  ports: AuthPorts,
  accessToken: string | undefined,
  key: string,
  patch: { value?: unknown; schema?: ConfigKeySchema | null },
): Promise<UserResult<{ stored: boolean }>> {
  const a = await actorOf(ports, accessToken)
  if ('code' in a) return fail(a)
  if (patch.schema !== undefined && !validSchema(patch.schema, false)) return fail({ code: 'permissions.unknown' })
  const existing = await defaultRowOf(ports, key)
  if (existing) {
    if (!ruleAllows(a, null, existing.schema?.editDefault)) return fail({ code: 'auth.forbidden' })
    await ports.settings.update(existing.id, {
      ...(patch.value !== undefined ? { value: patch.value } : {}),
      ...(patch.schema !== undefined ? { schema: patch.schema } : {}),
    })
  } else {
    if (!checkGrants(toPrincipal(a), gConfig.insert)) return fail({ code: 'auth.forbidden' })
    await ports.settings.insert({
      authId: null,
      key,
      ...(patch.value !== undefined ? { value: patch.value } : {}),
      schema: patch.schema ?? null,
    })
  }
  await invalidateDefaults(ports)
  return ok({ stored: true })
}

/** Удалить умолчание ключа (право — `editDefault`); при живых юзерских строках — отказ. */
export async function deleteDefaultKey(
  ports: AuthPorts,
  accessToken: string | undefined,
  key: string,
): Promise<UserResult<{ stored: boolean }>> {
  const a = await actorOf(ports, accessToken)
  if ('code' in a) return fail(a)
  const existing = await defaultRowOf(ports, key)
  if (!existing) return ok({ stored: false })
  if (!ruleAllows(a, null, existing.schema?.editDefault)) return fail({ code: 'auth.forbidden' })
  if (await ports.settings.anyUserRow(key)) return fail({ code: 'auth.forbidden' })
  await ports.settings.remove(existing.id)
  await invalidateDefaults(ports)
  return ok({ stored: false })
}
