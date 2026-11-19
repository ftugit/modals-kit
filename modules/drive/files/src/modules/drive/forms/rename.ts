import { defineForm, driveFormBase, formNodeId, formReturnTo, idField, nameField, returnField } from './shared.js'
import type { DriveFormData } from './shared.js'

export function driveRenameForm(data: DriveFormData = {}) {
  return defineForm({
    ...driveFormBase,
    id: 'drive-rename',
    fields: {
      node_id: idField(formNodeId(data)),
      return_to: returnField(formReturnTo(data)),
      name: nameField('Новое название', data.node?.name ?? ''),
    },
  })
}
