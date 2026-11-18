// GET-раздача байтов «Диска» (`plan-drive-repair.md` §1.2).
// Скачивание не является mutation-формой: доступ проверяет `serveDriveFile`,
// путь берётся из сохранённого `fileId` узла (копии могут делить байты).
import type { RequestHandler } from './$types'
import { resolveAppStorage } from '#core/server/app-storage.server.js'
import { db } from '#core/server/db.server.js'
import { serveDriveFile } from '#modules/drive/service/download.js'
import { driveMessage } from '#modules/drive/messages.js'
import { driveOperationActor } from '#sections/drive/operations.server.js'

const errorResponse = (code: string, status: number): Response =>
  new Response(driveMessage(code), {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'private, no-store' },
  })

const serve: RequestHandler = async (event) => {
  const actor = await driveOperationActor(event)
  if (!actor) return errorResponse('drive.forbidden', 403)
  const { storage } = await resolveAppStorage()
  const result = await serveDriveFile(db, actor, event.params.nodeId, event.request, {
    storage: storage ? { serve: (path, request) => storage.serve(path, request) } : null,
  })
  if (!result.ok) {
    const status =
      result.code === 'drive.storage-unavailable' ? 503 : result.code === 'drive.not-file' ? 400 : 404
    return errorResponse(result.code, status)
  }
  event.setHeaders({ 'cache-control': 'private, no-store' })
  return result.value
}

export const GET = serve
export const HEAD = serve
