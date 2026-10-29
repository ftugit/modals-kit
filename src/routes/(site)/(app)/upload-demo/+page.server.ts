import { storageVaultSchema } from '#content/storage-vault/schema.js'
import { readVaultSnapshot } from '#hooks/cookie-vault/vault.server.js'
import {
  getDemoStorageTelemetry,
  listEnrichedUploadedRecords,
  listQuickNotes,
  resolveRequestStorage,
} from '#server/storage.server.js'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ cookies }) => {
  const [vaultSnapshot, storage] = await Promise.all([
    readVaultSnapshot(cookies, storageVaultSchema),
    resolveRequestStorage(cookies),
  ])
  const [items, storageReport] = await Promise.all([
    listEnrichedUploadedRecords(storage),
    storage.report(),
  ])
  return {
    items,
    notes: listQuickNotes(),
    vaultSnapshot,
    availableServers: storage.serverNames,
    storageReport,
    telemetry: getDemoStorageTelemetry(),
  }
}
