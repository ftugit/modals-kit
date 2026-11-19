import { defineForm, driveFormBase, formReturnTo, field, nameField, returnField } from './shared.js'
import type { DriveFormData } from './shared.js'

export function driveMkdirForm(data: DriveFormData = {}) {
  return defineForm({
    ...driveFormBase,
    id: 'drive-mkdir',
    fields: {
      parent_id: field.hidden({ defaultValue: data.parentId ?? '' }),
      return_to: returnField(formReturnTo(data)),
      name: nameField('Название папки'),
    },
  })
}
