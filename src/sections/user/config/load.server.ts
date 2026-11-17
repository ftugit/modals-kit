// Section: настройки текущего пользователя (`/user/config`) — load вынесен из route.
import type { RequestEvent } from '@sveltejs/kit'
import { auth } from '#modules/user/base/service/gateway.server.js'
import type { UserConfigRouteData } from '#modules/user/base/index.js'

export async function loadUserConfig(event: RequestEvent): Promise<UserConfigRouteData> {
  event.setHeaders({ 'cache-control': 'private, no-store' })

  const u = auth(event)
  if (!u.enabled) {
    return { uid: null, enabled: false, slice: null, fact: 'auth.disabled' }
  }
  const r = await u.listUserConfig(null)
  if (!r.ok) {
    return { uid: null, enabled: true, slice: null, fact: r.fact.code }
  }
  return {
    uid: r.value.uid,
    enabled: true,
    slice: r.value,
    fact: null,
  }
}
