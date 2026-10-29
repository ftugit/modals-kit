import type { PageServerLoad } from './$types'
import { auth } from '#content/user/gateway.server.js'
import type { BlockCreateRouteData } from '#content/user/types.js'

export const load: PageServerLoad = async (event): Promise<BlockCreateRouteData> => {
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
    fact: r.ok ? null : r.fact.code,
  }
}
