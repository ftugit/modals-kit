import type { Actions, PageServerLoad } from './$types'
import { loadAccountSession, accountSessionActions } from '#sections/user/account-session/load.server.js'

export const load: PageServerLoad = async (event) => loadAccountSession(event)

export const actions: Actions = accountSessionActions
