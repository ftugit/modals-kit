import type { PageServerLoad } from './$types'
import { loadSessionsJournal } from '#sections/sessions/load.server.js'

export const load: PageServerLoad = async (event) => loadSessionsJournal(event)
