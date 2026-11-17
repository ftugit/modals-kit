import type { PageServerLoad } from './$types'
import { loadBlocks } from '#sections/blocks/load.server.js'

export const load: PageServerLoad = async (event) => loadBlocks(event)
