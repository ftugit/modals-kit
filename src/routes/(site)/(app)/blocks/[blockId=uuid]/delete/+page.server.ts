import type { PageServerLoad } from './$types'
import { loadBlocksDelete } from '#sections/blocks/delete/load.server.js'

export const load: PageServerLoad = async (event) => loadBlocksDelete(event)
