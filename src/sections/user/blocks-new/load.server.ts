import type { RequestEvent } from '@sveltejs/kit'
import { auth } from '#modules/user/base/service/gateway.server.js'
import type { BlockCreateRouteData } from '#modules/user/base/model/types.js'

export async function loadUserBlocksNew(event: RequestEvent<{ id: string }>): Promise<BlockCreateRouteData> {
  event.setHeaders({ 'cache-control': 'private, no-store' })

  const uid = event.params.id
  const u = auth(event)
  const r = await u.blockCreateMeta(uid)

  return {
    uid,
    enabled: u.enabled,
    canCreate: r.ok ? r.value.canCreate : false,
    canPickUsers: false,
    assignableScopes: r.ok ? r.value.assignableScopes : [],
    holdSeconds: r.ok ? r.value.holdSeconds : 2,
    fact: r.ok ? null : r.fact.code,
  }
}
