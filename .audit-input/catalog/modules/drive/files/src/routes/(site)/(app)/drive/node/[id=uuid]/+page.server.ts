import type { PageServerLoad } from './$types'
import { loadDrive } from '#sections/drive/load.server.js'

export const load: PageServerLoad = async (event) =>
  loadDrive(event, { nodeId: event.params.id })
import { driveActions } from '#sections/drive/actions.server.js'
export const actions = driveActions
