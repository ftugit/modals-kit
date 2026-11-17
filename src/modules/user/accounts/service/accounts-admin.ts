/**
 * Наборные действия над аккаунтами (план сессий §11.2, S18).
 *
 * Дверь одна: мягкая метка удаления для набора `ids` или среза списка.
 * Физического стирания здесь нет — зачистку зовёт планировщик владельца,
 * поэтому UI обязан говорить «удаление запрошено», а не «стёрто» (§11.5).
 *
 * Правила контракта отказа:
 *  - право проверяется на каждую строку (`admin`/`server`, как у модели);
 *  - пустой набор и смешивание форм — отказ разбора, не «ноль обработано»;
 *  - предел `ids` — отказ с кодом, а не усечение;
 *  - повторное удаление — «без изменений», а не ошибка всего набора;
 *  - частичный исход виден числами: запрошено / изменено / без изменений / отклонено;
 *  - запрет на себя и на последнего администратора.
 */
import { checkGrants, grants, type DataContext } from '#core/lib/db/index.js'
import { ADMIN_ROLE } from '../../base/service/permissions.js'
import { fail, guard, ok, principalOfRow, type UserResult } from '../../base/service/auth.js'
import { auth as authResource } from '../../base/model/schema.js'
import type { AuthPorts } from '../../base/service/ports.js'
import { BULK_IDS_LIMIT, emptyCounts, parseBulkInput, type BulkCounts } from '../../base/service/bulk.js'
import { listSeedUsers, type ListSeedUsersArgs } from './accounts.js'

const gAuth = grants(authResource)

/** Срез списка аккаунтов: всё, что список умеет фильтровать, кроме порции и `ids`. */
export type AccountsSlice = Omit<ListSeedUsersArgs, 'page' | 'pageSize' | 'ids'>

/**
 * Сколько аккаунтов нёс срез — не больше предела набора. Резолвит домен, а не
 * клиент: права на срез проверяет тот же `listSeedUsers`, что и список.
 * Возвращает на один больше предела, чтобы вызывающий отличил «ровно предел»
 * от «срез больше предела».
 */
export async function resolveAccountSlice(
  ports: AuthPorts,
  accessToken: string | undefined,
  slice: AccountsSlice,
  limit = BULK_IDS_LIMIT,
): Promise<UserResult<string[]>> {
  const seen = new Set<string>()
  const pageSize = 100
  for (let page = 1; page <= 1000; page++) {
    const r = await listSeedUsers(ports, accessToken, { ...slice, page, pageSize })
    if (!r.ok) return r
    for (const item of r.value.items) seen.add(item.id)
    if (seen.size > limit) return ok([...seen].slice(0, limit + 1))
    if (seen.size >= r.value.total || r.value.items.length < pageSize) break
  }
  return ok([...seen])
}

/**
 * Живые аккаунты с ролью `admin` — для запрета «последний администратор».
 * Читаем контекстом актора: право на удаление уже проверено, а роли `admin`
 * дают модели живое чтение. Отдельной двери в `AuthStorePort` не заводим.
 */
async function adminIds(ports: AuthPorts, ctx: DataContext): Promise<Set<string>> {
  const found = new Set<string>()
  const pageSize = 200
  for (let page = 1; page <= 1000; page++) {
    const { rows } = await ports.auths.listPage(ctx, { page, pageSize, includeDeleted: false })
    for (const row of rows) if (row.permissions.includes(ADMIN_ROLE)) found.add(row.id)
    if (rows.length < pageSize) break
  }
  return found
}

export interface DeleteAccountsArgs {
  /** Одна цель — та же форма набора, что в компоненте действия. */
  id?: string | null
  /** Явный набор; передаётся списком или CSV. */
  ids?: readonly string[] | string | null
  /** Срез списка: условия фильтра, а не готовые id. */
  slice?: AccountsSlice | null
}

export interface DeleteAccountsResult {
  counts: BulkCounts
  /**
   * Итог по каждому id — носитель показывает отказ построчно, а не «часть
   * не удалась» без причины.
   */
  rows: readonly { id: string; outcome: 'deleted' | 'unchanged' | 'rejected' }[]
}

/**
 * Мягко удалить набор аккаунтов. Сессии цели отзываются сразу (домен), сама
 * строка остаётся помеченной до зачистки планировщиком.
 */
export async function deleteAccountsBySet(
  ports: AuthPorts,
  accessToken: string | undefined,
  args: DeleteAccountsArgs,
): Promise<UserResult<DeleteAccountsResult>> {
  const g = await guard(ports, accessToken)
  if ('code' in g) return fail(g)

  const actor = principalOfRow({ id: g.sub, permissions: g.perms }).principal
  if (!checkGrants(actor, gAuth.delete)) return fail({ code: 'auth.forbidden' })

  // Ровно одна форма: пустой набор и смешивание — отказ разбора (общий контракт).
  const parsed = parseBulkInput({
    id: args.id,
    ids: args.ids,
    slice: args.slice as Record<string, string> | null | undefined,
  })
  if (!parsed.ok) return fail({ code: parsed.code })

  let ids = parsed.ids
  if (parsed.form === 'slice') {
    const r = await resolveAccountSlice(ports, accessToken, args.slice ?? {})
    if (!r.ok) return r
    if (r.value.length > BULK_IDS_LIMIT) return fail({ code: 'auth.limit' })
    ids = r.value
  }
  if (ids.length === 0) return fail({ code: 'auth.confirm' })

  const now = ports.clock.now()
  const ctx = principalOfRow({ id: g.sub, permissions: g.perms })
  const admins = await adminIds(ports, ctx)
  // Кто останется администратором, если набор уйдёт целиком: последний живой
  // admin вне набора — граница, за которую удаление не идёт.
  const targetSet = new Set(ids)
  let adminsLeft = 0
  for (const id of admins) if (!targetSet.has(id) && id !== g.sub) adminsLeft++
  const actorIsAdmin = admins.has(g.sub)

  const counts = emptyCounts(ids.length)
  const rows: DeleteAccountsResult['rows'][number][] = []

  for (const id of ids) {
    if (id === g.sub) {
      counts.rejected++
      rows.push({ id, outcome: 'rejected' })
      continue
    }
    const row = await ports.auths.get(ctx, id, { includeDeleted: true })
    if (!row) {
      counts.rejected++
      rows.push({ id, outcome: 'rejected' })
      continue
    }
    if (row.deletedAt !== null) {
      counts.unchanged++
      rows.push({ id, outcome: 'unchanged' })
      continue
    }
    // Последний администратор: ни один admin не останется ни в наборе, ни в
    // акторе — отказ, а не осиротевшая система без прав.
    if (
      row.permissions.includes(ADMIN_ROLE) &&
      adminsLeft === 0 &&
      !(actorIsAdmin && !targetSet.has(g.sub))
    ) {
      counts.rejected++
      rows.push({ id, outcome: 'rejected' })
      continue
    }
    await ports.auths.markDeleted(ctx, id, now)
    await ports.sessions.softDeleteAllByAuth(id, now)
    counts.changed++
    rows.push({ id, outcome: 'deleted' })
  }

  return ok({ counts, rows })
}
