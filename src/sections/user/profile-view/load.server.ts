// Section: профиль по адресу (`/user/[id]`) — load вынесен из route.
import type { RequestEvent } from '@sveltejs/kit'
import type { ProfileRouteData } from '#modules/user/profile/model/types.js'
import { auth } from '#modules/user/base/service/gateway.server.js'
import { createUserConfig } from '#modules/user/base/index.js'
import { localStore } from '#core/server/cache.server.js'

const config = createUserConfig(localStore.scope('user-config'))

export async function loadProfile(event: RequestEvent<{ id: string }>): Promise<ProfileRouteData> {
  event.setHeaders({ 'cache-control': 'private, no-store' })

  const u = auth(event)
  const r = await u.profile(event.params.id)
  if (r.ok) {
    return {
      uid: event.params.id,
      profile: r.value.profile,
      publicProfile: null,
      isOwn: r.value.isOwn,
      visibility: r.value.visibility,
      notCreated: r.value.notCreated,
      canEdit: r.value.canEdit,
      canDeleteProfile: r.value.canDeleteProfile,
      canDeleteSeed: r.value.canDeleteSeed,
      fullBlock: r.value.fullBlock,
      blocks: r.value.blocks,
      canReadBlocks: r.value.canReadBlocks,
      canReadSessions: r.value.canReadSessions,
      canBlock: r.value.canBlock,
      canOpenConfig: r.value.canOpenConfig ?? r.value.isOwn,
      fact: null,
      enabled: u.enabled,
      limits: { nicknameForbidden: await config.get('nicknameForbidden') },
    }
  }

  const p = await u.publicProfile(event.params.id)
  return {
    uid: event.params.id,
    profile: null,
    publicProfile: p.ok ? p.value : null,
    isOwn: false,
    visibility: 'nobody',
    blocks: [],
    canReadBlocks: false,
    canReadSessions: false,
    canBlock: false,
    canOpenConfig: false,
    notCreated: false,
    canEdit: false,
    canDeleteProfile: false,
    canDeleteSeed: false,
    fullBlock: null,
    fact: p.ok ? null : r.fact.code,
    enabled: u.enabled,
    limits: { nicknameForbidden: await config.get('nicknameForbidden') },
  }
}
