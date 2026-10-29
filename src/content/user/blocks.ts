/**
 * Блокировки аккаунта (этап 9): записи — строки модели `user.block`,
 * исполнение нативно контекстом актора (маски, политики и `checks`
 * модели), отдельного API и системной роли у записи нет. Здесь —
 * только то, чего модель не видит: существование цели, сборка срока
 * из «навсегда/дата», активность записи при снятии и чтение списком.
 */
import { fail, guard, ok, principalOfRow, type UserResult } from './auth.js'
import { ADMIN_ROLE, MODERATOR_ROLE } from './permissions.js'
import { blockActive, isBlockScope } from './spec-block.js'
import type { AuthPorts } from './ports.js'
import type { Blocked, BlockView } from './types.js'

/** Круг операции: отдельная роль модератора, правка аккаунта или админ. */
export const BLOCK_ACTORS = [MODERATOR_ROLE, 'account.edit', ADMIN_ROLE] as const

export const canBlock = (perms: readonly string[]): boolean =>
  BLOCK_ACTORS.some((p) => perms.includes(p))

const toBlocked = (r: BlockView): Blocked => ({
  scope: r.scope,
  reason: r.reason,
  at: r.at,
  ...(r.until !== null ? { until: r.until } : {}),
  ...(r.by ? { by: r.by } : {}),
})

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
  if (!canBlock(g.perms)) return fail({ code: 'auth.forbidden' })
  // Содержательные правила дублирует модель своими `checks` (защита
  // в глубину); здесь они дают человеку факты домена, а не сбой слоя.
  const scope = String(args.scope ?? '')
  if (!isBlockScope(scope)) return fail({ code: 'permissions.unknown', args: { value: scope } })
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

export async function liftBlock(
  ports: AuthPorts,
  accessToken: string | undefined,
  args: { targetId: string; blockId: string },
): Promise<UserResult<{ id: string }>> {
  const g = await guard(ports, accessToken)
  if ('code' in g) return fail(g)
  const actor = principalOfRow({ id: g.sub, permissions: g.perms })
  const rows = await ports.blocks.listByTarget(actor, String(args.targetId ?? ''))
  const row = rows.find((r) => r.id === String(args.blockId ?? ''))
  if (!row) return fail({ code: 'auth.identity-unknown' })
  if (!blockActive(toBlocked(row), ports.clock.now())) return fail({ code: 'auth.forbidden' })
  await ports.blocks.update(actor, row.id, { until: ports.clock.now() })
  return ok({ id: row.id })
}

export async function listBlocks(
  ports: AuthPorts,
  accessToken: string | undefined,
  targetId: string,
): Promise<UserResult<{ blocks: BlockView[] }>> {
  const g = await guard(ports, accessToken)
  if ('code' in g) return fail(g)
  if (!canBlock(g.perms)) return fail({ code: 'auth.forbidden' })
  const actor = principalOfRow({ id: g.sub, permissions: g.perms })
  const blocks = await ports.blocks.listByTarget(actor, targetId)
  return ok({ blocks })
}
