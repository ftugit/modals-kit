import type { PageServerLoad } from './$types'
import { loadDriveList } from '#sections/drive/load.server.js'

export const load: PageServerLoad = async (event) =>
  loadDriveList(event, { kind: 'folder', id: event.params.folderId })
