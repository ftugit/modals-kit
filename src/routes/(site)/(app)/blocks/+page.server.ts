import type { PageServerLoad } from './$types'
import { loadBlocksRouteData } from '#content/user/ui/blocks-list/load.server.js'

export const load: PageServerLoad = async (event) => loadBlocksRouteData(event, null)
