import { defineForm, driveFormBase, formReturnTo, field, idField, returnField } from './shared.js'
import type { DriveFormData } from './shared.js'
import { v } from './shared.js'

export function driveDavIssueForm(data: DriveFormData = {}) {
  return defineForm({
    ...driveFormBase,
    id: 'drive-dav-issue',
    fields: {
      return_to: returnField(formReturnTo(data)),
      label: field.text({
        label: 'Название пароля',
        placeholder: 'Например, ноутбук',
        validate: [v.required(), v.maxLength(80)],
      }),
    },
  })
}

export function driveDavRevokeForm(data: DriveFormData = {}) {
  return defineForm({
    ...driveFormBase,
    id: 'drive-dav-revoke',
    fields: {
      return_to: returnField(formReturnTo(data)),
      token_id: idField(data.values?.tokenId ?? ''),
    },
  })
}
