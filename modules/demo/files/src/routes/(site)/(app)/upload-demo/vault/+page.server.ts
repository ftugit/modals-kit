import { localPath } from '#lib/address/index.js'
import { storageVaultSchema } from '#content/storage-vault/schema.js'
import { readVaultSnapshot } from '#hooks/cookie-vault/vault.server.js'
import type { PageServerLoad } from './$types'

function sanitizeBackHref(raw: string | null): string {
  return localPath(raw) ?? '/upload-demo'
}

export const load: PageServerLoad = async ({ cookies, url }) => {
  const vaultSnapshot = await readVaultSnapshot(cookies, storageVaultSchema)
  const backHref = sanitizeBackHref(url.searchParams.get('from'))
  return {
    vaultSnapshot,
    backHref,
  }
}
