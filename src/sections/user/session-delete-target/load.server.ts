// Закрытие устройств переданного аккаунта (`/user/[id]/sessions/delete`) — второй
// адрес единицы `user.session.delete`. Цель — `id` пути, набор — адресом.
import type { RequestEvent } from '@sveltejs/kit'
import { auth } from '#modules/user/base/service/gateway.server.js'
import { createUserConfig } from '#modules/user/base/index.js'
import { parseSessionDeleteIds, parseSessionDeleteSlice, parseSessionDeleteVariant } from '#modules/user/base/model/session-delete.js'
import type { SessionDeleteRouteData } from '#modules/user/base/model/types.js'
import { localStore } from '#core/server/cache.server.js'

const config = createUserConfig(localStore.scope('user-config'))

export async function loadSessionDeleteTarget(event: RequestEvent<{ id: string }>): Promise<SessionDeleteRouteData> {
  event.setHeaders({ 'cache-control': 'private, no-store' })

  const { ids, tooMany } = parseSessionDeleteIds(
    event.url.searchParams.get('id'),
    event.url.searchParams.get('ids'),
  )
  const u = auth(event)

  return {
    contextUid: event.params.id,
    ids,
    tooMany,
    variant: parseSessionDeleteVariant(event.url.searchParams.get('variant')),
    enabled: u.enabled,
    holdSeconds: await config.get('holdSeconds'),
    fact: u.enabled ? null : 'auth.disabled',
    sliceFields: parseSessionDeleteSlice(event.url.searchParams),
  }
}
