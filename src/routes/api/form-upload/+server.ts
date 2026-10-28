// Серверная точка апгрейда `GET /api/form-upload` → `WebSocket` для потоковых форм с файлами.
import type { RequestHandler } from './$types'
import { DEFAULT_LIMITS } from '#lib/form/server.js'
import { originGuard } from '#server/form-security.server.js'
import { upgradeWs } from '#server/ws-upgrade.server.js'
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

  return upgradeWs(event, (socket) => handleFormUploadWs(socket, event))
}
