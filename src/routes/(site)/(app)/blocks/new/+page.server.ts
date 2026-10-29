import type { PageServerLoad } from './$types'
import { auth } from '#content/user/gateway.server.js'
import type { BlockCreateRouteData } from '#content/user/types.js'

export const load: PageServerLoad = async (
  event,
): Promise<BlockCreateRouteData & { initialSubject: string; selfHref: string }> => {
  event.setHeaders({ 'cache-control': 'private, no-store' })

  const u = auth(event)
  const r = await u.blockCreateMeta(null)
  const initialSubject = (event.url.searchParams.get('subject') ?? '').trim()
  const qs = event.url.searchParams.toString()

  return {
    uid: null,
    enabled: u.enabled,
    canCreate: r.ok ? r.value.canCreate : false,
    canPickUsers: r.ok ? r.value.canPickUsers : false,
    assignableScopes: r.ok ? r.value.assignableScopes : [],
    fact: r.ok ? null : r.fact.code,
    initialSubject,
    selfHref: qs ? `${event.url.pathname}?${qs}` : event.url.pathname,
  }
}
