// Закрытие устройств переданного аккаунта (`/user/[id]/sessions/delete`) — второй
// адрес единицы `user.session.delete`. Цель — `id` пути, набор — адресом.
import { auth } from '#content/user/gateway.server.js'
import { createUserConfig } from '#content/user/index.js'
import { parseSessionDeleteIds, parseSessionDeleteVariant } from '#content/user/session-delete.js'
import type { SessionDeleteRouteData } from '#content/user/types.js'
import { localStore } from '#server/cache.server.js'
import type { PageServerLoad } from './$types'

const config = createUserConfig(localStore.scope('user-config'))

export const load: PageServerLoad = async (event): Promise<SessionDeleteRouteData> => {
  event.setHeaders({ 'cache-control': 'private, no-store' })

  const { ids, tooMany } = parseSessionDeleteIds(
    event.url.searchParams.get('id'),
    event.url.searchParams.get('ids'),
  )
  const u = auth(event)

  return {
    contextUid: event.params.id,
    ids,
    tooMany,
    variant: parseSessionDeleteVariant(event.url.searchParams.get('variant')),
    enabled: u.enabled,
    holdSeconds: await config.get('holdSeconds'),
    fact: u.enabled ? null : 'auth.disabled',
  }
}
