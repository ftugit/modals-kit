// Изоморфные описания форм демо-страницы `/upload-demo`.
import { defineForm, field, v } from '#lib/form/index.js'

/** Верхний предел одного файла в демо-прототипе (`200 МБ` — в 44 раза выше HTTP-потолка Vercel 4.5 МБ). */
export const DEMO_MAX_UPLOAD_BYTES = 200 * 1024 * 1024

export const uploadBundleForm = defineForm({
  id: 'upload_bundle',
  fields: {
    title: field.text({
      label: 'Название материала',
      placeholder: 'Например, Релизный пакет v2.4',
      validate: [v.required(), v.maxLength(120)],
    }),
    notes: field.textarea({
      label: 'Комментарий',
      placeholder: 'Описание содержимого (отправляется в Кадре 0 до чтения байтов файла)',
      validate: [v.maxLength(500)],
    }),
    bundle: field.file({
      label: 'Файл для потоковой загрузки',
      help: 'С JS передаётся сегментами по 256 КБ по одному wss://-соединению; без JS работает штатный multipart POST.',
      validate: [v.required(), v.maxSize(DEMO_MAX_UPLOAD_BYTES)],
    }),
    verify_integrity: field.checkbox({
      label: 'Проверять целостность потока с одноразовой солью (HMAC-SHA-256 на эту загрузку)',
      defaultValue: true,
    }),
  },
})

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
  readonly filename: string
  readonly contentType: string
  readonly size: number
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

export const deleteUploadFormFor = (initialId = '') =>
  defineForm({
    id: 'upload_delete',
    fields: {
      id: field.hidden({ defaultValue: initialId, validate: [v.required()] }),
    },
  })

export const deleteUploadForm = deleteUploadFormFor()
