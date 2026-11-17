// Section: общий журнал устройств (`/sessions`) — load вынесен из route.
import type { RequestEvent } from '@sveltejs/kit'
import { loadSessionsRouteData } from '#modules/user/sessions/svelte/sessions-list/load.server.js'

export async function loadSessionsJournal(event: RequestEvent) {
  return loadSessionsRouteData(event, null, true)
}
