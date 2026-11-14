/**
 * Наборные действия над блокировками (план сессий §11.2, S19).
 *
 * Двери: снятие блокировки (`liftNow`) и мягкое удаление записи для набора
 * `ids` или среза списка. Одиночная строка — тот же набор из одного id.
 *
 * Правила контракта отказа:
 *  - право проверяется на каждую строку (снятие — `update`/`edit`, удаление —
 *    `softDelete`/`edit`, как у модели `user.block`);
 *  - пустой набор и смешивание форм — отказ разбора, не «ноль обработано»;
 *  - предел `ids` — отказ с кодом, а не усечение;
 *  - повторное действие — «без изменений», а не ошибка всего набора;
 *  - частичный исход виден числами: запрошено / изменено / без изменений / отклонено.
 *
 * Снятие ставит `until = сейчас` и **не** удаляет строку: история блокировок
 * остаётся, поэтому «разблокировать» и «удалить запись» — разные двери.
 */
import { checkGrants, grants } from '#lib/db/index.js'
import { blockActive } from './spec-block.js'
import { fail, guard, ok, principalOfRow, type UserResult } from './auth.js'
import { block as blockResource } from './schema.js'
import type { AuthPorts } from './ports.js'
import { BULK_IDS_LIMIT, bulkIds, emptyCounts, type BulkCounts } from './bulk.js'
import { listBlocksPage, type ListBlocksPageArgs } from './blocks.js'

const gBlock = grants(blockResource)

/** Срок не задан — запись бессрочная; `blockActive` ждёт `undefined`, а не `null`. */
const isLive = (row: { until: number | null; scope: string; reason: string; at: number }, now: number) =>
  blockActive(
    { scope: row.scope, reason: row.reason, at: row.at, ...(row.until !== null ? { until: row.until } : {}) },
    now,
  )

/** Срез списка блокировок: всё, что список умеет фильтровать, кроме порции. */
export type BlocksSlice = Omit<ListBlocksPageArgs, 'page' | 'pageSize'>

/** Исход по каждой строке: носитель показывает отказ построчно, с причиной. */
export type BlockBulkOutcome = 'lifted' | 'deleted' | 'unchanged' | 'rejected'

export interface BlocksBulkResult {
  counts: BulkCounts
  rows: readonly { id: string; outcome: BlockBulkOutcome }[]
}

/**
 * Сколько записей нёс срез — не больше предела набора. Резолвит домен, а не
 * клиент: права на срез проверяет тот же `listBlocksPage`, что и список.
 * Возвращает на один больше предела, чтобы вызывающий отличил «ровно предел»
 * от «срез больше предела».
 */
export async function resolveBlockSlice(
  ports: AuthPorts,
  accessToken: string | undefined,
  slice: BlocksSlice,
  limit = BULK_IDS_LIMIT,
): Promise<UserResult<string[]>> {
  const seen = new Set<string>()
  const pageSize = 100
  for (let page = 1; page <= 1000; page++) {
    const r = await listBlocksPage(ports, accessToken, { ...slice, page, pageSize })
    if (!r.ok) return r
    for (const item of r.value.items) seen.add(item.id)
    if (seen.size > limit) return ok([...seen].slice(0, limit + 1))
    if (seen.size >= r.value.total || r.value.items.length < pageSize) break
  }
  return ok([...seen])
}

export interface BlocksBulkArgs {
  /** Одна цель — та же форма набора, что в компоненте действия. */
  id?: string | null
  /** Явный набор; передаётся списком или CSV. */
  ids?: readonly string[] | string | null
  /** Срез списка: условия фильтра, а не готовые id. */
  slice?: BlocksSlice | null
}

/**
 * Набор id из аргументов: одна форма, предел, срез.
 *
 * Срез здесь считается формой и пустым: список блокировок без фильтров —
 * тоже срез (вся история), поэтому `{}` — это «весь список», а не пустой
 * набор. Пустой `ids` и смешивание форм — отказ разбора.
 */
async function resolveIds(
  ports: AuthPorts,
  accessToken: string | undefined,
  args: BlocksBulkArgs,
): Promise<UserResult<string[]>> {
  const id = String(args.id ?? '').trim()
  const ids = bulkIds(args.ids)
  const slice = args.slice ?? null
  const forms = Number(id !== '') + Number(ids.length > 0) + Number(slice !== null)
  if (forms !== 1) return fail({ code: 'auth.confirm' })
  if (slice) {
    const r = await resolveBlockSlice(ports, accessToken, slice)
    if (!r.ok) return r
    if (r.value.length > BULK_IDS_LIMIT) return fail({ code: 'auth.limit' })
    if (r.value.length === 0) return fail({ code: 'auth.confirm' })
    return r
  }
  if (id) return ok([id])
  if (ids.length > BULK_IDS_LIMIT) return fail({ code: 'auth.limit' })
  return ok(ids)
}

/**
 * Снять блокировки набора: `until = сейчас`. Уже снятая или истёкшая запись —
 * «без изменений», а не отказ: повтор действия не ломает исход.
 */
export async function liftBlocksBySet(
  ports: AuthPorts,
  accessToken: string | undefined,
  args: BlocksBulkArgs,
): Promise<UserResult<BlocksBulkResult>> {
  const g = await guard(ports, accessToken)
  if ('code' in g) return fail(g)

  const actor = principalOfRow({ id: g.sub, permissions: g.perms }).principal
  if (!checkGrants(actor, gBlock.update)) return fail({ code: 'auth.forbidden' })

  const resolved = await resolveIds(ports, accessToken, args)
  if (!resolved.ok) return resolved

  const ctx = principalOfRow({ id: g.sub, permissions: g.perms })
  const now = ports.clock.now()
  const counts = emptyCounts(resolved.value.length)
  const rows: BlocksBulkResult['rows'][number][] = []

  for (const id of resolved.value) {
    const row = await ports.blocks.getById(ctx, id, { includeDeleted: false })
    if (!row || row.deletedAt != null) {
      counts.rejected++
      rows.push({ id, outcome: 'rejected' })
      continue
    }
    if (!isLive(row, now)) {
      counts.unchanged++
      rows.push({ id, outcome: 'unchanged' })
      continue
    }
    await ports.blocks.update(ctx, row.id, { until: now })
    counts.changed++
    rows.push({ id, outcome: 'lifted' })
  }

  return ok({ counts, rows })
}

/**
 * Мягко удалить записи набора. История остаётся помеченной: окончательное
 * стирание — отдельная дверь строки (`deleteBlock` с `hard`), в наборе её нет.
 */
export async function deleteBlocksBySet(
  ports: AuthPorts,
  accessToken: string | undefined,
  args: BlocksBulkArgs,
): Promise<UserResult<BlocksBulkResult>> {
  const g = await guard(ports, accessToken)
  if ('code' in g) return fail(g)

  const actor = principalOfRow({ id: g.sub, permissions: g.perms }).principal
  if (!checkGrants(actor, gBlock.delete)) return fail({ code: 'auth.forbidden' })

  const resolved = await resolveIds(ports, accessToken, args)
  if (!resolved.ok) return resolved

  const ctx = principalOfRow({ id: g.sub, permissions: g.perms })
  const counts = emptyCounts(resolved.value.length)
  const rows: BlocksBulkResult['rows'][number][] = []

  for (const id of resolved.value) {
    // Читаем с меткой удаления: уже удалённая запись — «без изменений»
    // (идемпотентность), а не отказ всего набора. Содержимое наружу не уходит.
    const row = await ports.blocks.getById(ctx, id, { includeDeleted: true })
    if (!row) {
      counts.rejected++
      rows.push({ id, outcome: 'rejected' })
      continue
    }
    if (row.deletedAt != null) {
      counts.unchanged++
      rows.push({ id, outcome: 'unchanged' })
      continue
    }
    await ports.blocks.remove(ctx, row.id, { hard: false })
    counts.changed++
    rows.push({ id, outcome: 'deleted' })
  }

  return ok({ counts, rows })
}
