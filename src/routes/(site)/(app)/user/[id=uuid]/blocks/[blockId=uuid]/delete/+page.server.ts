import type { PageServerLoad } from './$types'
import { loadUserBlocksDelete } from '#sections/user/blocks-delete/load.server.js'

export const load: PageServerLoad = async (event) => loadUserBlocksDelete(event)
