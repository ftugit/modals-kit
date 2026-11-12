import { registerModal } from '#lib/modals/index.js'
import { lazy } from '#lib/modals/svelte/index.js'

export const STORAGE_VAULT_MODAL = 'storage.vault'
export const STORAGE_VAULT_ROUTE = '/upload-demo/vault'

registerModal({
  name: STORAGE_VAULT_MODAL,
  component: lazy(() => import('./ui/StorageVaultModal.svelte')),
  route: STORAGE_VAULT_ROUTE,
  size: { width: 540, height: 640 },
})
