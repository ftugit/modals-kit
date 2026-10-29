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
 *   `editUser` / `deleteUser` схемы умолчания. Роль в схеме — из каталога
 *   `permissions.ts`, плюс `owner` (владелец строки) и `admin` (всегда);
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
import { ADMIN_ROLE, PERMISSIONS } from './permissions.js'
import type { AuthPorts } from './ports.js'
import { config as configResource } from './schema.js'
import { bootstrapOf } from './spec-config.js'
import type { ConfigKeyRow, ConfigKeySchema } from './types.js'

const gConfig = grants(configResource)
const DEFAULTS_CACHE_KEY = 'defaults.v1'
const SCHEMA_RULES = ['editDefault', 'assign', 'editUser', 'deleteUser'] as const

type Actor = { id: string; perms: readonly string[] }

const toPrincipal = (a: Actor) => principalOfRow({ id: a.id, permissions: a.perms }).principal

/** Проходит ли актор по списку ролей правила `ConfigKeySchema` (плюс `owner` целевой строки и `admin`). */
function ruleAllows(a: Actor, targetUserId: string | null, roles: readonly string[] | undefined): boolean {
  return checkGrants(
    toPrincipal(a),
    roles?.length ? [...roles, ADMIN_ROLE] : [ADMIN_ROLE],
    { ownerId: targetUserId },
  )
}

/** Схема из присланного: только известные правила и роли каталога (+ `owner`/`admin`). */
function validSchema(schema: unknown, simplified: boolean): schema is ConfigKeySchema {
  if (schema === null) return true
  if (typeof schema !== 'object' || Array.isArray(schema)) return false
  const allowed: readonly string[] = simplified ? ['editUser', 'deleteUser'] : SCHEMA_RULES
  for (const [rule, roles] of Object.entries(schema as Record<string, unknown>)) {
    if (!allowed.includes(rule)) return false
    if (!Array.isArray(roles) || roles.length > 8) return false
    for (const r of roles) {
      if (typeof r !== 'string' || (r !== 'owner' && r !== ADMIN_ROLE && !Object.hasOwn(PERMISSIONS, r))) return false
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

/** Значение умолчания ключа: строка умолчания, а без значения в ней — бутстрап кода. */
async function defaultValueOf(ports: AuthPorts, key: string): Promise<unknown> {
  const row = await defaultRowOf(ports, key)
  return row && row.value !== null && row.value !== undefined ? row.value : bootstrapOf(key)
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
  if (!(await ports.auths.get(userId))) return fail({ code: 'auth.identity-unknown' })
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
  if (!(await ports.auths.get(userId))) return fail({ code: 'auth.identity-unknown' })
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
