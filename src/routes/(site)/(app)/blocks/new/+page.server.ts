import type { PageServerLoad } from './$types'
import { auth, resolveVault } from '#content/user/gateway.server.js'
import type { BlockCreateRouteData } from '#content/user/types.js'

export const load: PageServerLoad = async (
  event,
): Promise<BlockCreateRouteData & { initialSubjects: string[]; initialSubject: string; selfHref: string }> => {
  event.setHeaders({ 'cache-control': 'private, no-store' })

  const u = auth(event)
  const viewer = await resolveVault(event)
  const viewerId = viewer?.sub ?? null
  const r = await u.blockCreateMeta(null)

  const sp = event.url.searchParams
  const rawList = [
    ...sp.getAll('subjects'),
    ...sp.getAll('uids'),
    ...sp.getAll('subject'),
  ]
  const seen = new Set<string>()
  const initialSubjects: string[] = []
  for (const raw of rawList) {
    for (const part of raw.split(',')) {
      const id = part.trim()
      if (!id || (viewerId && id === viewerId) || seen.has(id)) continue
      seen.add(id)
      initialSubjects.push(id)
    }
  }

  const qs = sp.toString()

  return {
    uid: null,
    enabled: u.enabled,
    canCreate: r.ok ? r.value.canCreate : false,
    canPickUsers: r.ok ? r.value.canPickUsers : false,
    assignableScopes: r.ok ? r.value.assignableScopes : [],
    holdSeconds: r.ok ? r.value.holdSeconds : 2,
    fact: r.ok ? null : r.fact.code,
    initialSubjects,
    initialSubject: initialSubjects[0] ?? '',
    selfHref: qs ? `${event.url.pathname}?${qs}` : event.url.pathname,
  }
}
