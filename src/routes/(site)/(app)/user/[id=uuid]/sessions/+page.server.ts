import type { Actions, PageServerLoad } from './$types'
import { loadUserSessions, userSessionsActions } from '#sections/user/user-sessions/load.server.js'

export const load: PageServerLoad = async (event) => loadUserSessions(event)

export const actions: Actions = userSessionsActions
