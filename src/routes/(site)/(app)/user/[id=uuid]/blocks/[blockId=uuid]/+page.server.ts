import type { PageServerLoad } from './$types'
import { loadUserBlocksEdit } from '#sections/user/blocks-edit/load.server.js'

export const load: PageServerLoad = async (event) => loadUserBlocksEdit(event)
