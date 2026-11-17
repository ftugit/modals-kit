import type { PageServerLoad } from './$types'
import { loadProfileEdit } from '#sections/user/profile-edit/load.server.js'

export const load: PageServerLoad = async (event) => loadProfileEdit(event)
