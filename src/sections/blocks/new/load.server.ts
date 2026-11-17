import type { RequestEvent } from '@sveltejs/kit'
import { localPath } from '#core/lib/address/index.js'
import { BULK_IDS_LIMIT } from '#modules/user/base/service/bulk.js'
import { auth, resolveVault } from '#modules/user/base/service/gateway.server.js'
import type { BlockCreateRouteData } from '#modules/user/base/model/types.js'
import {
  accountsSliceFrom,
  accountsSliceReader,
  hasSliceFields,
} from '#modules/user/accounts/svelte/accounts-delete/form.js'

export async function loadBlocksNew(
  event: RequestEvent,
): Promise<BlockCreateRouteData & { initialSubjects: string[]; initialSubject: string; selfHref: string }> {
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

  // Срез: адрес списка в `blk.list`, цели — те же аккаунты, что видел человек.
  // Резолвит сервер тем же правом, что список; предел набора — отказ, не усечение.
  const list = localPath(sp.get('blk.list'))
  let sliceFact: BlockCreateRouteData['fact'] = null
  if (initialSubjects.length === 0 && list && u.enabled) {
    const read = accountsSliceReader(new URL(list, event.url).searchParams)
    if (hasSliceFields(read)) {
      const resolved = await u.resolveAccountSlice(accountsSliceFrom(read))
      if (!resolved.ok) sliceFact = resolved.fact.code
      else if (resolved.value.length > BULK_IDS_LIMIT) sliceFact = 'auth.limit'
      else {
        for (const id of resolved.value) {
          if (viewerId && id === viewerId) continue
          initialSubjects.push(id)
        }
      }
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
    fact: sliceFact ?? (r.ok ? null : r.fact.code),
    initialSubjects,
    initialSubject: initialSubjects[0] ?? '',
    selfHref: qs ? `${event.url.pathname}?${qs}` : event.url.pathname,
  }
}
