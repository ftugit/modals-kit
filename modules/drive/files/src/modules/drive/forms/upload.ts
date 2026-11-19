import { defineForm, driveFormBase, formReturnTo, field, returnField } from './shared.js'
import type { DriveFormData } from './shared.js'

export function driveUploadForm(data: DriveFormData = {}) {
  return defineForm({
    ...driveFormBase,
    id: 'drive-upload',
    fields: {
      parent_id: field.hidden({ defaultValue: data.parentId ?? '' }),
      return_to: returnField(formReturnTo(data)),
      file: field.file({ label: 'Файл' }),
    },
  })
}
