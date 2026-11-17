import type { PageServerLoad } from './$types'
import { loadUserBlocksNew } from '#sections/user/blocks-new/load.server.js'

export const load: PageServerLoad = async (event) => loadUserBlocksNew(event)
