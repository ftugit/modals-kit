import type { PageServerLoad } from './$types'
import { auth } from '#content/user/gateway.server.js'
import type { BlockEditRouteData } from '#content/user/types.js'

export const load: PageServerLoad = async (event): Promise<BlockEditRouteData> => {
  event.setHeaders({ 'cache-control': 'private, no-store' })

  const blockId = event.params.blockId
  const u = auth(event)
  const r = await u.readBlockDetail({ blockId, expectedUid: null })

  return {
    contextUid: null,
    blockId,
    enabled: u.enabled,
    detail: r.ok ? r.value : null,
    fact: r.ok ? null : r.fact.code,
  }
}
