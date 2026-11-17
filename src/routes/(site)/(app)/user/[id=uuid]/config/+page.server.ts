import type { PageServerLoad } from './$types'
import { loadUserConfigById } from '#sections/user/user-config/load.server.js'

export const load: PageServerLoad = async (event) => loadUserConfigById(event)
