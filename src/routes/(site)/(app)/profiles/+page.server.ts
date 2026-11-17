import type { PageServerLoad } from './$types'
import { loadProfiles } from '#sections/profiles/load.server.js'

export const load: PageServerLoad = async (event) => loadProfiles(event)
