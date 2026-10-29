// Изоморфные описания форм демо-страницы `/upload-demo`.
import { image } from '#components/form/image.js'
import { defineForm, field, v, type ValidatorRef } from '#lib/form/index.js'
import type {
  StorageCloneReport,
  StorageProbeResult,
  StorageReport,
} from '#lib/storage/index.js'
import type { StorageTelemetrySnapshot } from '#lib/storage/state.js'
import type { UploadDemoValues } from './demo-schema.js'

const MB = 1024 * 1024

export const DEMO_MAX_UPLOAD_BYTES = 200 * MB

export function createUploadBundleForm(panel?: Partial<UploadDemoValues>) {
  const maxMb = Number(panel?.max_mb ?? '200')
  const maxBytes = (Number.isFinite(maxMb) && maxMb > 0 ? maxMb : 200) * MB
  const acceptMode = panel?.accept ?? 'any'
  const multiple = Boolean(panel?.multiple)
  const defaultIntegrity = panel?.integrity !== undefined ? Boolean(panel.integrity) : true

  const fileValidators: ValidatorRef[] = [v.required(), v.maxSize(maxBytes)]
  if (multiple) {
    fileValidators.push(v.maxCount(3))
  }
  if (acceptMode === 'images') {
    fileValidators.push(v.accept(['image/png', 'image/jpeg', 'image/webp']), image())
  } else if (acceptMode === 'pdf_zip') {
    fileValidators.push(v.accept(['application/pdf', 'application/zip', '.pdf', '.zip']))
  }

  return defineForm({
    id: 'upload_bundle',
    fields: {
      title: field.text({
        label: 'Название материала',
        placeholder: 'Например, Релизный пакет v2.4',
        validate: [v.required(), v.maxLength(120)],
      }),
      custom_path: field.text({
        label: 'Собственный путь в хранилище (необязательно, для проверки overwrite)',
        placeholder: 'Например, releases/v2.bin (пусто — уникальный demo/<uuid>-...)',
        validate: [v.maxLength(140)],
      }),
      notes: field.textarea({
        label: 'Комментарий',
        placeholder: 'Описание содержимого (отправляется в Кадре 0 до чтения байтов файла)',
        validate: [v.maxLength(500)],
      }),
      bundle: field.file({
        multiple,
        label: multiple
          ? 'Файлы для потоковой загрузки (до 3 шт.)'
          : 'Файл для потоковой загрузки',
        help: 'С JS передаётся сегментами по 256 КБ по одному wss://-соединению; без JS работает штатный multipart POST.',
        validate: fileValidators,
      }),
      allow_overwrite: field.checkbox({
        label: 'Разрешить перезапись при совпадении пути (overwrite: true)',
        defaultValue: true,
      }),
      verify_integrity: field.checkbox({
        label: 'Проверять целостность потока с одноразовой солью (HMAC-SHA-256 на эту загрузку)',
        defaultValue: defaultIntegrity,
      }),
    },
  })
}

export const uploadBundleForm = createUploadBundleForm()

/** Текстовая форма без файлов: доказывает сохранение обычного HTTP fetch-транспорта. */
export const quickNoteForm = defineForm({
  id: 'upload_quick_note',
  fields: {
    message: field.text({
      label: 'Быстрая заметка (без файла → обычный HTTP fetch)',
      placeholder: 'Текст заметки…',
      validate: [v.required(), v.maxLength(200)],
    }),
  },
})

export interface UploadedDemoRecord {
  readonly id: string
  readonly title: string
  readonly notes: string
  readonly path: string
  readonly server: string
  readonly filename: string
  readonly contentType: string
  readonly size: number
  readonly storedBytes?: number
  readonly encrypted?: boolean
  readonly partsCount?: number
  readonly firstPartBytes?: number
  readonly partServers?: readonly string[]
  readonly replicas?: readonly string[]
  readonly url: string
  readonly transport: 'ws' | 'http'
  readonly integrityVerified?: boolean
  readonly createdAt: string
}

export interface QuickNoteRecord {
  readonly id: string
  readonly message: string
  readonly createdAt: string
}

export type {
  StorageCloneReport,
  StorageReport,
  StorageTelemetrySnapshot,
}

export const cloneServerFormFor = (fromServer = 'local', toServer = 'memory') =>
  defineForm({
    id: 'upload_clone_server',
    fields: {
      from_server: field.hidden({
        defaultValue: fromServer,
        validate: [v.required(), v.maxLength(32)],
      }),
      to_server: field.hidden({
        defaultValue: toServer,
        validate: [v.required(), v.maxLength(32)],
      }),
    },
  })

export const cloneServerForm = cloneServerFormFor()

export const copyUploadFormFor = (initialId = '', targetServer = 'memory') =>
  defineForm({
    id: 'upload_copy_replica',
    fields: {
      id: field.hidden({ defaultValue: initialId, validate: [v.required()] }),
      to_server: field.hidden({ defaultValue: targetServer, validate: [v.required()] }),
    },
  })

export const copyUploadForm = copyUploadFormFor()

export const transferUploadFormFor = (initialId = '', targetServer = 'local') =>
  defineForm({
    id: 'upload_transfer',
    fields: {
      id: field.hidden({ defaultValue: initialId, validate: [v.required()] }),
      to_server: field.hidden({ defaultValue: targetServer, validate: [v.required()] }),
    },
  })

export const transferUploadForm = transferUploadFormFor()

export const deleteUploadFormFor = (initialId = '') =>
  defineForm({
    id: 'upload_delete',
    fields: {
      id: field.hidden({ defaultValue: initialId, validate: [v.required()] }),
    },
  })

export const deleteUploadForm = deleteUploadFormFor()
