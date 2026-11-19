import { defineForm, driveFormBase, formNodeId, formReturnTo, idField, returnField } from './shared.js'
import type { DriveFormData } from './shared.js'
import { field } from './shared.js'

export function driveMoveForm(data: DriveFormData = {}) {
  return defineForm({
    ...driveFormBase,
    id: 'drive-move',
    fields: {
      node_id: idField(formNodeId(data)),
      return_to: returnField(formReturnTo(data)),
      target_id: field.hidden({ defaultValue: data.values?.targetId ?? '' }),
    },
  })
}
