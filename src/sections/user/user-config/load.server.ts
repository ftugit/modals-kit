// Section: настройки целевого пользователя (`/user/[id]/config`) — load вынесен из route.
import type { RequestEvent } from '@sveltejs/kit'
import { auth } from '#modules/user/base/service/gateway.server.js'
import type { UserConfigRouteData } from '#modules/user/base/index.js'

export async function loadUserConfigById(event: RequestEvent<{ id: string }>): Promise<UserConfigRouteData> {
  event.setHeaders({ 'cache-control': 'private, no-store' })

  const uid = event.params.id
  const u = auth(event)
  if (!u.enabled) {
    return { uid, enabled: false, slice: null, fact: 'auth.disabled' }
  }
  const r = await u.listUserConfig(uid)
  if (!r.ok) {
    return { uid, enabled: true, slice: null, fact: r.fact.code }
  }
  return {
    uid,
    enabled: true,
    slice: r.value,
    fact: null,
  }
}
