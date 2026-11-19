import { defineForm, driveFormBase, formNodeId, formReturnTo, idField, returnField, roleField } from './shared.js'
import type { DriveFormData } from './shared.js'
import { field } from './shared.js'

export function driveShareForm(data: DriveFormData = {}) {
  const options = data.subjectOptions ?? []
  return defineForm({
    ...driveFormBase,
    id: 'drive-share',
    fields: {
      node_id: idField(formNodeId(data)),
      return_to: returnField(formReturnTo(data)),
      subjects: field.multiselect({
        label: 'Получатели',
        options,
        defaultValue: data.values?.subjects ?? [],
      }),
      role: roleField(),
    },
  })
}
