import { storageVaultSchema } from '#content/storage-vault/schema.js'
import { readVaultSnapshot } from '#hooks/cookie-vault/vault.server.js'
import {
  listQuickNotes,
  listUploadedRecords,
  resolveRequestStorage,
} from '#server/storage.server.js'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ cookies }) => {
  const [vaultSnapshot, storage] = await Promise.all([
    readVaultSnapshot(cookies, storageVaultSchema),
    resolveRequestStorage(cookies),
  ])
  return {
    items: listUploadedRecords(),
    notes: listQuickNotes(),
    vaultSnapshot,
    availableServers: storage.serverNames,
    storageReport: await storage.report(),
  }
}
