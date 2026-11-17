import type { PageServerLoad } from './$types'
import { loadSessionDelete } from '#sections/user/session-delete/load.server.js'

export const load: PageServerLoad = async (event) => loadSessionDelete(event)
