// Section: глобальный список блокировок (`/blocks`) — load вынесен из route.
import type { RequestEvent } from '@sveltejs/kit'
import { loadBlocksRouteData } from '#modules/user/blocks/svelte/blocks-list/load.server.js'

export async function loadBlocks(event: RequestEvent) {
  return loadBlocksRouteData(event, null)
}
