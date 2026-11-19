import { defineForm, driveFormBase, formNodeId, formReturnTo, idField, returnField } from './shared.js'
import type { DriveFormData } from './shared.js'

export function driveUnshareForm(data: DriveFormData = {}) {
  return defineForm({
    ...driveFormBase,
    id: 'drive-unshare',
    fields: {
      node_id: idField(formNodeId(data)),
      uid: idField(data.values?.uid ?? ''),
      return_to: returnField(formReturnTo(data)),
    },
  })
}
