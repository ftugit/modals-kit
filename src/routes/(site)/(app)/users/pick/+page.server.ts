import type { PageServerLoad } from './$types'
import { loadUsersPick } from '#sections/users/pick/load.server.js'

export const load: PageServerLoad = async (event) => loadUsersPick(event)
