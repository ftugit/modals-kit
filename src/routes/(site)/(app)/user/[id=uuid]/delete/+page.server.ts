import type { PageServerLoad } from './$types'
import { loadProfileDelete } from '#sections/user/profile-delete/load.server.js'

export const load: PageServerLoad = async (event) => loadProfileDelete(event)
