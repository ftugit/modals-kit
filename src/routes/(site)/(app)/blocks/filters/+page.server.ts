import type { PageServerLoad } from './$types'
import { loadBlocksFilters } from '#sections/blocks/filters/load.server.js'

export const load: PageServerLoad = async (event) => loadBlocksFilters(event)
