/**
 * Блокировки аккаунта (`user.block`): записи — строки модели `user.block`,
 * исполнение нативно контекстом актора (маски, политики и `checks`
 * модели), отдельного API и системной роли у записи нет. Здесь —
 * пагинированный срез с фильтрами, чтение одной записи с расчётом флагов
 * возможностей, создание/правка (`reason`/`until`) и мягкое/полное удаление.
 */
import type { Filter, Order } from '#lib/db/index.js'
import { fail, guard, ok, principalOfRow, type UserResult } from './auth.js'
import { ADMIN_ROLE, MODERATOR_ROLE } from './permissions.js'
import { BLOCK_SCOPES, blockActive, isBlockScope, type BlockScope } from './spec-block.js'
import type { AuthPorts } from './ports.js'
import type {
  Blocked,
  BlockDetailView,
  BlocksOrder,
  BlocksPage,
  BlocksState,
  BlockView,
} from './types.js'

/** Круг записи блокировок: роль модератора, право записи модели или админ. */
export const BLOCK_WRITERS = [MODERATOR_ROLE, 'block.edit', ADMIN_ROLE] as const

/** Круг чтения живых блокировок (запись — в комплекте с чтением). */
export const BLOCK_READERS = [MODERATOR_ROLE, 'block.read', 'block.edit', ADMIN_ROLE] as const

/** Круг правки причины после создания записи (сильнее роли модератора). */
export const BLOCK_REASON_EDITORS = ['block.edit', ADMIN_ROLE] as const

/** Круг чтения мягко удалённых записей блокировок. */
export const BLOCK_DELETED_READERS = ['block.readDeleted', ADMIN_ROLE] as const

export const BLOCKS_MAX_PAGE_SIZE = 100

export const canBlock = (perms: readonly string[]): boolean =>
  BLOCK_WRITERS.some((p) => perms.includes(p))

export const canReadBlocks = (perms: readonly string[]): boolean =>
  BLOCK_READERS.some((p) => perms.includes(p))

export const canSeeDeletedBlocks = (perms: readonly string[]): boolean =>
  BLOCK_DELETED_READERS.some((p) => perms.includes(p))

export const canReadAnyBlocks = (perms: readonly string[]): boolean =>
  canReadBlocks(perms) || canSeeDeletedBlocks(perms)

export const canEditBlockReason = (perms: readonly string[]): boolean =>
  BLOCK_REASON_EDITORS.some((p) => perms.includes(p))

/** Окончательное удаление (`hard: true`): связка права записи и `readDeleted` (либо `admin`). */
export const canHardDeleteBlock = (perms: readonly string[]): boolean =>
  perms.includes(ADMIN_ROLE) || (canBlock(perms) && perms.includes('block.readDeleted'))

/** Варианты сфер каталога, которые вызывающий может назначать при создании блокировки. */
export const assignableBlockScopes = (perms: readonly string[]): BlockScope[] =>
  canBlock(perms) ? (Object.keys(BLOCK_SCOPES) as BlockScope[]) : []

const toBlocked = (r: BlockView): Blocked => ({
  scope: r.scope,
  reason: r.reason,
  at: r.at,
  ...(r.until !== null ? { until: r.until } : {}),
  ...(r.by ? { by: r.by } : {}),
})

const iso = (ms: number): string => new Date(ms).toISOString()

const BLOCKS_ORDER_OF: Record<BlocksOrder, Order> = {
  'created-desc': [['created_at', 'desc']],
  'created-asc': [['created_at', 'asc']],
  'until-asc': [['until', 'asc']],
  'until-desc': [['until', 'desc']],
  'scope-asc': [['scope', 'asc']],
  'scope-desc': [['scope', 'desc']],
  'deleted-desc': [['deleted_at', 'desc']],
  'deleted-asc': [['deleted_at', 'asc']],
}

export interface ListBlocksPageArgs {
  /** Фиксированный целевой пользователь (`/user/[id]/blocks`); пусто — глобальный список. */
  uid?: string | null
  /** Фильтр по списку пользователей (активен только в глобальном списке, когда `uid` не задан). */
  uids?: readonly string[]
  /** Фильтр по ключам сфер `BLOCK_SCOPES`. */
  scopes?: readonly string[]
  /** Фильтр состояния записей (`deleted` — только с `canSeeDeleted`). */
  state?: BlocksState
  /** Порядок сортировки (`deleted-*` — только с `canSeeDeleted`). */
  order?: BlocksOrder
  page?: number
  pageSize?: number
}

export async function listBlocksPage(
  ports: AuthPorts,
  accessToken: string | undefined,
  args: ListBlocksPageArgs = {},
): Promise<UserResult<BlocksPage>> {
  const g = await guard(ports, accessToken)
  if ('code' in g) return fail(g)

  const fixedUid = args.uid?.trim() || null
  const isOwnTarget = fixedUid !== null && fixedUid === g.sub
  const canSeeLive = canReadBlocks(g.perms) || isOwnTarget
  const canSeeDeleted = canSeeDeletedBlocks(g.perms)

  if (!canSeeLive && !canSeeDeleted) return fail({ code: 'auth.forbidden' })

  if (fixedUid && !isOwnTarget) {
    const target = await ports.auths.get(fixedUid)
    if (!target) return fail({ code: 'auth.identity-unknown' })
    if (
      target.deletedAt !== null &&
      !g.perms.includes(ADMIN_ROLE) &&
      !g.perms.includes('account.readDeleted')
    ) {
      return fail({ code: 'auth.identity-unknown' })
    }
  }

  const page = Math.max(1, Math.trunc(args.page ?? 1) || 1)
  const pageSize = Math.min(
    BLOCKS_MAX_PAGE_SIZE,
    Math.max(1, Math.trunc(args.pageSize ?? 30) || 30),
  )

  const state: BlocksState = !canSeeLive
    ? 'deleted'
    : args.state === 'deleted'
      ? canSeeDeleted
        ? 'deleted'
        : 'all'
      : args.state === 'active' || args.state === 'expired' || args.state === 'all'
        ? args.state
        : 'all'

  const orderName: BlocksOrder =
    args.order &&
    Object.hasOwn(BLOCKS_ORDER_OF, args.order) &&
    (canSeeDeleted || !args.order.startsWith('deleted'))
      ? args.order
      : 'created-desc'

  const nodes: Filter[] = []
  if (fixedUid) {
    nodes.push({ field: 'auth_id', op: 'eq', value: fixedUid })
  } else if (args.uids?.length) {
    const cleanUids = [...new Set(args.uids.map((id) => id.trim()).filter(Boolean))].slice(0, 500)
    if (cleanUids.length === 1) nodes.push({ field: 'auth_id', op: 'eq', value: cleanUids[0]! })
    else if (cleanUids.length > 1) nodes.push({ field: 'auth_id', op: 'in', value: cleanUids })
  }

  const validScopes = [...new Set((args.scopes ?? []).filter(isBlockScope))]
  if (validScopes.length === 1) {
    nodes.push({ field: 'scope', op: 'eq', value: validScopes[0]! })
  } else if (validScopes.length > 1) {
    nodes.push({ field: 'scope', op: 'in', value: validScopes })
  }

  const now = ports.clock.now()
  if (state === 'active') {
    nodes.push({
      or: [
        { field: 'until', op: 'isNull' },
        { field: 'until', op: 'gt', value: iso(now) },
      ],
    })
  } else if (state === 'expired') {
    nodes.push({
      and: [
        { field: 'until', op: 'isNotNull' },
        { field: 'until', op: 'lte', value: iso(now) },
      ],
    })
  } else if (state === 'deleted') {
    nodes.push({ field: 'deleted_at', op: 'gte', value: iso(0) })
  }

  const filter: Filter | undefined =
    nodes.length === 0 ? undefined : nodes.length === 1 ? nodes[0] : { and: nodes }

  const actor = principalOfRow({ id: g.sub, permissions: g.perms })
  const { rows, total } = await ports.blocks.listPage(actor, {
    page,
    pageSize,
    ...(filter ? { filter } : {}),
    order: BLOCKS_ORDER_OF[orderName],
    includeDeleted: state === 'deleted',
  })

  const scopes = fixedUid && isOwnTarget ? [] : assignableBlockScopes(g.perms)
  return ok({
    items: rows,
    total,
    page,
    pageSize,
    uid: fixedUid,
    canSeeDeleted,
    canSeeLive,
    canPickUsers: !fixedUid && (g.perms.includes(ADMIN_ROLE) || g.perms.includes('account.read')),
    assignableScopes: scopes,
    canCreate: scopes.length > 0 && (!fixedUid || !isOwnTarget),
  })
}

export async function blockCreateMeta(
  ports: AuthPorts,
  accessToken: string | undefined,
  targetId?: string | null,
): Promise<
  UserResult<{
    uid: string | null
    canCreate: boolean
    canPickUsers: boolean
    assignableScopes: readonly string[]
  }>
> {
  const g = await guard(ports, accessToken)
  if ('code' in g) return fail(g)

  const uid = targetId?.trim() || null
  if (uid) {
    if (uid === g.sub) return fail({ code: 'auth.forbidden' })
    const target = await ports.auths.get(uid)
    if (!target) return fail({ code: 'auth.identity-unknown' })
    if (
      target.deletedAt !== null &&
      !g.perms.includes(ADMIN_ROLE) &&
      !g.perms.includes('account.readDeleted')
    ) {
      return fail({ code: 'auth.identity-unknown' })
    }
  }

  const scopes = assignableBlockScopes(g.perms)
  if (scopes.length === 0) return fail({ code: 'auth.forbidden' })

  return ok({
    uid,
    canCreate: true,
    canPickUsers: !uid && (g.perms.includes(ADMIN_ROLE) || g.perms.includes('account.read')),
    assignableScopes: scopes,
  })
}

export async function readBlockDetail(
  ports: AuthPorts,
  accessToken: string | undefined,
  args: { blockId: string; expectedUid?: string | null },
): Promise<UserResult<BlockDetailView>> {
  const g = await guard(ports, accessToken)
  if ('code' in g) return fail(g)

  const blockId = String(args.blockId ?? '').trim()
  if (!blockId) return fail({ code: 'auth.identity-unknown' })

  const canSeeDeleted = canSeeDeletedBlocks(g.perms)
  const actor = principalOfRow({ id: g.sub, permissions: g.perms })
  const row = await ports.blocks.getById(actor, blockId, { includeDeleted: canSeeDeleted })
  if (!row) return fail({ code: 'auth.identity-unknown' })

  const expectedUid = args.expectedUid?.trim() || null
  if (expectedUid && row.authId !== expectedUid) return fail({ code: 'auth.identity-unknown' })

  const isDeleted = row.deletedAt != null
  const isOwnTarget = row.authId === g.sub
  const canReadThis = isDeleted
    ? canSeeDeleted
    : canReadBlocks(g.perms) || isOwnTarget
  if (!canReadThis) return fail({ code: 'auth.forbidden' })

  const writer = canBlock(g.perms)
  const canSubmit = !isDeleted && writer
  const canHardDelete = canHardDeleteBlock(g.perms)
  const canDelete = isDeleted ? canHardDelete : writer

  return ok({
    block: row,
    canSubmit,
    canEditReason: canSubmit && canEditBlockReason(g.perms),
    canEditUntil: canSubmit,
    canDelete,
    canHardDelete,
    assignableScopes: assignableBlockScopes(g.perms),
  })
}

export async function addBlock(
  ports: AuthPorts,
  accessToken: string | undefined,
  args: { targetId: string; scope: string; reason: string; forever?: boolean; until?: number | null },
): Promise<UserResult<{ id: string }>> {
  const g = await guard(ports, accessToken)
  if ('code' in g) return fail(g)
  const targetId = String(args.targetId ?? '').trim()
  if (!targetId) return fail({ code: 'auth.identity-unknown' })
  const target = await ports.auths.get(targetId)
  if (!target) return fail({ code: 'auth.identity-unknown' })
  const scopes = assignableBlockScopes(g.perms)
  if (!scopes.length) return fail({ code: 'auth.forbidden' })
  const scope = String(args.scope ?? '')
  if (!isBlockScope(scope)) return fail({ code: 'permissions.unknown', args: { value: scope } })
  if (!scopes.includes(scope)) return fail({ code: 'auth.forbidden' })
  if (!String(args.reason ?? '').trim()) return fail({ code: 'auth.forbidden' })
  if (targetId === g.sub) return fail({ code: 'auth.forbidden' })
  const until = args.forever ? null : (args.until ?? null)
  if (until !== null && until <= ports.clock.now()) return fail({ code: 'auth.forbidden' })
  const actor = principalOfRow({ id: g.sub, permissions: g.perms })
  await ports.blocks.insert(actor, {
    authId: targetId,
    scope,
    reason: String(args.reason ?? '').trim(),
    until,
    by: g.sub,
  })
  return ok({ id: targetId })
}

export async function saveBlock(
  ports: AuthPorts,
  accessToken: string | undefined,
  args: {
    blockId?: string | null
    targetId?: string | null
    scope?: string
    reason?: string
    forever?: boolean
    until?: number | null
    liftNow?: boolean
  },
): Promise<UserResult<{ id: string; targetId: string }>> {
  const blockId = String(args.blockId ?? '').trim()
  if (!blockId) {
    const targetId = String(args.targetId ?? '').trim()
    const created = await addBlock(ports, accessToken, {
      targetId,
      scope: String(args.scope ?? ''),
      reason: String(args.reason ?? ''),
      forever: args.forever,
      until: args.until,
    })
    if (!created.ok) return created
    return ok({ id: created.value.id, targetId })
  }

  const g = await guard(ports, accessToken)
  if ('code' in g) return fail(g)
  if (!canBlock(g.perms)) return fail({ code: 'auth.forbidden' })

  const actor = principalOfRow({ id: g.sub, permissions: g.perms })
  const row = await ports.blocks.getById(actor, blockId, { includeDeleted: false })
  if (!row || row.deletedAt != null) return fail({ code: 'auth.identity-unknown' })

  const expectedTarget = args.targetId?.trim() || null
  if (expectedTarget && row.authId !== expectedTarget) {
    return fail({ code: 'auth.identity-unknown' })
  }

  const patch: { until?: number | null; reason?: string } = {}
  if (args.liftNow) {
    if (!blockActive(toBlocked(row), ports.clock.now())) return fail({ code: 'auth.forbidden' })
    patch.until = ports.clock.now()
  } else {
    const nextUntil = args.forever ? null : (args.until ?? null)
    if (!args.forever && nextUntil === null) return fail({ code: 'auth.confirm' })
    if (nextUntil !== row.until) patch.until = nextUntil

    if (canEditBlockReason(g.perms) && args.reason !== undefined) {
      const trimmed = String(args.reason).trim()
      if (!trimmed) return fail({ code: 'auth.confirm' })
      if (trimmed !== row.reason) patch.reason = trimmed
    }
  }

  if (Object.keys(patch).length > 0) {
    await ports.blocks.update(actor, row.id, patch)
  }
  return ok({ id: row.id, targetId: row.authId })
}

export async function deleteBlock(
  ports: AuthPorts,
  accessToken: string | undefined,
  args: { blockId: string; targetId?: string | null; hard?: boolean },
): Promise<UserResult<{ id: string; targetId: string; hard: boolean }>> {
  const g = await guard(ports, accessToken)
  if ('code' in g) return fail(g)
  if (!canBlock(g.perms)) return fail({ code: 'auth.forbidden' })

  const blockId = String(args.blockId ?? '').trim()
  if (!blockId) return fail({ code: 'auth.identity-unknown' })

  const wantHard = Boolean(args.hard)
  const hasHardRight = canHardDeleteBlock(g.perms)
  if (wantHard && !hasHardRight) return fail({ code: 'auth.forbidden' })

  const actor = principalOfRow({ id: g.sub, permissions: g.perms })
  const row = await ports.blocks.getById(actor, blockId, { includeDeleted: hasHardRight })
  if (!row) return fail({ code: 'auth.identity-unknown' })

  const expectedTarget = args.targetId?.trim() || null
  if (expectedTarget && row.authId !== expectedTarget) {
    return fail({ code: 'auth.identity-unknown' })
  }

  const alreadyDeleted = row.deletedAt != null
  if (alreadyDeleted && !hasHardRight) return fail({ code: 'auth.forbidden' })

  const doHard = wantHard || alreadyDeleted
  await ports.blocks.remove(actor, row.id, { hard: doHard })
  return ok({ id: row.id, targetId: row.authId, hard: doHard })
}

export async function liftBlock(
  ports: AuthPorts,
  accessToken: string | undefined,
  args: { targetId: string; blockId: string },
): Promise<UserResult<{ id: string }>> {
  const r = await saveBlock(ports, accessToken, {
    blockId: args.blockId,
    targetId: args.targetId,
    liftNow: true,
  })
  return r.ok ? ok({ id: r.value.id }) : r
}

export async function listBlocks(
  ports: AuthPorts,
  accessToken: string | undefined,
  targetId: string,
): Promise<UserResult<{ blocks: BlockView[] }>> {
  const g = await guard(ports, accessToken)
  if ('code' in g) return fail(g)
  if (!canReadBlocks(g.perms)) return fail({ code: 'auth.forbidden' })
  const actor = principalOfRow({ id: g.sub, permissions: g.perms })
  const blocks = await ports.blocks.listByTarget(actor, targetId)
  return ok({ blocks })
}
