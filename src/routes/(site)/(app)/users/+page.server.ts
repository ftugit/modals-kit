import type { PageServerLoad } from './$types'
import { loadUsers } from '#sections/users/load.server.js'

export const load: PageServerLoad = async (event) => loadUsers(event)
