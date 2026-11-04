// Серверная точка апгрейда `GET /api/form-upload` → `WebSocket` для потоковых форм с файлами.
import { WS_UPLOAD_CHUNK_SIZE, WS_UPLOAD_MAX_DURATION, WS_UPLOAD_TTL_SECONDS, WS_UPLOAD_IDLE_SECONDS, WS_UPLOAD_RATE_BUDGET_BYTES_PER_SECOND, WS_UPLOAD_PAUSE_MAX_SECONDS } from '$app/env/private'
import type { RequestHandler } from './$types'
import { DEFAULT_LIMITS } from '#lib/form/server.js'
import { originGuard } from '#server/form-security.server.js'
import { detectWsUploadPlatform, upgradeWs } from '#server/ws-upgrade.server.js'
import {
  clampWsChunkBytes,
  computeWsMaxPayloadBytes,
} from '#hooks/component-form/ws-protocol.js'
import { handleFormUploadWs } from '#hooks/component-form/ws-session.server.js'
import { DEFAULT_UPLOAD_IDLE_MS, DEFAULT_UPLOAD_TTL_MS, validateUploadConfiguration } from '#hooks/component-form/ws-lifetime.server.js'

validateUploadConfiguration((WS_UPLOAD_TTL_SECONDS ?? DEFAULT_UPLOAD_TTL_MS / 1000) * 1000, (WS_UPLOAD_IDLE_SECONDS ?? DEFAULT_UPLOAD_IDLE_MS / 1000) * 1000, WS_UPLOAD_MAX_DURATION == null ? null : WS_UPLOAD_MAX_DURATION * 1000)

export const GET: RequestHandler = async (event) => {
  // Account for time spent checking the request before the upgrade.
  const requestStartedMs = performance.now()
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
        ttlMs: WS_UPLOAD_TTL_SECONDS === undefined ? undefined : WS_UPLOAD_TTL_SECONDS * 1000,
        preInitTimeoutMs: WS_UPLOAD_IDLE_SECONDS === undefined ? undefined : WS_UPLOAD_IDLE_SECONDS * 1000,
        dataIdleTimeoutMs: WS_UPLOAD_IDLE_SECONDS === undefined ? undefined : WS_UPLOAD_IDLE_SECONDS * 1000,
        rateBudgetBytesPerSecond: WS_UPLOAD_RATE_BUDGET_BYTES_PER_SECOND,
        pauseMaxMs: WS_UPLOAD_PAUSE_MAX_SECONDS === undefined ? undefined : WS_UPLOAD_PAUSE_MAX_SECONDS * 1000,
        requestStartedMs,
      }),
    { maxPayload: computeWsMaxPayloadBytes(chunkBytes) },
  )
}
