// Section: список блокировок пользователя (`/user/[id]/blocks`) — load вынесен из route.
import type { RequestEvent } from '@sveltejs/kit'
import { loadBlocksRouteData } from '#modules/user/blocks/svelte/blocks-list/load.server.js'

export async function loadUserBlocks(event: RequestEvent<{ id: string }>) {
  return loadBlocksRouteData(event, event.params.id)
}
