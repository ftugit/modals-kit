import type { RequestEvent } from '@sveltejs/kit'
import type { StorageServersRouteData } from '#modules/storage-servers/types.js'
import { auth } from '#modules/user/base/service/gateway.server.js'
import { listStorageServers } from '#core/server/app-storage.server.js'

export async function loadStorageServers(event: RequestEvent): Promise<StorageServersRouteData> {
  event.setHeaders({ 'cache-control': 'private, no-store' })

  const editId = event.url.searchParams.get('edit')?.trim() || null
  const u = auth(event)
  if (!u.enabled) {
    return { enabled: false, slice: null, fact: 'auth.disabled', editId }
  }
  const actor = await u.actor()
  if (!actor.ok) {
    return { enabled: true, slice: null, fact: actor.fact.code, editId }
  }
  const r = await listStorageServers(actor.value)
  if (!r.ok) {
    return { enabled: true, slice: null, fact: r.fact.code, editId }
  }
  return {
    enabled: true,
    slice: r.value,
    fact: null,
    editId,
  }
}
