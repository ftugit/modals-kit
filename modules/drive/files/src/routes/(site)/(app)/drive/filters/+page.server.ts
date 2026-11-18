import type { PageServerLoad } from './$types'
import { loadDriveFilters } from '#sections/drive/load.server.js'

export const load: PageServerLoad = async (event) => loadDriveFilters(event)
