import type { FormDescription } from '#core/lib/form/index.js'
import type { DriveOperationName } from '../operations.js'
import type { DriveFormData } from './shared.js'
import { driveCopyForm } from './copy.js'
import { driveDavIssueForm, driveDavRevokeForm } from './dav.js'
import { driveMkdirForm } from './mkdir.js'
import { driveMoveForm } from './move.js'
import { drivePurgeForm } from './purge.js'
import { driveRenameForm } from './rename.js'
import { driveRestoreForm } from './restore.js'
import { driveShareForm } from './share.js'
import { driveStarForm } from './star.js'
import { driveTrashForm } from './trash.js'
import { driveUnshareForm } from './unshare.js'
import { driveUploadForm } from './upload.js'

export type { DriveFormData } from './shared.js'
export {
  driveCopyForm,
  driveDavIssueForm,
  driveDavRevokeForm,
  driveMkdirForm,
  driveMoveForm,
  drivePurgeForm,
  driveRenameForm,
  driveRestoreForm,
  driveShareForm,
  driveStarForm,
  driveTrashForm,
  driveUnshareForm,
  driveUploadForm,
}

/** Описание формы операции по имени. */
export function driveOperationDescription(
  op: DriveOperationName,
  data: DriveFormData = {},
): FormDescription {
  switch (op) {
    case 'mkdir':
      return driveMkdirForm(data)
    case 'upload':
      return driveUploadForm(data)
    case 'rename':
      return driveRenameForm(data)
    case 'move':
      return driveMoveForm(data)
    case 'copy':
      return driveCopyForm(data)
    case 'star':
      return driveStarForm(data)
    case 'trash-action':
      return driveTrashForm(data)
    case 'restore':
      return driveRestoreForm(data)
    case 'purge':
      return drivePurgeForm(data)
    case 'share':
      return driveShareForm(data)
    case 'unshare':
      return driveUnshareForm(data)
    case 'dav-issue':
      return driveDavIssueForm(data)
    case 'dav-revoke':
      return driveDavRevokeForm(data)
  }
}
