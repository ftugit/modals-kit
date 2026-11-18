/**
 * Формы «Диска» (шаги 4d–4g `plan-drive-ui.md`).
 *
 * Одно описание обслуживает и разметку, и серверный разбор POST: без JS это
 * обычные формы с `?/<action>`, с JS — те же поля под `bind`. Скрытые `node_id`
 * и `return_to` проверяются на сервере: адрес возврата берётся только локальный.
 */
import { defineForm, field, v, type FormDescription } from '#core/lib/form/index.js'
import { DRIVE_NAME_MAX } from '#core/lib/drive/index.js'
import { DRIVE_MESSAGES } from './messages.js'
import type { DriveOperationName } from './operations.js'

/** Пункт выбора папки: `null` — корень диска. */
export interface DriveFolderOption {
  readonly id: string | null
  readonly label: string
}

const idField = (value: string) =>
  field.hidden({ defaultValue: value, validate: [v.required(), v.maxLength(36)] })

const returnField = (value: string) =>
  field.hidden({ defaultValue: value, validate: [v.required(), v.maxLength(2048)] })

const folderOptions = (folders: readonly DriveFolderOption[]) =>
  (folders.length > 0 ? folders : [{ id: null, label: 'Корень диска' }]).map((folder) => ({
    value: folder.id ?? '',
    label: folder.label,
  }))

const nameField = (label: string, value = '') =>
  field.text({
    label,
    defaultValue: value,
    validate: [v.required(), v.maxLength(DRIVE_NAME_MAX)],
  })

const base = {
  revision: 1,
  messages: DRIVE_MESSAGES,
}

/** Фильтры списка: обычная GET-форма, поэтому без конверта и действий. */
export function driveFiltersForm(filters: {
  search: string | null
  type: 'all' | 'file' | 'folder'
  sort: string
  starred: boolean
  pageSize: number
  from: string | null
  to: string | null
}) {
  return defineForm({
    ...base,
    id: 'drive-filters',
    fields: {
      'drive.q': field.text({
        label: 'Поиск по имени',
        defaultValue: filters.search ?? '',
        validate: [v.maxLength(DRIVE_NAME_MAX)],
      }),
      'drive.ord': field.select({
        label: 'Сортировка',
        options: [
          { value: 'name', label: 'По имени' },
          { value: 'updated', label: 'По изменению' },
          { value: 'size', label: 'По размеру' },
        ],
        defaultValue: filters.sort,
      }),
      'drive.type': field.select({
        label: 'Тип',
        options: [
          { value: 'all', label: 'Всё' },
          { value: 'folder', label: 'Папки' },
          { value: 'file', label: 'Файлы' },
        ],
        defaultValue: filters.type,
      }),
      'drive.starred': field.checkbox({
        label: 'Только важные',
        defaultValue: filters.starred,
      }),
      'drive.size': field.select({
        label: 'На страницу',
        options: [
          { value: '30', label: '30' },
          { value: '50', label: '50' },
          { value: '100', label: '100' },
        ],
        defaultValue: String(filters.pageSize),
      }),
      'drive.from': field.date({
        label: 'Изменён с',
        defaultValue: filters.from ?? '',
      }),
      'drive.to': field.date({
        label: 'Изменён по',
        defaultValue: filters.to ?? '',
      }),
    },
  })
}

export function driveDavIssueForm(returnTo: string) {
  return defineForm({
    ...base,
    id: 'drive-dav-issue',
    fields: {
      return_to: returnField(returnTo),
      label: field.text({
        label: 'Название пароля',
        placeholder: 'Например, ноутбук',
        validate: [v.required(), v.maxLength(80)],
      }),
    },
  })
}

export function driveDavRevokeForm(tokenId: string, returnTo: string) {
  return defineForm({
    ...base,
    id: 'drive-dav-revoke',
    fields: {
      return_to: returnField(returnTo),
      token_id: idField(tokenId),
    },
  })
}

export function driveMkdirForm(parentId: string | null, returnTo: string) {
  return defineForm({
    ...base,
    id: 'drive-mkdir',
    fields: {
      parent_id: field.hidden({ defaultValue: parentId ?? '' }),
      return_to: returnField(returnTo),
      name: nameField('Название папки'),
    },
  })
}

export function driveUploadForm(parentId: string | null, returnTo: string) {
  return defineForm({
    ...base,
    id: 'drive-upload',
    fields: {
      parent_id: field.hidden({ defaultValue: parentId ?? '' }),
      return_to: returnField(returnTo),
      file: field.file({ label: 'Файл' }),
    },
  })
}

export function driveRenameForm(nodeId: string, name: string, returnTo: string) {
  return defineForm({
    ...base,
    id: 'drive-rename',
    fields: {
      node_id: idField(nodeId),
      return_to: returnField(returnTo),
      name: nameField('Новое название', name),
    },
  })
}

export function driveMoveForm(
  nodeId: string,
  folders: readonly DriveFolderOption[],
  returnTo: string,
  targetId: string | null = null,
) {
  return defineForm({
    ...base,
    id: 'drive-move',
    fields: {
      node_id: idField(nodeId),
      return_to: returnField(returnTo),
      target_id: field.select({
        label: 'Куда перенести',
        options: folderOptions(folders),
        defaultValue: targetId ?? '',
      }),
    },
  })
}

export function driveCopyForm(
  nodeId: string,
  folders: readonly DriveFolderOption[],
  returnTo: string,
  targetId: string | null = null,
) {
  return defineForm({
    ...base,
    id: 'drive-copy',
    fields: {
      node_id: idField(nodeId),
      return_to: returnField(returnTo),
      target_id: field.select({
        label: 'Куда скопировать',
        options: folderOptions(folders),
        defaultValue: targetId ?? '',
      }),
      name: field.text({
        label: 'Название копии',
        defaultValue: '',
        validate: [v.maxLength(DRIVE_NAME_MAX)],
      }),
    },
  })
}

export function driveStarForm(nodeId: string, starred: boolean, returnTo: string) {
  return defineForm({
    ...base,
    id: 'drive-star',
    fields: {
      node_id: idField(nodeId),
      return_to: returnField(returnTo),
      starred: field.hidden({ defaultValue: starred ? '0' : '1' }),
    },
  })
}

export function driveTrashForm(nodeId: string, returnTo: string) {
  return defineForm({
    ...base,
    id: 'drive-trash',
    fields: {
      node_id: idField(nodeId),
      return_to: returnField(returnTo),
    },
  })
}

/**
 * Описание формы операции по строке матрицы (`operations.ts`).
 *
 * Одно и то же описание строят страница и модалка: клиент — с реальными
 * значениями из `load`, регистрация — с пустыми (ревизия и набор полей те же,
 * поэтому серверный разбор совпадает).
 */
export interface DriveOperationValues {
  readonly parentId?: string | null
  readonly returnTo?: string
  readonly nodeId?: string
  readonly name?: string
  readonly starred?: boolean
  readonly folders?: readonly DriveFolderOption[]
  readonly targetId?: string | null
  readonly uid?: string
  readonly role?: string
  readonly tokenId?: string
}

export function driveOperationDescription(
  op: DriveOperationName,
  values: DriveOperationValues = {},
): FormDescription {
  const parentId = values.parentId ?? null
  const returnTo = values.returnTo ?? '/drive'
  const nodeId = values.nodeId ?? ''
  switch (op) {
    case 'mkdir':
      return driveMkdirForm(parentId, returnTo)
    case 'upload':
      return driveUploadForm(parentId, returnTo)
    case 'rename':
      return driveRenameForm(nodeId, values.name ?? '', returnTo)
    case 'move':
      return driveMoveForm(nodeId, values.folders ?? [], returnTo, values.targetId ?? null)
    case 'copy':
      return driveCopyForm(nodeId, values.folders ?? [], returnTo, values.targetId ?? null)
    case 'star':
      return driveStarForm(nodeId, values.starred ?? false, returnTo)
    case 'trash-action':
      return driveTrashForm(nodeId, returnTo)
    case 'restore':
      return driveRestoreForm(nodeId, returnTo)
    case 'purge':
      return drivePurgeForm(nodeId, returnTo)
    case 'share':
      return driveShareForm(nodeId, returnTo)
    case 'unshare':
      return driveUnshareForm(nodeId, values.uid ?? '', returnTo)
    case 'dav-issue':
      return driveDavIssueForm(returnTo)
    case 'dav-revoke':
      return driveDavRevokeForm(values.tokenId ?? '', returnTo)
    case 'filters':
      return driveFiltersForm({
        search: null,
        type: 'all',
        sort: 'name',
        starred: false,
        pageSize: 30,
        from: null,
        to: null,
      })
  }
}

export function driveRestoreForm(nodeId: string, returnTo: string) {
  return defineForm({
    ...base,
    id: 'drive-restore',
    fields: {
      node_id: idField(nodeId),
      return_to: returnField(returnTo),
    },
  })
}

export function drivePurgeForm(nodeId: string, returnTo: string) {
  return defineForm({
    ...base,
    id: 'drive-purge',
    fields: {
      node_id: idField(nodeId),
      return_to: returnField(returnTo),
    },
  })
}

export function driveShareForm(nodeId: string, returnTo: string) {
  return defineForm({
    ...base,
    id: 'drive-share',
    fields: {
      node_id: idField(nodeId),
      return_to: returnField(returnTo),
      uid: field.text({
        label: 'Аккаунт',
        placeholder: 'UUID аккаунта',
        validate: [v.required(), v.maxLength(36)],
      }),
      role: field.select({
        label: 'Роль',
        options: [
          { value: 'viewer', label: 'Просмотр' },
          { value: 'editor', label: 'Редактирование' },
        ],
        defaultValue: 'viewer',
      }),
    },
  })
}

export function driveUnshareForm(nodeId: string, uid: string, returnTo: string) {
  return defineForm({
    ...base,
    id: 'drive-unshare',
    fields: {
      node_id: idField(nodeId),
      uid: idField(uid),
      return_to: returnField(returnTo),
    },
  })
}
