import type { PageServerLoad } from './$types'
import { loadUserAuth } from '#sections/user/auth/load.server.js'

export const load: PageServerLoad = async (event) => loadUserAuth(event)
