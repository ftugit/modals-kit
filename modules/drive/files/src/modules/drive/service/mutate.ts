/**
 * Мутации «Диска» (`plan-drive.md` §4.4): папки, переименование, перенос,
 * копия, корзина, восстановление, окончательная очистка, звёздочка и доступ.
 *
 * Все проверки и записи одной операции идут в одной транзакции. Байты не
 * трогаются, кроме `purge`: копия узла ссылается на те же `file_id`, а
 * очистка удаляет объект только когда на него больше не ссылается ни один
 * живой или удалённый узел.
 */
import {
  checkDriveName,
  checkQuota,
  collectSubtreeIds,
  DEFAULT_DRIVE_QUOTA_BYTES,
  restorePlan,
  type DriveCapabilities,
  type DriveNodeView,
} from '#core/lib/drive/index.js'
import type { Database } from '#core/lib/db/index.js'
import { checkDriveMove, checkShareRole } from '../checks.js'
import { driveNode, driveShare } from '../schema.js'
import type { DriveActor, DriveResult, DriveShareView } from '../types.js'
import {
  driveRootCaps,
  listDriveShares,
  loadDriveNode,
  resolveDriveAccess,
  toDriveNodeView,
  DRIVE_SERVER,
} from './access.js'
import { readDriveRows } from './paging.js'
import { driveFail, driveOk } from './result.js'
import { driveUsedBytes } from './query.js'

/** Порт байтового слоя для `purge`: сервис не знает, откуда хранилище. */
export interface DriveBytesPort {
  del(path: string): Promise<boolean>
}

/**
 * Все узлы владельца (живые и удалённые). Обход полный: тихое усечение
 * ломало поддеревья и итоги квоты, поэтому потолок вынесен в `paging.ts`
 * и превышение — явный отказ `drive.traversal-limit`.
 */
async function allOwnerNodes(db: Database, ownerId: string): Promise<DriveNodeView[]> {
  return readDriveRows(db, { field: 'owner_id', op: 'eq', value: ownerId })
}

/**
 * Замок владельца на мутацию: имена, квота и вставки одного диска идут
 * последовательно. Без него проверка «имя свободно» и вставка расходятся
 * под конкуренцией.
 */
export async function lockDriveOwner(db: Database, ownerId: string): Promise<void> {
  await db.query({
    text: 'SELECT pg_advisory_xact_lock(hashtext($1))',
    values: [`modals-kit:drive-owner:${ownerId}`],
  })
}

interface FolderTarget {
  readonly ownerId: string
  readonly folder: DriveNodeView | null
  readonly caps: DriveCapabilities
}

export async function writableFolder(
  db: Database,
  actor: DriveActor,
  folderId: string | null | undefined,
): Promise<DriveResult<FolderTarget>> {
  const id = folderId?.trim() || null
  if (!id) return driveOk({ ownerId: actor.id, folder: null, caps: driveRootCaps(actor) })
  const access = await resolveDriveAccess(db, actor, id)
  if (!access) return driveFail('drive.not-found')
  if (access.node.kind !== 'folder') return driveFail('drive.not-folder')
  if (!access.caps.canWrite) return driveFail('drive.forbidden')
  // Папка назначения в корзине не принимает ни файлов, ни папок: иначе узел
  // «оживает» внутри поддерева, которого в живом списке нет.
  if (access.node.trashedAt !== null) return driveFail('drive.parent-trashed')
  return driveOk({ ownerId: access.node.ownerId, folder: access.node, caps: access.caps })
}

/** Дети папки без корзины: ими проверяется занятость имени. */
export async function liveSiblings(
  db: Database,
  ownerId: string,
  parentId: string | null,
): Promise<DriveNodeView[]> {
  return readDriveRows(db, {
    and: [
      { field: 'owner_id', op: 'eq', value: ownerId },
      parentId
        ? { field: 'parent_id', op: 'eq', value: parentId }
        : { field: 'parent_id', op: 'isNull' },
      { field: 'trashed_at', op: 'isNull' },
    ],
  })
}

const nameTaken = async (
  db: Database,
  ownerId: string,
  parentId: string | null,
  name: string,
  exceptId?: string,
): Promise<boolean> => {
  const key = name.toLowerCase()
  return (await liveSiblings(db, ownerId, parentId)).some(
    (item) => item.id !== exceptId && item.name.toLowerCase() === key,
  )
}

function nameProblem(name: string): string | null {
  const problem = checkDriveName(name)
  return problem ? `drive.name-${problem}` : null
}

interface NewNode {
  readonly ownerId: string
  readonly parentId: string | null
  readonly kind: 'folder' | 'file'
  readonly name: string
  readonly fileId?: string | null
  readonly size?: number
  readonly contentType?: string | null
  readonly hash?: string | null
}

export async function insertNode(db: Database, input: NewNode): Promise<DriveNodeView> {
  const id = crypto.randomUUID()
  const row = await db.resource(driveNode).without(['protect'], (api) =>
    api.insert(DRIVE_SERVER, {
      id,
      owner_id: input.ownerId,
      parent_id: input.parentId,
      kind: input.kind,
      name: input.name,
      file_id: input.fileId ?? null,
      size: String(input.size ?? 0),
      content_type: input.contentType ?? null,
      hash: input.hash ?? null,
    }),
  )
  return toDriveNodeView(row as unknown as Record<string, unknown>)
}

/** Создать папку. */
export async function createDriveFolder(
  db: Database,
  actor: DriveActor,
  input: { parentId?: string | null; name: string },
): Promise<DriveResult<DriveNodeView>> {
  return db.transaction(async (tx) => {
    const target = await writableFolder(tx, actor, input.parentId)
    if (!target.ok) return driveFail(target.code)
    const problem = nameProblem(input.name)
    if (problem) return driveFail(problem)
    await lockDriveOwner(tx, target.value.ownerId)
    if (await nameTaken(tx, target.value.ownerId, target.value.folder?.id ?? null, input.name))
      return driveFail('drive.name-taken')
    const node = await insertNode(tx, {
      ownerId: target.value.ownerId,
      parentId: target.value.folder?.id ?? null,
      kind: 'folder',
      name: input.name.trim(),
    })
    return driveOk(node)
  })
}

/** Переименовать узел в его папке. */
export async function renameDriveNode(
  db: Database,
  actor: DriveActor,
  input: { nodeId: string; name: string },
): Promise<DriveResult<DriveNodeView>> {
  return db.transaction(async (tx) => {
    const access = await resolveDriveAccess(tx, actor, input.nodeId)
    if (!access) return driveFail('drive.not-found')
    if (!access.caps.canWrite) return driveFail('drive.forbidden')
    const problem = nameProblem(input.name)
    if (problem) return driveFail(problem)
    await lockDriveOwner(tx, access.node.ownerId)
    if (await nameTaken(tx, access.node.ownerId, access.node.parentId, input.name, access.node.id))
      return driveFail('drive.name-taken')
    const row = await tx.resource(driveNode).update(DRIVE_SERVER, access.node.id, {
      name: input.name.trim(),
    })
    return driveOk(toDriveNodeView(row as unknown as Record<string, unknown>))
  })
}

/** Перенести узел в другую папку (или в корень). */
export async function moveDriveNode(
  db: Database,
  actor: DriveActor,
  input: { nodeId: string; targetId?: string | null },
): Promise<DriveResult<DriveNodeView>> {
  return db.transaction(async (tx) => {
    const access = await resolveDriveAccess(tx, actor, input.nodeId)
    if (!access) return driveFail('drive.not-found')
    if (!access.caps.canWrite) return driveFail('drive.forbidden')
    const node = access.node
    const target = await writableFolder(tx, actor, input.targetId)
    if (!target.ok) return driveFail(target.code)
    if (target.value.ownerId !== node.ownerId) return driveFail('drive.move-foreign-owner')

    await lockDriveOwner(tx, node.ownerId)
    const nodes = await allOwnerNodes(tx, node.ownerId)
    const subtree = collectSubtreeIds(nodes, node.id)
    if (target.value.folder) {
      const problem = checkDriveMove(node, target.value.folder, subtree)
      // `not-folder` уже отсечён `writableFolder`, остальные коды — доменные.
      if (problem) return driveFail(problem)
    } else if (node.parentId === null) {
      return driveOk(node)
    }
    if (await nameTaken(tx, node.ownerId, target.value.folder?.id ?? null, node.name, node.id))
      return driveFail('drive.name-taken')
    const row = await tx.resource(driveNode).update(DRIVE_SERVER, node.id, {
      parent_id: target.value.folder?.id ?? null,
    })
    return driveOk(toDriveNodeView(row as unknown as Record<string, unknown>))
  })
}

/** Скопировать узел и всё поддерево в папку. Файлы делят байты (`file_id`). */
export async function copyDriveNode(
  db: Database,
  actor: DriveActor,
  input: { nodeId: string; targetId?: string | null; name?: string; quotaLimit?: number },
): Promise<DriveResult<DriveNodeView>> {
  return db.transaction(async (tx) => {
    const access = await resolveDriveAccess(tx, actor, input.nodeId)
    if (!access) return driveFail('drive.not-found')
    const source = access.node
    const target = await writableFolder(tx, actor, input.targetId)
    if (!target.ok) return driveFail(target.code)
    if (target.value.ownerId !== source.ownerId) return driveFail('drive.parent-foreign')
    const name = (input.name ?? source.name).trim()
    const problem = nameProblem(name)
    if (problem) return driveFail(problem)
    await lockDriveOwner(tx, source.ownerId)
    if (await nameTaken(tx, source.ownerId, target.value.folder?.id ?? null, name))
      return driveFail('drive.name-taken')

    const nodes = await allOwnerNodes(tx, source.ownerId)
    const ids = collectSubtreeIds(nodes, source.id)
    // Копия занимает место логически, хотя байты и общие: квота — это сумма
    // размеров живых файлов, а не физический ledger хранилища.
    const copyBytes = nodes
      .filter((node) => ids.includes(node.id) && node.kind === 'file')
      .reduce((sum, node) => sum + node.size, 0)
    const used = await driveUsedBytes(tx, source.ownerId)
    const limit = quotaLimitOf(input.quotaLimit)
    if (checkQuota(used, copyBytes, limit)) return driveFail('drive.quota-over')
    const byId = new Map(nodes.map((node) => [node.id, node]))
    // Порядок обхода — от корня к детям: у копии уже есть родитель.
    const copies = new Map<string, DriveNodeView>()
    for (const id of ids) {
      const node = byId.get(id)
      if (!node) continue
      const parentId = id === source.id ? (target.value.folder?.id ?? null) : copies.get(node.parentId ?? '')?.id
      if (id !== source.id && !parentId) continue
      const copy = await insertNode(tx, {
        ownerId: node.ownerId,
        parentId: parentId ?? null,
        kind: node.kind,
        name: id === source.id ? name : node.name,
        fileId: node.fileId,
        size: node.size,
        contentType: node.contentType,
        hash: node.hash,
      })
      copies.set(id, copy)
    }
    const rootCopy = copies.get(source.id)
    return rootCopy ? driveOk(rootCopy) : driveFail('drive.not-found')
  })
}

/** Мягко удалить узел и всё поддерево; `trashed_from` хранит только корень. */
export async function trashDriveNode(
  db: Database,
  actor: DriveActor,
  input: { nodeId: string },
): Promise<DriveResult<DriveNodeView[]>> {
  return db.transaction(async (tx) => {
    const access = await resolveDriveAccess(tx, actor, input.nodeId)
    if (!access) return driveFail('drive.not-found')
    if (!access.caps.canWrite) return driveFail('drive.forbidden')
    if (access.node.trashedAt !== null) return driveFail('drive.trashed')
    const nodes = await allOwnerNodes(tx, access.node.ownerId)
    const ids = collectSubtreeIds(nodes, access.node.id)
    const now = new Date().toISOString()
    const out: DriveNodeView[] = []
    for (const id of ids) {
      const row = await tx.resource(driveNode).update(DRIVE_SERVER, id, {
        trashed_at: now,
        ...(id === access.node.id ? { trashed_from: access.node.parentId } : {}),
      })
      out.push(toDriveNodeView(row as unknown as Record<string, unknown>))
    }
    return driveOk(out)
  })
}

/** Вернуть узел из корзины вместе с поддеревом. */
export async function restoreDriveNode(
  db: Database,
  actor: DriveActor,
  input: { nodeId: string },
): Promise<DriveResult<DriveNodeView>> {
  return db.transaction(async (tx) => {
    const access = await resolveDriveAccess(tx, actor, input.nodeId)
    if (!access) return driveFail('drive.not-found')
    if (!access.caps.canWrite) return driveFail('drive.forbidden')
    const node = access.node
    if (node.trashedAt === null) return driveOk(node)
    const previous = node.trashedFrom ? await loadDriveNode(tx, node.trashedFrom) : null
    const parentLive =
      previous !== null && previous.trashedAt === null && previous.kind === 'folder'
        ? previous
        : null
    const { parentId } = restorePlan(node, parentLive !== null)
    if (await nameTaken(tx, node.ownerId, parentId, node.name, node.id))
      return driveFail('drive.name-taken')

    await lockDriveOwner(tx, node.ownerId)
    const nodes = await allOwnerNodes(tx, node.ownerId)
    const ids = collectSubtreeIds(nodes, node.id)
    // Возврат из корзины снова делает файлы живыми — место должно быть.
    const restoreBytes = nodes
      .filter((item) => ids.includes(item.id) && item.kind === 'file')
      .reduce((sum, item) => sum + item.size, 0)
    const used = await driveUsedBytes(tx, node.ownerId)
    if (checkQuota(used, restoreBytes, quotaLimitOf(undefined))) return driveFail('drive.quota-over')
    let restored = node
    for (const id of ids) {
      const row = await tx.resource(driveNode).update(DRIVE_SERVER, id, {
        trashed_at: null,
        ...(id === node.id ? { parent_id: parentId, trashed_from: null } : {}),
      })
      if (id === node.id) restored = toDriveNodeView(row as unknown as Record<string, unknown>)
    }
    return driveOk(restored)
  })
}

/**
 * Окончательно удалить узел и поддерево. Объекты байтов удаляются только те,
 * на которые больше не ссылается ни один узел: копия делить `file_id` умеет.
 */
export async function purgeDriveNode(
  db: Database,
  actor: DriveActor,
  input: { nodeId: string },
  bytes?: DriveBytesPort | null,
): Promise<DriveResult<{ deleted: number; freed: number }>> {
  const freedPaths: string[] = []
  const result = await db.transaction(async (tx) => {
    const access = await resolveDriveAccess(tx, actor, input.nodeId)
    if (!access) return driveFail('drive.not-found')
    if (!access.caps.canWrite) return driveFail('drive.forbidden')
    if (access.node.trashedAt === null) return driveFail('drive.not-trashed')
    const nodes = await allOwnerNodes(tx, access.node.ownerId)
    const ids = collectSubtreeIds(nodes, access.node.id)
    const byId = new Map(nodes.map((node) => [node.id, node]))
    const fileIds = new Set<string>()
    for (const id of ids) {
      const node = byId.get(id)
      if (node?.fileId) fileIds.add(node.fileId)
      await tx.resource(driveNode).delete(DRIVE_SERVER, id, { hard: true })
    }
    for (const fileId of fileIds) {
      const rest = await tx.resource(driveNode).count(DRIVE_SERVER, {
        filter: { field: 'file_id', op: 'eq', value: fileId },
      })
      if (rest === 0) freedPaths.push(fileId)
    }
    return driveOk({ deleted: ids.length, freed: freedPaths.length })
  })
  if (!result.ok) return result
  // Байты — после коммита: неудачное удаление не откатывает уже удалённые строки.
  if (bytes) for (const path of freedPaths) await bytes.del(path).catch(() => false)
  return driveOk({ deleted: result.value.deleted, freed: result.value.freed })
}

/** Поставить или снять звёздочку. */
export async function starDriveNode(
  db: Database,
  actor: DriveActor,
  input: { nodeId: string; starred: boolean },
): Promise<DriveResult<DriveNodeView>> {
  return db.transaction(async (tx) => {
    const access = await resolveDriveAccess(tx, actor, input.nodeId)
    if (!access) return driveFail('drive.not-found')
    if (!access.caps.canWrite) return driveFail('drive.forbidden')
    const row = await tx.resource(driveNode).update(DRIVE_SERVER, access.node.id, {
      starred: input.starred === true,
    })
    return driveOk(toDriveNodeView(row as unknown as Record<string, unknown>))
  })
}

function quotaLimitOf(value?: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, value)
    : DEFAULT_DRIVE_QUOTA_BYTES
}

const toShareView = (row: Record<string, unknown>): DriveShareView => ({
  id: String(row.id),
  nodeId: String(row.node_id),
  uid: String(row.uid),
  label: String(row.uid),
  role: row.role === 'editor' ? 'editor' : 'viewer',
  createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at ?? 0)),
})

/** Нормализация набора получателей: trim, пустые отброшены, дубликаты слиты. */
export function driveShareUids(raw: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const value = typeof item === 'string' ? item.trim() : ''
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

/** Существование получателей проверяется в одной выборке до записи. */
async function liveAccountIds(db: Database, uids: readonly string[]): Promise<Set<string>> {
  if (uids.length === 0) return new Set()
  const { rows } = await db.query<{ id: string }>({
    text: `SELECT id::text AS id FROM public.user_auth
           WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
    values: [uids],
  })
  return new Set(rows.map((row) => row.id))
}

/** Выдать доступ набору получателей одной транзакцией; любой отказ откатывает всё. */
export async function shareDriveNodeMany(
  db: Database,
  actor: DriveActor,
  input: { nodeId: string; uids: readonly string[]; role: string },
): Promise<DriveResult<DriveShareView[]>> {
  const uids = driveShareUids(input.uids)
  return db.transaction(async (tx) => {
    const access = await resolveDriveAccess(tx, actor, input.nodeId)
    if (!access) return driveFail('drive.not-found')
    if (!access.caps.canShare) return driveFail('drive.forbidden')
    if (uids.length === 0) return driveFail('drive.share-target-missing', { uid: '' })
    if (uids.includes(access.node.ownerId)) return driveFail('drive.share-self')
    const roleProblem = checkShareRole(input.role)
    if (roleProblem) return driveFail(roleProblem)

    const existing = await liveAccountIds(tx, uids)
    for (const uid of uids) {
      if (!existing.has(uid)) return driveFail('drive.share-target-missing', { uid })
    }

    const role = input.role === 'editor' ? 'editor' : 'viewer'
    const views: DriveShareView[] = []
    for (const uid of uids) {
      const rows = (await tx.resource(driveShare).select(DRIVE_SERVER, {
        filter: {
          and: [
            { field: 'node_id', op: 'eq', value: access.node.id },
            { field: 'uid', op: 'eq', value: uid },
          ],
        },
      })) as unknown as Record<string, unknown>[]
      const row = rows[0]
        ? await tx.resource(driveShare).update(DRIVE_SERVER, String(rows[0].id), { role })
        : await tx.resource(driveShare).insert(DRIVE_SERVER, {
            node_id: access.node.id,
            uid,
            role,
          })
      views.push(toShareView(row as unknown as Record<string, unknown>))
    }
    return driveOk(views)
  })
}

/** Выдать доступ или изменить роль уже выданного (один получатель). */
export async function shareDriveNode(
  db: Database,
  actor: DriveActor,
  input: { nodeId: string; uid: string; role: string },
): Promise<DriveResult<DriveShareView>> {
  const result = await shareDriveNodeMany(db, actor, {
    nodeId: input.nodeId,
    uids: [input.uid],
    role: input.role,
  })
  if (!result.ok) return driveFail(result.code, result.params)
  const first = result.value[0]
  return first ? driveOk(first) : driveFail('drive.share-target-missing', { uid: input.uid })
}

/** Отозвать доступ аккаунта к узлу. */
export async function unshareDriveNode(
  db: Database,
  actor: DriveActor,
  input: { nodeId: string; uid: string },
): Promise<DriveResult<{ nodeId: string; uid: string }>> {
  return db.transaction(async (tx) => {
    const access = await resolveDriveAccess(tx, actor, input.nodeId)
    if (!access) return driveFail('drive.not-found')
    if (!access.caps.canShare) return driveFail('drive.forbidden')
    const rows = (await tx.resource(driveShare).select(DRIVE_SERVER, {
      filter: {
        and: [
          { field: 'node_id', op: 'eq', value: access.node.id },
          { field: 'uid', op: 'eq', value: input.uid },
        ],
      },
    })) as unknown as Record<string, unknown>[]
    const row = rows[0]
    if (!row) return driveFail('drive.share-missing')
    await tx.resource(driveShare).delete(DRIVE_SERVER, String(row.id))
    return driveOk({ nodeId: access.node.id, uid: input.uid })
  })
}

/** Список доступов узла для формы (только тому, кто может делиться). */
export async function readDriveShares(
  db: Database,
  actor: DriveActor,
  nodeId: string,
): Promise<DriveResult<{ caps: DriveCapabilities; shares: readonly DriveShareView[] }>> {
  const access = await resolveDriveAccess(db, actor, nodeId)
  if (!access) return driveFail('drive.not-found')
  if (!access.caps.canShare) return driveFail('drive.forbidden')
  return driveOk({ caps: access.caps, shares: await listDriveShares(db, nodeId) })
}

/** Пересчёт размера узла после перезаписи байтов (используется `upload`). */
export async function updateDriveFileContent(
  db: Database,
  nodeId: string,
  patch: { size: number; contentType?: string | null; hash?: string | null },
): Promise<DriveNodeView> {
  const row = await db.resource(driveNode).update(DRIVE_SERVER, nodeId, {
    size: String(patch.size),
    content_type: patch.contentType ?? null,
    hash: patch.hash ?? null,
  })
  return toDriveNodeView(row as unknown as Record<string, unknown>)
}
