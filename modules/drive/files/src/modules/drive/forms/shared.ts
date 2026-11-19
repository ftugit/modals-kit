import { defineForm, field, v } from '#core/lib/form/index.js'
import { DRIVE_NAME_MAX } from '#core/lib/drive/index.js'
import { DRIVE_MESSAGES } from '../messages.js'
import { driveRootRoute } from '../routes.js'
import type { DriveOperationData } from '../types.js'

/** Общие значения, которые фабрика берёт из загруженных данных (или пусто на сервере). */
export type DriveFormData = Partial<
  Pick<DriveOperationData, 'returnTo' | 'parentId' | 'node' | 'subjectOptions'>
> & {
  readonly values?: Partial<DriveOperationData['values']>
}

export const driveFormBase = { revision: 1, messages: DRIVE_MESSAGES } as const

export const formReturnTo = (data: DriveFormData = {}): string =>
  data.returnTo ?? driveRootRoute.href()

export const formNodeId = (data: DriveFormData = {}): string => data.node?.id ?? ''

export const idField = (value: string) =>
  field.hidden({ defaultValue: value, validate: [v.required(), v.maxLength(36)] })

export const returnField = (value: string) =>
  field.hidden({ defaultValue: value, validate: [v.required(), v.maxLength(2048)] })

export const nameField = (label: string, value = '') =>
  field.text({
    label,
    defaultValue: value,
    validate: [v.required(), v.maxLength(DRIVE_NAME_MAX)],
  })

export const roleField = () =>
  field.select({
    label: 'Роль',
    options: [
      { value: 'viewer', label: 'Просмотр' },
      { value: 'editor', label: 'Редактирование' },
    ],
    defaultValue: 'viewer',
  })

export { defineForm, field, v }
