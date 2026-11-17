import type { PageServerLoad } from './$types'
import { loadUserConfig } from '#sections/user/config/load.server.js'

export const load: PageServerLoad = async (event) => loadUserConfig(event)
