// Закрытие устройств своего аккаунта (`/user/sessions/delete`) — страница-fallback
// модалки `user.session.delete`. Набор и вариант приходят адресом; доменная дверь
// набора появляется на этапе S3, поэтому загрузчик пока только разбирает адрес.
import { auth } from '#content/user/gateway.server.js'
import { createUserConfig } from '#content/user/index.js'
import { parseSessionDeleteIds, parseSessionDeleteSlice, parseSessionDeleteVariant } from '#content/user/session-delete.js'
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
    contextUid: null,
    ids,
    tooMany,
    variant: parseSessionDeleteVariant(event.url.searchParams.get('variant')),
    enabled: u.enabled,
    holdSeconds: await config.get('holdSeconds'),
    fact: u.enabled ? null : 'auth.disabled',
    sliceFields: parseSessionDeleteSlice(event.url.searchParams),
  }
}
