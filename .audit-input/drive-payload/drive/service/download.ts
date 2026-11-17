/**
 * Отдача файла «Диска» (`plan-drive.md` §4.4): проверка доступа → `serve`
 * байтового слоя. `Range`, `ETag` и `304` считает сам `serve` (тот же
 * `createFileResponse`, что у `/api/storage`), сервис добавляет только
 * `Content-Disposition` и запрет MIME-сниффинга.
 */
import type { Database } from '#core/lib/db/index.js'
import type { DriveActor, DriveResult } from '../types.js'
import { resolveDriveAccess } from './access.js'
import { driveFail, driveOk } from './result.js'

/** Порт раздачи: `Storage['serve']` без остального публичного интерфейса. */
export interface DriveServePort {
  serve(path: string, request: Request): Promise<Response>
}

/** Имя для заголовка: ASCII-запасное и RFC 5987 для юникода. */
export function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `attachment; filename="${ascii || 'file'}"; filename*=UTF-8''${encoded}`
}

/**
 * Ответ с байтами файла. `drive.not-found` — нет узла, нет права или у узла
 * нет байтов: снаружи это одно и то же.
 */
export async function serveDriveFile(
  db: Database,
  actor: DriveActor,
  nodeId: string,
  request: Request,
  deps: { storage: DriveServePort | null },
): Promise<DriveResult<Response>> {
  if (!deps.storage) return driveFail('drive.storage-unavailable')
  const access = await resolveDriveAccess(db, actor, nodeId)
  if (!access) return driveFail('drive.not-found')
  if (access.node.kind !== 'file') return driveFail('drive.not-file')
  const path = access.node.fileId
  if (!path) return driveFail('drive.not-found')

  const response = await deps.storage.serve(path, request)
  const headers = new Headers(response.headers)
  headers.set('x-content-type-options', 'nosniff')
  headers.set('content-security-policy', "default-src 'none'; sandbox")
  if (response.ok) headers.set('content-disposition', contentDisposition(access.node.name))
  return driveOk(
    new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    }),
  )
}
