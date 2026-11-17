/**
 * Загрузка байтов «Диска» (`plan-drive.md` §4.5).
 *
 * Порядок важен: сначала `storage.put` с `hash: true` (дедупликация на уровне
 * реестра хранилища), потом запись узла в транзакции. Квота пользователя
 * проверяется в той же транзакции под advisory-замком владельца: `storage.put`
 * резервирует место сервера, а это другой лимит, и без проверки один
 * пользователь мог бы занять весь пул, не превысив `DRIVE_QUOTA_BYTES`.
 */
import {
  checkDriveName,
  checkQuota,
  DEFAULT_DRIVE_QUOTA_BYTES,
  driveStoragePath,
  normalizeDriveName,
  type DriveNodeView,
} from '#core/lib/drive/index.js'
import type { Database } from '#core/lib/db/index.js'
import type { StoragePutBody } from '#core/lib/storage/index.js'
import { driveNode } from '../schema.js'
import type { DriveActor, DriveResult } from '../types.js'
import { toDriveNodeView, DRIVE_SERVER } from './access.js'
import { liveSiblings, writableFolder } from './mutate.js'
import { driveFail, driveOk } from './result.js'
import { driveUsedBytes } from './query.js'

/** Минимальный порт хранилища: сервис не знает, S3 там, WebDAV или папка. */
export interface DriveUploadStorage {
  put(input: {
    path: string
    body: StoragePutBody
    size: number
    contentType?: string
    hash?: boolean
  }): Promise<{ hash?: string | null }>
  del(path: string): Promise<boolean>
}

export interface DriveUploadInput {
  parentId?: string | null
  name: string
  body: StoragePutBody
  size: number
  contentType?: string | null
  /** Заменить одноимённый файл (WebDAV `PUT` и «загрузить заново»). */
  overwrite?: boolean
}

export interface DriveUploadDeps {
  storage: DriveUploadStorage | null
  quotaLimit?: number
}

function contentTypeOf(value?: string | null): string {
  const text = typeof value === 'string' ? value.trim() : ''
  return text && text.length <= 255 ? text : 'application/octet-stream'
}

/**
 * Загрузить файл в папку. `overwrite` заменяет байты одноимённого живого файла,
 * иначе занятое имя — `drive.name-taken`.
 */
export async function uploadDriveFile(
  db: Database,
  actor: DriveActor,
  input: DriveUploadInput,
  deps: DriveUploadDeps,
): Promise<DriveResult<DriveNodeView>> {
  if (!deps.storage) return driveFail('drive.storage-unavailable')
  if (!Number.isFinite(input.size) || input.size <= 0) return driveFail('drive.upload-empty')
  const nameProblem = checkDriveName(input.name)
  if (nameProblem) return driveFail(`drive.name-${nameProblem}`)
  const name = normalizeDriveName(input.name)

  const target = await writableFolder(db, actor, input.parentId)
  if (!target.ok) return driveFail(target.code)
  const siblings = await liveSiblings(db, target.value.ownerId, target.value.folder?.id ?? null)
  const existing = siblings.find((node) => node.name.toLowerCase() === name.toLowerCase())
  if (existing && existing.kind !== 'file') return driveFail('drive.name-taken')
  if (existing && !input.overwrite) return driveFail('drive.name-taken')

  const nodeId = existing?.id ?? crypto.randomUUID()
  const path = existing?.fileId ?? driveStoragePath(target.value.ownerId, nodeId)
  const contentType = contentTypeOf(input.contentType)

  const stored = await deps.storage
    .put({ path, body: input.body, size: input.size, contentType, hash: true })
    .catch(() => null)
  if (!stored) return driveFail('drive.storage-unavailable')

  const limit =
    typeof deps.quotaLimit === 'number' && Number.isFinite(deps.quotaLimit)
      ? Math.max(0, deps.quotaLimit)
      : DEFAULT_DRIVE_QUOTA_BYTES
  const used = await driveUsedBytes(db, target.value.ownerId)
  // При перезаписи старый размер освобождается: квота считает итог, а не сумму.
  const base = Math.max(0, used - (existing?.size ?? 0))
  if (checkQuota(base, input.size, limit)) {
    if (!existing) await deps.storage.del(path).catch(() => false)
    return driveFail('drive.quota-over')
  }

  const result = await db.transaction(async (tx) => {
    // Замок владельца: две параллельные загрузки не должны вместе переехать квоту.
    await tx.query({
      text: 'SELECT pg_advisory_xact_lock(hashtext($1))',
      values: [`modals-kit:drive-quota:${target.value.ownerId}`],
    })
    const nowUsed = await driveUsedBytes(tx, target.value.ownerId)
    const nowBase = Math.max(0, nowUsed - (existing?.size ?? 0))
    if (checkQuota(nowBase, input.size, limit)) return driveFail('drive.quota-over')

    if (existing) {
      const row = await tx.resource(driveNode).update(DRIVE_SERVER, existing.id, {
        size: String(input.size),
        content_type: contentType,
        hash: stored.hash ?? null,
      })
      return driveOk(toDriveNodeView(row as unknown as Record<string, unknown>))
    }
    const row = await tx.resource(driveNode).without(['protect'], (api) =>
      api.insert(DRIVE_SERVER, {
        id: nodeId,
        owner_id: target.value.ownerId,
        parent_id: target.value.folder?.id ?? null,
        kind: 'file',
        name,
        file_id: path,
        size: String(input.size),
        content_type: contentType,
        hash: stored.hash ?? null,
      }),
    )
    return driveOk(toDriveNodeView(row as unknown as Record<string, unknown>))
  })

  // Узел не записался (имя заняли параллельно) — свои байты убираем.
  if (!result.ok && !existing) await deps.storage.del(path).catch(() => false)
  return result
}
