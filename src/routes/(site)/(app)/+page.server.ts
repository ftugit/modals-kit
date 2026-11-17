import type { PageServerLoad } from './$types'
import { loadHome } from '#sections/home/load.server.js'

export const load: PageServerLoad = async (event) => loadHome(event)
