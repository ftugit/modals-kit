import { defineForm, driveFormBase, formNodeId, formReturnTo, idField, returnField } from './shared.js'
import type { DriveFormData } from './shared.js'
import { field } from './shared.js'

export function driveStarForm(data: DriveFormData = {}) {
  return defineForm({
    ...driveFormBase,
    id: 'drive-star',
    fields: {
      node_id: idField(formNodeId(data)),
      return_to: returnField(formReturnTo(data)),
      starred: field.hidden({ defaultValue: data.node?.starred ? '0' : '1' }),
    },
  })
}
