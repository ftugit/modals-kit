// Серверная точка апгрейда `GET /api/form-upload` → `WebSocket` для потоковых форм с файлами.
import { WS_UPLOAD_CHUNK_SIZE, WS_UPLOAD_MAX_DURATION } from '$app/env/private'
import type { RequestHandler } from './$types'
import { DEFAULT_LIMITS } from '#lib/form/server.js'
import { originGuard } from '#server/form-security.server.js'
import { detectWsUploadPlatform, upgradeWs } from '#server/ws-upgrade.server.js'
import {
  clampWsChunkBytes,
  computeWsMaxPayloadBytes,
} from '#hooks/component-form/ws-protocol.js'
import { handleFormUploadWs } from '#hooks/component-form/ws-session.server.js'

export const GET: RequestHandler = async (event) => {
  // Проверяем доверенный Origin/Referer ещё ДО `101 Switching Protocols`
  const originRejection = await originGuard({
    request: event.request,
    description: undefined as never,
    limits: DEFAULT_LIMITS,
    reached: 'rejected',
    warnings: [],
  })
  if (originRejection) {
    return new Response('Forbidden origin', {
      status: originRejection.status,
      headers: { 'cache-control': 'no-store' },
    })
  }

  const chunkBytes = clampWsChunkBytes(WS_UPLOAD_CHUNK_SIZE)
  const platform = detectWsUploadPlatform()
  const maxDurationMs =
    typeof WS_UPLOAD_MAX_DURATION === 'number' ? WS_UPLOAD_MAX_DURATION * 1000 : undefined

  return upgradeWs(
    event,
    (socket) =>
      handleFormUploadWs(socket, event, {
        chunkBytes,
        platform,
        maxDurationMs,
      }),
    { maxPayload: computeWsMaxPayloadBytes(chunkBytes) },
  )
}
