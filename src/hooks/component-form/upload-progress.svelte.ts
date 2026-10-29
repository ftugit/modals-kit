// Реактивная проекция потокового прогресса `form.state.progress` на карточки `FileAttachment` / `Attachment`.
//
// Модуль живёт в `src/hooks/component-form` и не импортирует `src/components/*`:
// возвращаемая мета-структура структурно совместима с `FileAttachmentItemMeta`.
import { SvelteMap } from 'svelte/reactivity'
import type { BoundForm } from '#lib/form/svelte/index.js'
import { formatUploadBytesRu, formatUploadSpeedRu } from './upload-eta.js'
import type { FileUploadProgressEntry, FormUploadProgress } from './ws-protocol.js'

export interface UploadAttachmentMeta {
  readonly state?: 'uploading' | 'processing' | 'done' | 'error'
  readonly progress?: number | null
  readonly description?: string
}

const formsByFieldDomId = new SvelteMap<string, BoundForm>()

export function isFormUploadProgress(value: unknown): value is FormUploadProgress {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'ws-upload' &&
    Array.isArray((value as { files?: unknown }).files)
  )
}

export function formatEntryUploadDescription(entry: FileUploadProgressEntry): string {
  const hmacSuffix = entry.salted ? ' · HMAC' : ''
  const speed = formatUploadSpeedRu(entry.bytesPerSecond)
  const speedPart = speed ? ` · ${speed}` : ''
  if (entry.state === 'processing') {
    return `Сохранение на сервере · ${formatUploadBytesRu(entry.size)}${speedPart}${hmacSuffix}`
  }
  if (entry.state === 'done') {
    return `Загружено · ${formatUploadBytesRu(entry.size)}${hmacSuffix}`
  }
  if (entry.size > 0) {
    return `${formatUploadBytesRu(entry.receivedBytes)} из ${formatUploadBytesRu(entry.size)}${speedPart}${hmacSuffix}`
  }
  return 'Подготовка…'
}

/**
 * Привязать файловые поля формы к реактивному реестру прогресса на время жизни компонента.
 */
export function registerFormUploadFields(form: BoundForm): () => void {
  const registeredIds: string[] = []
  for (const fieldDef of form.description.fields) {
    if (fieldDef.input !== 'file') continue
    const view = form.f[fieldDef.name]
    const domId = typeof view?.attrs?.id === 'string' ? view.attrs.id : ''
    if (domId) {
      formsByFieldDomId.set(domId, form)
      registeredIds.push(domId)
    }
  }
  return () => {
    for (const id of registeredIds) {
      if (formsByFieldDomId.get(id) === form) {
        formsByFieldDomId.delete(id)
      }
    }
  }
}

/**
 * Построить функцию `itemProps(file, index)` для `FileAttachment` по `attrs.id` и имени поля.
 * Возвращает `undefined`, когда форма не в состоянии потоковой загрузки.
 */
export function uploadItemPropsForField(
  fieldDomId: string | undefined,
  fieldName: string,
): ((file: File, index: number) => UploadAttachmentMeta | undefined) | undefined {
  if (!fieldDomId) return undefined
  const form = formsByFieldDomId.get(fieldDomId)
  if (!form || !form.state.pending) return undefined
  const progress = form.state.progress
  if (!isFormUploadProgress(progress)) return undefined

  const fieldEntries = progress.files.filter((e) => e.field === fieldName)
  if (fieldEntries.length === 0) return undefined

  return (file: File, index: number): UploadAttachmentMeta | undefined => {
    const matched =
      fieldEntries[index] ??
      fieldEntries.find((e) => e.name === file.name && e.size === file.size)
    if (!matched) return undefined
    return {
      state: matched.state,
      progress: matched.progress,
      description: formatEntryUploadDescription(matched),
    }
  }
}
