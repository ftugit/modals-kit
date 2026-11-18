import type { PageServerLoad } from './$types'
import { loadDriveAccess } from '#sections/drive/load.server.js'

export const load: PageServerLoad = async (event) => loadDriveAccess(event)
