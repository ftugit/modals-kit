import { registerModal } from '#core/lib/modals/index.js'
import { lazy } from '#core/lib/modals/svelte/index.js'
import { driveOperationHref, type DriveOperationName, type DriveOperationParams } from './operations.js'
import {
  driveFolderRoute,
  driveNodeRoute,
  drivePickerRoute,
  driveRootRoute,
  driveTrashRoute,
} from './routes.js'

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

/**
 * Операции: по одной модалке на строку матрицы (`operations.ts`). Каждая ведёт
 * на свой fallback route с теми же параметрами, поэтому ссылка без JS и
 * открытие модалки приходят в один и тот же `load`.
 */
const OPERATION_MODALS: readonly {
  readonly op: DriveOperationName
  readonly load: () => Promise<unknown>
  readonly size: { width: number; height: number }
}[] = [
  { op: 'mkdir', load: () => import('./ui/mkdir/DriveMkdirModal.svelte'), size: { width: 420, height: 420 } },
  { op: 'upload', load: () => import('./ui/upload/DriveUploadModal.svelte'), size: { width: 480, height: 460 } },
  { op: 'rename', load: () => import('./ui/rename/DriveRenameModal.svelte'), size: { width: 420, height: 400 } },
  { op: 'move', load: () => import('./ui/move/DriveMoveModal.svelte'), size: { width: 460, height: 440 } },
  { op: 'copy', load: () => import('./ui/copy/DriveCopyModal.svelte'), size: { width: 460, height: 480 } },
  { op: 'star', load: () => import('./ui/star/DriveStarModal.svelte'), size: { width: 380, height: 320 } },
  {
    op: 'trash-action',
    load: () => import('./ui/trash-action/DriveTrashActionModal.svelte'),
    size: { width: 420, height: 340 },
  },
  { op: 'restore', load: () => import('./ui/restore/DriveRestoreModal.svelte'), size: { width: 420, height: 340 } },
  { op: 'purge', load: () => import('./ui/purge/DrivePurgeModal.svelte'), size: { width: 420, height: 340 } },
  { op: 'share', load: () => import('./ui/share/DriveShareModal.svelte'), size: { width: 460, height: 460 } },
  { op: 'unshare', load: () => import('./ui/unshare/DriveUnshareModal.svelte'), size: { width: 420, height: 340 } },
  { op: 'dav-issue', load: () => import('./ui/dav-issue/DriveDavIssueModal.svelte'), size: { width: 460, height: 440 } },
  {
    op: 'dav-revoke',
    load: () => import('./ui/dav-revoke/DriveDavRevokeModal.svelte'),
    size: { width: 420, height: 360 },
  },
]

for (const entry of OPERATION_MODALS) {
  registerModal({
    name: `drive.${entry.op}`,
    component: lazy(entry.load as () => Promise<never>),
    route: (p?: DriveOperationParams) => driveOperationHref(entry.op, p ?? {}),
    size: entry.size,
  })
}
