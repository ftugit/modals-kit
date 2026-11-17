import type { PageServerLoad } from './$types'
import { loadBlocksBulk } from '#sections/blocks/bulk/load.server.js'

export const load: PageServerLoad = async (event) => loadBlocksBulk(event)
