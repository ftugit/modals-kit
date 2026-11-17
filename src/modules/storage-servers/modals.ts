import { registerModal } from '#core/lib/modals/index.js'
import { lazy } from '#core/lib/modals/svelte/index.js'
import { storageServersRoute } from './routes.js'

registerModal({
  name: 'storage.servers',
  component: lazy(() => import('./ui/StorageServersModal.svelte')),
  route: storageServersRoute.href,
  size: { width: 640, height: 640 },
})
