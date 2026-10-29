// Настройки текущего пользователя (`/user/config`) — статический носитель
// пары `user.config.edit` без переданного `id`.
import type { PageServerLoad } from './$types'
import { auth } from '#content/user/gateway.server.js'
import type { UserConfigRouteData } from '#content/user/index.js'

export const load: PageServerLoad = async (event): Promise<UserConfigRouteData> => {
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
