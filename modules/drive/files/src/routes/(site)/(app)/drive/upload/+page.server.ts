import type { PageServerLoad } from './$types'
import { loadDriveOperation } from '#sections/drive/load.server.js'

export const load: PageServerLoad = async (event) => loadDriveOperation(event, 'upload')
