import type { PageServerLoad } from './$types'
import { loadBlocksEdit } from '#sections/blocks/edit/load.server.js'

export const load: PageServerLoad = async (event) => loadBlocksEdit(event)
