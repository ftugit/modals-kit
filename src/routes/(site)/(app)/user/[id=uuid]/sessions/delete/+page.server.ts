import type { PageServerLoad } from './$types'
import { loadSessionDeleteTarget } from '#sections/user/session-delete-target/load.server.js'

export const load: PageServerLoad = async (event) => loadSessionDeleteTarget(event)
