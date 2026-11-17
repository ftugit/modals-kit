import type { PageServerLoad } from './$types'
import { davTokenActions, loadDavTokens } from '#sections/drive/dav-tokens.server.js'

export const load: PageServerLoad = async (event) => loadDavTokens(event)
export const actions = davTokenActions
