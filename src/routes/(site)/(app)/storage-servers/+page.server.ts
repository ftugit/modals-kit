// Администрирование пула серверов боевого хранилища (`/storage-servers`) —
// общий загрузчик страницы и модалки `storage.servers` (`STORAGE_ACL`).
import type { PageServerLoad } from './$types'
import type { StorageServersRouteData } from '#content/storage-servers/types.js'
import { auth } from '#content/user/gateway.server.js'
import { listStorageServers } from '#server/app-storage.server.js'

export const load: PageServerLoad = async (event): Promise<StorageServersRouteData> => {
  event.setHeaders({ 'cache-control': 'private, no-store' })

  const u = auth(event)
  if (!u.enabled) {
    return { enabled: false, slice: null, fact: 'auth.disabled' }
  }
  const actor = await u.actor()
  if (!actor.ok) {
    return { enabled: true, slice: null, fact: actor.fact.code }
  }
  const r = await listStorageServers(actor.value)
  if (!r.ok) {
    return { enabled: true, slice: null, fact: r.fact.code }
  }
  return {
    enabled: true,
    slice: r.value,
    fact: null,
  }
}
