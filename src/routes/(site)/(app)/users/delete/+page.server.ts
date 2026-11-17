import type { PageServerLoad } from './$types'
import { loadUsersDelete } from '#sections/users/delete/load.server.js'

export const load: PageServerLoad = async (event) => loadUsersDelete(event)
