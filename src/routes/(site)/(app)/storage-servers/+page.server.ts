import type { PageServerLoad } from './$types'
import { loadStorageServers } from '#sections/storage-servers/load.server.js'

export const load: PageServerLoad = async (event) => loadStorageServers(event)
