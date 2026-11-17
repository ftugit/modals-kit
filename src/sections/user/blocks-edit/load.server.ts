import type { RequestEvent } from '@sveltejs/kit'
import { auth } from '#modules/user/base/service/gateway.server.js'
import type { BlockEditRouteData } from '#modules/user/base/model/types.js'

export async function loadUserBlocksEdit(event: RequestEvent<{ blockId: string; id: string }>): Promise<BlockEditRouteData> {
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
    fact: r.ok ? null : r.fact.code,
  }
}
