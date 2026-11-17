import type { PageServerLoad } from './$types'
import { loadBlocksNew } from '#sections/blocks/new/load.server.js'

export const load: PageServerLoad = async (event) => loadBlocksNew(event)
