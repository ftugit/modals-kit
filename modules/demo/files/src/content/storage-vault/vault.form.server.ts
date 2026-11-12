import { registerCookieVaultForms } from '#hooks/cookie-vault/vault.server.js'
import { localPath } from '#lib/address/index.js'
import { createIpThrottle } from '#server/client-ip.server.js'
import {
  probeStorageVaultEntry,
  validateStorageTargetUrl,
  type ProbeStorageOptions,
  type StorageUrlSafetyOptions,
} from '#server/storage-probe.server.js'
import { storageVaultSchema } from './schema.js'

export {
  probeStorageVaultEntry,
  validateStorageTargetUrl,
  type ProbeStorageOptions,
  type StorageUrlSafetyOptions,
}

function safeVaultRedirect(url: URL): string {
  const from = localPath(url.searchParams.get('from'))
  if (from) {
    return `/upload-demo/vault?from=${encodeURIComponent(from)}`
  }
  return '/upload-demo/vault'
}

const storageVaultThrottle = createIpThrottle('storage-vault', 15, 60_000)

registerCookieVaultForms(storageVaultSchema, {
  redirectOnSuccess: (event) => safeVaultRedirect(event.url),
  throttle: storageVaultThrottle,
  validateEntry: (id, entry) => probeStorageVaultEntry(id, entry),
})
