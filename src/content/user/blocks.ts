/**
 * Блокировки аккаунта (`user.block`): записи — строки модели `user.block`,
 * исполнение нативно контекстом актора (маски, `defineAcl` и `checks`
 * модели), отдельного API и системной роли у записи нет. Все проверки прав
 * в домене читаются из `grants(block)` и `grants(auth)` через `checkGrants` —
 * без дублирующих массивов ролей и строковых прав.
 */
import { checkGrants, grants, type Filter, type Order } from '#lib/db/index.js'
import { fail, guard, ok, principalOfRow, type UserResult } from './auth.js'
import { auth as authResource, block as blockResource } from './schema.js'
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

const gBlock = grants(blockResource)
const gAuth = grants(authResource)

export const BLOCKS_MAX_PAGE_SIZE = 100

const actorOf = (sub: string, perms: readonly string[]) =>
  principalOfRow({ id: sub, permissions: perms }).principal

export const canBlock = (perms: readonly string[]): boolean =>
  checkGrants({ roles: perms }, gBlock.insert)

export const canReadBlocks = (perms: readonly string[]): boolean =>
  checkGrants({ roles: perms }, gBlock.select)

export const canSeeDeletedBlocks = (perms: readonly string[]): boolean =>
  checkGrants({ roles: perms }, gBlock.selectDeleted)

export const canEditBlockReason = (perms: readonly string[]): boolean =>
  checkGrants({ roles: perms }, gBlock.fields.reason!.update)

/** Окончательное удаление (`hard: true`): `grants(block).hardDelete` (`block.edit` + `block.readDeleted` или `admin`). */
export const canHardDeleteBlock = (perms: readonly string[]): boolean =>
  checkGrants({ roles: perms }, gBlock.hardDelete)

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
  const actor = actorOf(g.sub, g.perms)
  const caps = checkGrants(
    actor,
    {
      canSeeLive: gBlock.select,
      canSeeDeleted: gBlock.selectDeleted,
      canPickUsers: gAuth.select,
      canSeeDeletedAccounts: gAuth.selectDeleted,
      canCreate: gBlock.insert,
    },
    { ownerId: fixedUid },
  )

  if (!caps.canSeeLive) return fail({ code: 'auth.forbidden' })

  if (fixedUid && !isOwnTarget) {
    const target = await ports.auths.get(fixedUid)
    if (!target) return fail({ code: 'auth.identity-unknown' })
    if (target.deletedAt !== null && !caps.canSeeDeletedAccounts) {
      return fail({ code: 'auth.identity-unknown' })
    }
  }

  const page = Math.max(1, Math.trunc(args.page ?? 1) || 1)
  const pageSize = Math.min(
    BLOCKS_MAX_PAGE_SIZE,
    Math.max(1, Math.trunc(args.pageSize ?? 30) || 30),
  )

  const rawState: BlocksState = args.state ?? 'all'
  const state: BlocksState =
    rawState === 'deleted' && !caps.canSeeDeleted ? 'all' : rawState

  const rawOrder: BlocksOrder = args.order ?? 'created-desc'
  const order: BlocksOrder =
    !caps.canSeeDeleted && (rawOrder === 'deleted-desc' || rawOrder === 'deleted-asc')
      ? 'created-desc'
      : rawOrder

  const includeDeleted = caps.canSeeDeleted && state === 'deleted'
  const now = ports.clock.now()
  const nowIso = iso(now)
  const and: Filter[] = []

  if (fixedUid) {
    and.push({ field: 'auth_id', op: 'eq', value: fixedUid })
  } else {
    const uids = [...new Set((args.uids ?? []).map((s) => s.trim()).filter(Boolean))]
    if (uids.length > 0) {
      and.push({ field: 'auth_id', op: 'in', value: uids })
    }
  }

  const scopesFilter = [...new Set((args.scopes ?? []).filter(isBlockScope))]
  if (scopesFilter.length > 0) {
    and.push({ field: 'scope', op: 'in', value: scopesFilter })
  }

  if (state === 'deleted') {
    and.push({ field: 'deleted_at', op: 'gte', value: iso(0) })
  } else if (state === 'active') {
    and.push({
      or: [
        { field: 'until', op: 'isNull' },
        { field: 'until', op: 'gt', value: nowIso },
      ],
    })
  } else if (state === 'expired') {
    and.push({ field: 'until', op: 'lte', value: nowIso })
  }

  const filter: Filter | undefined =
    and.length === 0 ? undefined : and.length === 1 ? and[0] : { and }

  const ctx = principalOfRow({ id: g.sub, permissions: g.perms })
  const res = await ports.blocks.listPage(ctx, {
    page,
    pageSize,
    includeDeleted,
    filter,
    order: BLOCKS_ORDER_OF[order],
  })

  const scopes = caps.canCreate ? (Object.keys(BLOCK_SCOPES) as BlockScope[]) : []
  return ok({
    items: res.rows,
    total: res.total,
    page,
    pageSize,
    uid: fixedUid,
    canSeeDeleted: caps.canSeeDeleted,
    canSeeLive: caps.canSeeLive,
    canPickUsers: !fixedUid && caps.canPickUsers,
    assignableScopes: scopes,
    canCreate: caps.canCreate && (!fixedUid || !isOwnTarget),
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

  const actor = actorOf(g.sub, g.perms)
  const caps = checkGrants(actor, {
    canCreate: gBlock.insert,
    canPickUsers: [gAuth.select, gBlock.insert],
    canSeeDeletedAccounts: gAuth.selectDeleted,
  })
  if (!caps.canCreate) return fail({ code: 'auth.forbidden' })

  const uid = targetId?.trim() || null
  if (uid) {
    if (uid === g.sub) return fail({ code: 'auth.forbidden' })
    const target = await ports.auths.get(uid)
    if (!target) return fail({ code: 'auth.identity-unknown' })
    if (target.deletedAt !== null && !caps.canSeeDeletedAccounts) {
      return fail({ code: 'auth.identity-unknown' })
    }
  }

  const scopes = Object.keys(BLOCK_SCOPES) as BlockScope[]
  return ok({
    uid,
    canCreate: true,
    canPickUsers: !uid && caps.canPickUsers,
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

  const actor = actorOf(g.sub, g.perms)
  const canSeeDeleted = checkGrants(actor, gBlock.selectDeleted)
  const ctx = principalOfRow({ id: g.sub, permissions: g.perms })
  const row = await ports.blocks.getById(ctx, blockId, { includeDeleted: canSeeDeleted })
  if (!row) return fail({ code: 'auth.identity-unknown' })

  const expectedUid = args.expectedUid?.trim() || null
  if (expectedUid && row.authId !== expectedUid) return fail({ code: 'auth.identity-unknown' })

  const caps = checkGrants(
    actor,
    {
      canReadLive: gBlock.select,
      canReadDeleted: gBlock.selectDeleted,
      canUpdate: gBlock.update,
      canSoftDelete: gBlock.delete,
      canHardDelete: gBlock.hardDelete,
      canEditReason: gBlock.fields.reason!.update,
      canCreate: gBlock.insert,
    },
    { ownerId: row.authId },
  )

  const isDeleted = row.deletedAt != null
  const canReadThis = isDeleted ? caps.canReadDeleted : caps.canReadLive
  if (!canReadThis) return fail({ code: 'auth.forbidden' })

  const canSubmit = !isDeleted && caps.canUpdate
  const canDelete = isDeleted ? caps.canHardDelete : caps.canSoftDelete

  return ok({
    block: row,
    canSubmit,
    canEditReason: canSubmit && caps.canEditReason,
    canEditUntil: canSubmit,
    canDelete,
    canHardDelete: caps.canHardDelete,
    assignableScopes: caps.canCreate ? (Object.keys(BLOCK_SCOPES) as BlockScope[]) : [],
  })
}

export async function addBlock(
  ports: AuthPorts,
  accessToken: string | undefined,
  args: { targetId: string; scope: string; reason: string; forever?: boolean; until?: number | null },
): Promise<UserResult<{ id: string }>> {
  const saved = await saveBlock(ports, accessToken, {
    targetId: args.targetId,
    scope: args.scope,
    reason: args.reason,
    forever: args.forever,
    until: args.until,
  })
  if (!saved.ok) return saved
  return ok({ id: saved.value.targetId })
}

export async function saveBlock(
  ports: AuthPorts,
  accessToken: string | undefined,
  args: {
    blockId?: string | null
    targetId?: string | null
    targetIds?: readonly string[]
    scope?: string
    reason?: string
    forever?: boolean
    until?: number | null
    liftNow?: boolean
  },
): Promise<UserResult<{ id: string; targetId: string; targetIds?: readonly string[]; count?: number }>> {
  const g = await guard(ports, accessToken)
  if ('code' in g) return fail(g)
  const actor = actorOf(g.sub, g.perms)
  const ctx = principalOfRow({ id: g.sub, permissions: g.perms })

  const blockId = String(args.blockId ?? '').trim()
  if (!blockId) {
    const rawTargets =
      args.targetIds !== undefined
        ? args.targetIds
        : args.targetId
          ? [args.targetId]
          : []
    const targets = [...new Set(rawTargets.map((s) => String(s ?? '').trim()).filter(Boolean))]
    if (targets.length === 0) return fail({ code: 'auth.identity-unknown' })

    for (const targetId of targets) {
      const target = await ports.auths.get(targetId)
      if (!target) return fail({ code: 'auth.identity-unknown' })
    }

    if (!checkGrants(actor, gBlock.insert)) return fail({ code: 'auth.forbidden' })
    const scope = String(args.scope ?? '')
    if (!isBlockScope(scope)) return fail({ code: 'permissions.unknown', args: { value: scope } })
    const reason = String(args.reason ?? '').trim()
    if (!reason) return fail({ code: 'auth.forbidden' })
    if (targets.includes(g.sub)) return fail({ code: 'auth.forbidden' })
    const until = args.forever ? null : (args.until ?? null)
    if (until !== null && until <= ports.clock.now()) return fail({ code: 'auth.forbidden' })

    for (const targetId of targets) {
      await ports.blocks.insert(ctx, {
        authId: targetId,
        scope,
        reason,
        until,
        by: g.sub,
      })
    }
    return ok({
      id: targets[0]!,
      targetId: targets[0]!,
      targetIds: targets,
      count: targets.length,
    })
  }

  if (!checkGrants(actor, gBlock.update)) return fail({ code: 'auth.forbidden' })

  const row = await ports.blocks.getById(ctx, blockId, { includeDeleted: false })
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

    if (checkGrants(actor, gBlock.fields.reason!.update) && args.reason !== undefined) {
      const trimmed = String(args.reason).trim()
      if (!trimmed) return fail({ code: 'auth.confirm' })
      if (trimmed !== row.reason) patch.reason = trimmed
    }
  }

  if (Object.keys(patch).length > 0) {
    await ports.blocks.update(ctx, row.id, patch)
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
  const actor = actorOf(g.sub, g.perms)
  const caps = checkGrants(actor, {
    canSeeDeleted: gBlock.selectDeleted,
    canSoftDelete: gBlock.delete,
    canHardDelete: gBlock.hardDelete,
  })
  if (!caps.canSoftDelete) return fail({ code: 'auth.forbidden' })

  const blockId = String(args.blockId ?? '').trim()
  if (!blockId) return fail({ code: 'auth.identity-unknown' })

  const wantHard = Boolean(args.hard)
  if (wantHard && !caps.canHardDelete) return fail({ code: 'auth.forbidden' })

  const ctx = principalOfRow({ id: g.sub, permissions: g.perms })
  const row = await ports.blocks.getById(ctx, blockId, { includeDeleted: caps.canSeeDeleted })
  if (!row) return fail({ code: 'auth.identity-unknown' })

  const expectedTarget = args.targetId?.trim() || null
  if (expectedTarget && row.authId !== expectedTarget) {
    return fail({ code: 'auth.identity-unknown' })
  }

  const alreadyDeleted = row.deletedAt != null
  if (alreadyDeleted && !caps.canHardDelete) return fail({ code: 'auth.forbidden' })

  const doHard = wantHard || alreadyDeleted
  await ports.blocks.remove(ctx, row.id, { hard: doHard })
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
  const actor = actorOf(g.sub, g.perms)
  if (!checkGrants(actor, gBlock.select)) return fail({ code: 'auth.forbidden' })
  const ctx = principalOfRow({ id: g.sub, permissions: g.perms })
  const blocks = await ports.blocks.listByTarget(ctx, targetId)
  return ok({ blocks })
}
