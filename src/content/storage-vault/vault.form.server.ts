import { registerCookieVaultForms } from '#hooks/cookie-vault/vault.server.js'
import { storageVaultSchema } from './schema.js'

function safeVaultRedirect(url: URL): string {
  const from = url.searchParams.get('from') ?? ''
  if (from.startsWith('/') && !from.startsWith('//')) {
    return `/upload-demo/vault?from=${encodeURIComponent(from)}`
  }
  return '/upload-demo/vault'
}

registerCookieVaultForms(storageVaultSchema, {
  redirectOnSuccess: (event) => safeVaultRedirect(event.url),
})
