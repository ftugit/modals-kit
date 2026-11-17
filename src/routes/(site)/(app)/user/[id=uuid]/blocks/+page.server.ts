import type { PageServerLoad } from './$types'
import { loadUserBlocks } from '#sections/user/blocks/load.server.js'

export const load: PageServerLoad = async (event) => loadUserBlocks(event)
