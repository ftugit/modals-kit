/**
 * Загрузка байтов «Диска» (`plan-drive-repair.md` §3.1).
 *
 * Порядок важен: ранняя проверка доступа и квоты — до чтения байтов, запись
 * байтов — вне транзакции БД, а публикация ссылки — в короткой транзакции под
 * замком владельца. Перезапись копии, делящей `file_id` с соседом, пишется в
 * новый путь (copy-on-write): иначе загрузка меняла бы байты чужой копии.
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
import { DRIVE_SERVER, toDriveNodeView } from './access.js'
import { liveSiblings, lockDriveOwner, writableFolder } from './mutate.js'
import { driveFail, driveOk } from './result.js'
import { driveUsedBytes } from './query.js'

/** Предел одного файла «Диска»: бюджет формы совпадает с этим числом. */
export const DRIVE_UPLOAD_MAX_BYTES = 64 * 1024 * 1024

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

function quotaLimitOf(value?: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, value)
    : DEFAULT_DRIVE_QUOTA_BYTES
}

/** Сколько узлов ссылается на одни и те же байты (копия делит `file_id`). */
async function referenceCount(db: Database, fileId: string): Promise<number> {
  return db.resource(driveNode).count(DRIVE_SERVER, {
    filter: { field: 'file_id', op: 'eq', value: fileId },
  })
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
  if (input.size > DRIVE_UPLOAD_MAX_BYTES) return driveFail('drive.upload-too-large')
  const nameProblem = checkDriveName(input.name)
  if (nameProblem) return driveFail(`drive.name-${nameProblem}`)
  const name = normalizeDriveName(input.name)
  const limit = quotaLimitOf(deps.quotaLimit)

  // Ранний гейт доступа: не читаем и не публикуем байты зря.
  const target = await writableFolder(db, actor, input.parentId)
  if (!target.ok) return driveFail(target.code)
  const ownerId = target.value.ownerId
  const parentId = target.value.folder?.id ?? null

  const siblings = await liveSiblings(db, ownerId, parentId)
  const existing = siblings.find((node) => node.name.toLowerCase() === name.toLowerCase())
  if (existing && existing.kind !== 'file') return driveFail('drive.name-taken')
  if (existing && !input.overwrite) return driveFail('drive.name-taken')

  // Ранняя оценка квоты: заведомо лишнюю загрузку не начинаем. Окончательная
  // проверка повторится в транзакции под замком.
  const beforeUsed = await driveUsedBytes(db, ownerId)
  if (checkQuota(Math.max(0, beforeUsed - (existing?.size ?? 0)), input.size, limit))
    return driveFail('drive.quota-over')

  const nodeId = existing?.id ?? crypto.randomUUID()
  // Общие байты не трогаем: у копии свой путь с суффиксом версии.
  const shared = existing?.fileId ? await referenceCount(db, existing.fileId) : 0
  const path =
    existing?.fileId && shared <= 1
      ? existing.fileId
      : driveStoragePath(
          ownerId,
          existing?.id ? `${existing.id}-v${crypto.randomUUID().slice(0, 8)}` : nodeId,
        )
  const contentType = contentTypeOf(input.contentType)

  const stored = await deps.storage
    .put({ path, body: input.body, size: input.size, contentType, hash: true })
    .catch(() => null)
  if (!stored) return driveFail('drive.storage-unavailable')

  const result = await db.transaction(async (tx) => {
    await lockDriveOwner(tx, ownerId)
    // Право повторно проверяется внутри транзакции: папку могли убрать в
    // корзину или отозвать доступ, пока байты писались.
    const again = await writableFolder(tx, actor, input.parentId)
    if (!again.ok) return driveFail(again.code)
    if (again.value.ownerId !== ownerId) return driveFail('drive.conflict')

    const nowSiblings = await liveSiblings(tx, ownerId, parentId)
    const current = nowSiblings.find((node) => node.name.toLowerCase() === name.toLowerCase())
    if (current && current.kind !== 'file') return driveFail('drive.name-taken')
    // Конкурент успел занять имя (или создать файл) — не затираем его.
    if (current && current.id !== existing?.id && !input.overwrite) return driveFail('drive.conflict')

    const nowUsed = await driveUsedBytes(tx, ownerId)
    const base = Math.max(0, nowUsed - (current?.size ?? 0))
    if (checkQuota(base, input.size, limit)) return driveFail('drive.quota-over')

    if (current) {
      const row = await tx.resource(driveNode).update(DRIVE_SERVER, current.id, {
        size: String(input.size),
        content_type: contentType,
        hash: stored.hash ?? null,
        file_id: path,
      })
      return driveOk(toDriveNodeView(row as unknown as Record<string, unknown>))
    }
    const row = await tx.resource(driveNode).without(['protect'], (api) =>
      api.insert(DRIVE_SERVER, {
        id: nodeId,
        owner_id: ownerId,
        parent_id: parentId,
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

  // Узел не записался (имя заняли параллельно, квота, отзыв доступа) — свои
  // байты убираем. Старые байты не трогаем: путь перезаписи может быть тем же.
  if (!result.ok) {
    if (path !== existing?.fileId) await deps.storage.del(path).catch(() => false)
    return result
  }
  // Перезапись забрала новый путь: старый объект убираем только при нуле ссылок.
  if (existing?.fileId && path !== existing.fileId) {
    const rest = await referenceCount(db, existing.fileId).catch(() => 1)
    if (rest === 0) await deps.storage.del(existing.fileId).catch(() => false)
  }
  return result
}
