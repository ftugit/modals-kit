import type { Actions, PageServerLoad } from './$types'
import { loadLogout, logoutActions } from '#sections/user/logout/load.server.js'

export const load: PageServerLoad = async (event) => loadLogout(event)

export const actions: Actions = logoutActions
