// Section: закрытие устройств своего аккаунта (`/user/sessions/delete`) — load вынесен из route.
import type { RequestEvent } from '@sveltejs/kit'
import { auth } from '#modules/user/base/service/gateway.server.js'
import { createUserConfig } from '#modules/user/base/index.js'
import { parseSessionDeleteIds, parseSessionDeleteSlice, parseSessionDeleteVariant } from '#modules/user/base/model/session-delete.js'
import type { SessionDeleteRouteData } from '#modules/user/base/model/types.js'
import { localStore } from '#core/server/cache.server.js'

const config = createUserConfig(localStore.scope('user-config'))

export async function loadSessionDelete(event: RequestEvent): Promise<SessionDeleteRouteData> {
  event.setHeaders({ 'cache-control': 'private, no-store' })

  const { ids, tooMany } = parseSessionDeleteIds(
    event.url.searchParams.get('id'),
    event.url.searchParams.get('ids'),
  )
  const u = auth(event)
  // Гость видит Acl, а не готовую форму: `enabled` описывает наличие входа,
  // а не наличие сессии.
  const viewer = u.enabled ? await u.actor() : null
  const guestFact = u.enabled && viewer && !viewer.ok ? viewer.fact.code : null

  return {
    contextUid: null,
    ids,
    tooMany,
    variant: parseSessionDeleteVariant(event.url.searchParams.get('variant')),
    enabled: u.enabled,
    holdSeconds: await config.get('holdSeconds'),
    fact: guestFact ?? (u.enabled ? null : 'auth.disabled'),
    sliceFields: parseSessionDeleteSlice(event.url.searchParams),
  }
}
