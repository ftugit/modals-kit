// Настройки целевого пользователя по адресу (`/user/[id]/config`) —
// динамический носитель пары `user.config.edit` с переданным `id`.
import type { PageServerLoad } from './$types'
import { auth } from '#content/user/gateway.server.js'
import type { UserConfigRouteData } from '#content/user/index.js'

export const load: PageServerLoad = async (event): Promise<UserConfigRouteData> => {
  event.setHeaders({ 'cache-control': 'private, no-store' })

  const u = auth(event)
  if (!u.enabled) {
    return { uid: event.params.id, enabled: false, slice: null, fact: 'auth.disabled' }
  }
  const r = await u.listUserConfig(event.params.id)
  if (!r.ok) {
    return { uid: event.params.id, enabled: true, slice: null, fact: r.fact.code }
  }
  return {
    uid: event.params.id,
    enabled: true,
    slice: r.value,
    fact: null,
  }
}
