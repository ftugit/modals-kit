// Section: удаление профиля (`/user/[id]/delete`) — load вынесен из route.
import type { RequestEvent } from '@sveltejs/kit'
import { auth } from '#modules/user/base/service/gateway.server.js'
import { createUserConfig } from '#modules/user/base/index.js'
import type { ProfileDeleteRouteData } from '#modules/user/profile/model/types.js'
import { localStore } from '#core/server/cache.server.js'

const config = createUserConfig(localStore.scope('user-config'))

export async function loadProfileDelete(event: RequestEvent<{ id: string }>): Promise<ProfileDeleteRouteData> {
  event.setHeaders({ 'cache-control': 'private, no-store' })

  const u = auth(event)
  const r = await u.profile(event.params.id)

  return {
    uid: event.params.id,
    enabled: u.enabled,
    canDeleteProfile: r.ok ? r.value.canDeleteProfile : false,
    canDeleteSeed: r.ok ? r.value.canDeleteSeed : false,
    holdSeconds: await config.get('holdSeconds'),
    fact: r.ok ? null : r.fact.code,
  }
}
