import type { PageServerLoad } from './$types'
import { listQuickNotes, listUploadedRecords } from '#server/storage.server.js'

export const load: PageServerLoad = async () => {
  return {
    items: listUploadedRecords(),
    notes: listQuickNotes(),
  }
}
