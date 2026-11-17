import type { PageServerLoad } from './$types'
import { loadProfile } from '#sections/user/profile-view/load.server.js'

export const load: PageServerLoad = async (event) => loadProfile(event)
