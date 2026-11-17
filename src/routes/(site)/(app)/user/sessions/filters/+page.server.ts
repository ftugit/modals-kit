import type { PageServerLoad } from './$types'
import { loadSessionsFilters } from '#sections/user/sessions-filters/load.server.js'

export const load: PageServerLoad = async (event) => loadSessionsFilters(event)
