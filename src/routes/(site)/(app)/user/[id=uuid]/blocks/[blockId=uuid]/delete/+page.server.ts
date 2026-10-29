import type { PageServerLoad } from './$types'
import { auth } from '#content/user/gateway.server.js'
import { createUserConfig } from '#content/user/index.js'
import type { BlockDeleteRouteData } from '#content/user/types.js'
import { localStore } from '#server/cache.server.js'

const config = createUserConfig(localStore.scope('user-config'))

export const load: PageServerLoad = async (event): Promise<BlockDeleteRouteData> => {
  event.setHeaders({ 'cache-control': 'private, no-store' })

  const contextUid = event.params.id
  const blockId = event.params.blockId
  const u = auth(event)
  const r = await u.readBlockDetail({ blockId, expectedUid: contextUid })

  return {
    contextUid,
    blockId,
    enabled: u.enabled,
    detail: r.ok ? r.value : null,
    holdSeconds: await config.get('holdSeconds'),
    fact: r.ok ? null : r.fact.code,
  }
}
