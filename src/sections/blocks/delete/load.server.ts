import type { RequestEvent } from '@sveltejs/kit'
import { auth } from '#modules/user/base/service/gateway.server.js'
import { createUserConfig } from '#modules/user/base/index.js'
import type { BlockDeleteRouteData } from '#modules/user/base/model/types.js'
import { localStore } from '#core/server/cache.server.js'

const config = createUserConfig(localStore.scope('user-config'))

export async function loadBlocksDelete(event: RequestEvent<{ blockId: string }>): Promise<BlockDeleteRouteData> {
  event.setHeaders({ 'cache-control': 'private, no-store' })

  const blockId = event.params.blockId
  const u = auth(event)
  const r = await u.readBlockDetail({ blockId, expectedUid: null })

  return {
    contextUid: null,
    blockId,
    enabled: u.enabled,
    detail: r.ok ? r.value : null,
    holdSeconds: await config.get('holdSeconds'),
    fact: r.ok ? null : r.fact.code,
  }
}
