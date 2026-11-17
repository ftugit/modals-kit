import type { Actions, PageServerLoad } from './$types'
import { loadSessionCard, sessionCardActions } from '#sections/user/session-card/load.server.js'

export const load: PageServerLoad = async (event) => loadSessionCard(event)

export const actions: Actions = sessionCardActions
