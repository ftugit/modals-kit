// Реактивная проекция посегментного прогресса `form.state.progress` на карточки `FileAttachment`.
//
// Модуль живёт в `src/hooks/component-form` и не импортирует `src/components/*`:
// возвращаемая мета-структура структурно совместима с `FileAttachmentItemMeta`.
import { SvelteMap } from 'svelte/reactivity'
import type { BoundForm } from '#lib/form/svelte/index.js'
import type { FileUploadProgressEntry, FormUploadProgress } from './ws-protocol.js'

export interface UploadAttachmentMeta {
  readonly state?: 'uploading' | 'processing' | 'done' | 'error'
  readonly progress?: number | null
  readonly description?: string
}

const formsByFieldDomId = new SvelteMap<string, BoundForm>()

function isFormUploadProgress(value: unknown): value is FormUploadProgress {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'ws-upload' &&
    Array.isArray((value as { files?: unknown }).files)
  )
}

function formatBytesRu(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} ГБ`
}

function formatEntryDescription(entry: FileUploadProgressEntry): string {
  if (entry.state === 'processing') {
    return `Сохранение на сервере · ${entry.totalSegments}/${entry.totalSegments} сегм.`
  }
  if (entry.state === 'done') {
    return `Загружено · ${formatBytesRu(entry.size)}`
  }
  if (entry.totalSegments > 0) {
    return `Сегмент ${Math.min(entry.sentSegments + 1, entry.totalSegments)}/${entry.totalSegments} · ${formatBytesRu(entry.receivedBytes)} из ${formatBytesRu(entry.size)}`
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
      description: formatEntryDescription(matched),
    }
  }
}
