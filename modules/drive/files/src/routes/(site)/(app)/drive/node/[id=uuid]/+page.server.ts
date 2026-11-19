import type { PageServerLoad } from './$types'
import { loadDriveNode } from '#sections/drive/load.server.js'

export const load: PageServerLoad = async (event) => loadDriveNode(event, event.params.id)
