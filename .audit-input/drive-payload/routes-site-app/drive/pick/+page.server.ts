import type { PageServerLoad } from './$types'
import { loadDrivePicker } from '#sections/drive/load.server.js'

export const load: PageServerLoad = async (event) => loadDrivePicker(event)
