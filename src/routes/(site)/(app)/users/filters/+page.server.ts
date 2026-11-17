import type { PageServerLoad } from './$types'
import { loadUsersFilters } from '#sections/users/filters/load.server.js'

export const load: PageServerLoad = async (event) => loadUsersFilters(event)
