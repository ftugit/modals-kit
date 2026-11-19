import { defineForm, driveFormBase, formNodeId, formReturnTo, idField, returnField } from './shared.js'
import type { DriveFormData } from './shared.js'

export function driveTrashForm(data: DriveFormData = {}) {
  return defineForm({
    ...driveFormBase,
    id: 'drive-trash',
    fields: {
      node_id: idField(formNodeId(data)),
      return_to: returnField(formReturnTo(data)),
    },
  })
}
