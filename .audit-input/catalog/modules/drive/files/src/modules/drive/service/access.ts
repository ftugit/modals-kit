/**
 * Эффективный доступ к узлу «Диска» (`plan-drive.md` §4.4).
 *
 * Наследование идёт вверх: доступ на папку действует на всё поддерево, поэтому
 * для узла собирается цепочка «узел → предки» и берётся самая сильная роль.
 * Модель такое правило фильтром не выражает; строки читаются серверным
 * контекстом только после решения этого файла, а наружу уходят права, а не
 * служебные роли.
 */
import { normalizeFailure, type Database, type DataContext, type Filter } from '#core/lib/db/index.js'
import {
  driveBreadcrumbs,
  type DriveBreadcrumb,
  type DriveCapabilities,
  type DriveNodeView,
  type DriveShareRole,
} from '#core/lib/drive/index.js'
import { DRIVE_MAX_DEPTH } from '../checks.js'
import { driveNode, driveShare } from '../schema.js'
import type { DriveAccess, DriveActor, DriveShareView } from '../types.js'

/** Контекст служебного чтения: строки видны только после проверки доступа. */
export const DRIVE_SERVER: DataContext = Object.freeze({
  principal: Object.freeze({ roles: Object.freeze(['server']) }),
})

const hasPermission = (actor: DriveActor, permission: string): boolean =>
  actor.permissions.includes(permission)

/** Роль `admin` даёт полный круг по всем дискам. */
export const isDriveAdmin = (actor: DriveActor): boolean => hasPermission(actor, 'admin')

/** Читать чужие диски: аудит (`drive.read`) или `admin`. */
export const canDriveReadAll = (actor: DriveActor): boolean =>
  isDriveAdmin(actor) || hasPermission(actor, 'drive.read')

/** Править чужие узлы: модерация (`drive.write`) или `admin`. */
export const canDriveWriteAll = (actor: DriveActor): boolean =>
  isDriveAdmin(actor) || hasPermission(actor, 'drive.write')

/** Выдавать доступ и отзывать его на чужих узлах: `drive.share` или `admin`. */
export const canDriveShareAll = (actor: DriveActor): boolean =>
  isDriveAdmin(actor) || hasPermission(actor, 'drive.share')

/** Права по владельцу строки и роли из `drive_share` (`null` — доступа нет). */
export function driveCaps(
  actor: DriveActor,
  ownerId: string,
  role: DriveShareRole | null,
): DriveCapabilities {
  if (ownerId === actor.id) return { canRead: true, canWrite: true, canShare: true }
  const readAll = canDriveReadAll(actor)
  const writeAll = canDriveWriteAll(actor)
  const shareAll = canDriveShareAll(actor)
  return {
    canRead: readAll || writeAll || shareAll || role !== null,
    canWrite: writeAll || role === 'editor',
    canShare: shareAll,
  }
}

/** Права на собственный корень: владелец может всё. */
export function driveRootCaps(actor: DriveActor): DriveCapabilities {
  return { canRead: true, canWrite: true, canShare: true }
}

const dateOf = (value: unknown): Date =>
  value instanceof Date ? value : new Date(typeof value === 'string' ? value : 0)

const numberOrZero = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Строка БД → доменный вид узла. Служебные колонки наружу не попадают. */
export function toDriveNodeView(row: Record<string, unknown>): DriveNodeView {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    parentId: (row.parent_id as string | null) ?? null,
    kind: row.kind === 'folder' ? 'folder' : 'file',
    name: String(row.name ?? ''),
    fileId: (row.file_id as string | null) ?? null,
    size: numberOrZero(row.size),
    contentType: (row.content_type as string | null) ?? null,
    hash: (row.hash as string | null) ?? null,
    starred: row.starred === true,
    trashedAt: row.trashed_at == null ? null : dateOf(row.trashed_at),
    trashedFrom: (row.trashed_from as string | null) ?? null,
    createdAt: dateOf(row.created_at),
    updatedAt: dateOf(row.updated_at),
  }
}

const missing = (error: unknown): boolean => {
  const kind = normalizeFailure(error).kind
  return kind === 'not_found' || kind === 'forbidden' || kind === 'validation'
}

/** Узел по id без проверки прав: `null`, если строки нет. */
export async function loadDriveNode(db: Database, id: string): Promise<DriveNodeView | null> {
  if (!id) return null
  try {
    const row = await db.resource(driveNode).get(DRIVE_SERVER, id)
    return toDriveNodeView(row as unknown as Record<string, unknown>)
  } catch (error) {
    if (missing(error)) return null
    throw error
  }
}

/**
 * Предки узла: ближайший родитель → корень. Обход защищён от циклов и
 * ограничен `DRIVE_MAX_DEPTH`; битая строка обрывает цепочку, а не запрос.
 */
export async function driveAncestors(
  db: Database,
  node: Pick<DriveNodeView, 'id' | 'parentId'>,
): Promise<DriveNodeView[]> {
  const out: DriveNodeView[] = []
  const seen = new Set<string>([node.id])
  let parentId = node.parentId
  while (parentId && out.length < DRIVE_MAX_DEPTH && !seen.has(parentId)) {
    const parent = await loadDriveNode(db, parentId)
    if (!parent) break
    seen.add(parent.id)
    out.push(parent)
    parentId = parent.parentId
  }
  return out
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

const ROLE_RANK: Record<DriveShareRole, number> = { viewer: 1, editor: 2 }

/** Строки доступа к перечисленным узлам для одного аккаунта. */
export async function driveSharesFor(
  db: Database,
  uid: string,
  nodeIds: readonly string[],
): Promise<DriveShareView[]> {
  if (!uid || nodeIds.length === 0) return []
  const chunkSize = Math.max(1, db.limits.inValues)
  const out: DriveShareView[] = []
  for (const part of chunks(nodeIds, chunkSize)) {
    const filter: Filter = {
      and: [
        { field: 'node_id', op: 'in', value: part },
        { field: 'uid', op: 'eq', value: uid },
      ],
    }
    const rows = await db.resource(driveShare).select(DRIVE_SERVER, { filter })
    for (const row of rows as unknown as Record<string, unknown>[]) {
      out.push({
        id: String(row.id),
        nodeId: String(row.node_id),
        uid: String(row.uid),
        role: row.role === 'editor' ? 'editor' : 'viewer',
        createdAt: dateOf(row.created_at),
      })
    }
  }
  return out
}

/** Самая сильная роль на узел с учётом предков. */
async function effectiveRole(
  db: Database,
  actor: DriveActor,
  node: DriveNodeView,
): Promise<DriveShareRole | null> {
  const ancestors = await driveAncestors(db, node)
  const shares = await driveSharesFor(db, actor.id, [node.id, ...ancestors.map((a) => a.id)])
  let role: DriveShareRole | null = null
  for (const share of shares) {
    if (role === null || ROLE_RANK[share.role] > ROLE_RANK[role]) role = share.role
  }
  return role
}

/**
 * Доступ к узлу или `null`, если читать его нельзя. «Нет узла» и «нет права»
 * снаружи неразличимы: иначе перебором id можно было бы узнать чужие имена.
 */
export async function resolveDriveAccess(
  db: Database,
  actor: DriveActor,
  nodeId: string,
): Promise<DriveAccess | null> {
  const node = await loadDriveNode(db, nodeId)
  if (!node) return null
  const role = node.ownerId === actor.id ? null : await effectiveRole(db, actor, node)
  const caps = driveCaps(actor, node.ownerId, role)
  if (!caps.canRead) return null
  return { node, caps, role }
}

/** Крошки «корень → узел»; имена читаются только у доступного узла. */
export async function driveCrumbPath(
  db: Database,
  node: DriveNodeView,
): Promise<DriveBreadcrumb[]> {
  const ancestors = await driveAncestors(db, node)
  const chain: DriveBreadcrumb[] = [
    ...ancestors.reverse().map((item) => ({ id: item.id, name: item.name })),
    { id: node.id, name: node.name },
  ]
  return driveBreadcrumbs(chain)
}

/** Все выданные доступы узла — для формы доступа (её показывает владелец). */
export async function listDriveShares(db: Database, nodeId: string): Promise<DriveShareView[]> {
  const rows = await db.resource(driveShare).select(DRIVE_SERVER, {
    filter: { field: 'node_id', op: 'eq', value: nodeId },
    order: [['created_at', 'asc']],
  })
  return (rows as unknown as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    nodeId: String(row.node_id),
    uid: String(row.uid),
    role: row.role === 'editor' ? 'editor' : 'viewer',
    createdAt: dateOf(row.created_at),
  }))
}
