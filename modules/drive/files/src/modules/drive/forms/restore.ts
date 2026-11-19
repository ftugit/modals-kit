import { defineForm, driveFormBase, formNodeId, formReturnTo, idField, returnField } from './shared.js'
import type { DriveFormData } from './shared.js'

export function driveRestoreForm(data: DriveFormData = {}) {
  return defineForm({
    ...driveFormBase,
    id: 'drive-restore',
    fields: {
      node_id: idField(formNodeId(data)),
      return_to: returnField(formReturnTo(data)),
    },
  })
}
