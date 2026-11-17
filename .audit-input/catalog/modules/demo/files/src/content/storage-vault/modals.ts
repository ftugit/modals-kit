import { registerModal } from '#lib/modals/index.js'
import { lazy } from '#lib/modals/svelte/index.js'

export const STORAGE_VAULT_MODAL = 'storage.vault'
export const STORAGE_VAULT_ROUTE = '/upload-demo/vault'
export const STORAGE_VAULT_DELETE_MODAL = 'storage.vault.delete'
export const STORAGE_VAULT_DELETE_ROUTE = '/upload-demo/vault/delete'

registerModal({
  name: STORAGE_VAULT_MODAL,
  component: lazy(() => import('./ui/StorageVaultModal.svelte')),
  route: STORAGE_VAULT_ROUTE,
  size: { width: 540, height: 640 },
})

registerModal({
  name: STORAGE_VAULT_DELETE_MODAL,
  component: lazy(() => import('./ui/StorageVaultDeleteModal.svelte')),
  route: (p: { slot?: string; from?: string }) => {
    const q = new URLSearchParams()
    if (p?.slot) q.set('slot', String(p.slot))
    if (p?.from) q.set('from', String(p.from))
    const qs = q.toString()
    return qs ? `${STORAGE_VAULT_DELETE_ROUTE}?${qs}` : STORAGE_VAULT_DELETE_ROUTE
  },
  size: { width: 420, height: 260 },
})
