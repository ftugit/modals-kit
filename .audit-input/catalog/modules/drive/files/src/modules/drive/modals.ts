import { registerModal } from '#core/lib/modals/index.js'
import { lazy } from '#core/lib/modals/svelte/index.js'
import { driveFolderRoute, driveNodeRoute, drivePickerRoute, driveRootRoute, driveTrashRoute } from './routes.js'

registerModal({
  name: 'drive.browse',
  component: lazy(() => import('./ui/DriveBrowseModal.svelte')),
  route: (p?: { folderId?: string | null }) =>
    p?.folderId ? driveFolderRoute.href({ folderId: p.folderId }) : driveRootRoute.href(),
  size: { width: 960, height: 720 },
})

registerModal({
  name: 'drive.node',
  component: lazy(() => import('./ui/DriveNodeModal.svelte')),
  route: (p?: { id?: string | null }) => (p?.id ? driveNodeRoute.href({ id: p.id }) : driveRootRoute.href()),
  size: { width: 640, height: 560 },
})

registerModal({
  name: 'drive.picker',
  component: lazy(() => import('./ui/DrivePickerModal.svelte')),
  route: drivePickerRoute.href,
  size: { width: 900, height: 720 },
})

registerModal({
  name: 'drive.trash',
  component: lazy(() => import('./ui/DriveTrashModal.svelte')),
  route: driveTrashRoute.href,
  size: { width: 960, height: 720 },
})
