// Section: редактирование профиля (`/user/[id]/edit`) — load вынесен из route.
import type { RequestEvent } from '@sveltejs/kit'
import { auth } from '#modules/user/base/service/gateway.server.js'
import { createUserConfig } from '#modules/user/base/index.js'
import { localStore } from '#core/server/cache.server.js'
import type { ProfileEditRouteData } from './types.js'

const config = createUserConfig(localStore.scope('user-config'))

export async function loadProfileEdit(event: RequestEvent<{ id: string }>): Promise<ProfileEditRouteData> {
  event.setHeaders({ 'cache-control': 'private, no-store' })

  const u = auth(event)
  const r = await u.profile(event.params.id)

  return {
    uid: event.params.id,
    profile: r.ok ? r.value.profile : null,
    canEdit: r.ok ? r.value.canEdit : false,
    canDeleteProfile: r.ok ? r.value.canDeleteProfile : false,
    fact: r.ok ? null : r.fact.code,
    enabled: u.enabled,
    limits: { nicknameForbidden: await config.get('nicknameForbidden') },
  }
}
