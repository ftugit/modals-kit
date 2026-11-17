import type { Actions, PageServerLoad } from './$types'
import { loadSchema, schemaActions } from '#sections/schema/load.server.js'

export const load: PageServerLoad = async (event) => loadSchema(event)

export const actions: Actions = schemaActions
