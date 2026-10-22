export type AttachmentKind =
  | 'document'
  | 'image'
  | 'video'
  | 'audio'
  | 'archive'
  | 'code'
  | 'file'

export type AttachmentState = 'idle' | 'uploading' | 'processing' | 'error' | 'done'
export type AttachmentLayout = 'row' | 'tile'
export type AttachmentSize = 'sm' | 'md' | 'lg'
export type AttachmentMediaMode = 'auto' | 'icon' | 'image'
export type AttachmentProgressVariant = 'strip' | 'background'
export type AttachmentSelectionMode = 'none' | 'single' | 'multiple'

/**
 * Доменное описание одного вложения для отображения.
 * Не смешивается со значением поля формы (`AttachmentOption.value`).
 */
export interface AttachmentItem {
  id: string
  filename: string
  description?: string
  byteSize?: number
  mimeType?: string
  kind?: AttachmentKind
  /** Доверенный URL превью уже сохранённого вложения (только для `<img src>`). */
  previewUrl?: string
  alt?: string
  state?: AttachmentState
  /** Прогресс `0…100`; `null`/`undefined` в состоянии загрузки/обработки — indeterminate. */
  progress?: number | null
  error?: string
}

/**
 * Опция выбора существующего вложения в форме (по образцу `SelectOption`).
 * `value` — всегда стабильный строковый идентификатор, никогда не `previewUrl` и не JSON объекта.
 */
export interface AttachmentOption<T = AttachmentItem> {
  value: string
  label: string
  hint?: string
  disabled?: boolean
  item?: T
}

export interface NormalizeAttachmentInput {
  file?: File
  item?: AttachmentItem
  option?: AttachmentOption
  id?: string
  filename?: string
  description?: string
  byteSize?: number
  mimeType?: string
  kind?: AttachmentKind
  previewUrl?: string
  alt?: string
  state?: AttachmentState
  progress?: number | null
  error?: string
  value?: string
  disabled?: boolean
}

export interface NormalizedAttachment {
  key: string
  filename: string
  label: string
  sizeText?: string
  description?: string
  kind: AttachmentKind
  kindLabel: string
  state: AttachmentState
  stateLabel: string
  progress: number | null
  error?: string
  remotePreviewUrl?: string
  localFile?: File
  alt: string
  option: AttachmentOption
}

export const ATTACHMENT_KIND_LABELS: Record<AttachmentKind, string> = {
  document: 'Документ',
  image: 'Изображение',
  video: 'Видео',
  audio: 'Аудио',
  archive: 'Архив',
  code: 'Код',
  file: 'Файл',
}

export const ATTACHMENT_STATE_LABELS: Record<AttachmentState, string> = {
  idle: 'Ожидает',
  uploading: 'Загрузка',
  processing: 'Обработка',
  error: 'Ошибка',
  done: 'Готово',
}

const EXT_KIND: Record<string, AttachmentKind> = {
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  gif: 'image',
  avif: 'image',
  svg: 'image',
  bmp: 'image',
  ico: 'image',
  mp4: 'video',
  webm: 'video',
  mov: 'video',
  mkv: 'video',
  avi: 'video',
  mp3: 'audio',
  wav: 'audio',
  ogg: 'audio',
  flac: 'audio',
  m4a: 'audio',
  aac: 'audio',
  opus: 'audio',
  zip: 'archive',
  tar: 'archive',
  gz: 'archive',
  tgz: 'archive',
  bz2: 'archive',
  xz: 'archive',
  '7z': 'archive',
  rar: 'archive',
  js: 'code',
  mjs: 'code',
  cjs: 'code',
  ts: 'code',
  mts: 'code',
  tsx: 'code',
  jsx: 'code',
  svelte: 'code',
  vue: 'code',
  json: 'code',
  yaml: 'code',
  yml: 'code',
  toml: 'code',
  html: 'code',
  css: 'code',
  sql: 'code',
  py: 'code',
  rs: 'code',
  go: 'code',
  sh: 'code',
  xml: 'code',
  pdf: 'document',
  doc: 'document',
  docx: 'document',
  xls: 'document',
  xlsx: 'document',
  ppt: 'document',
  pptx: 'document',
  odt: 'document',
  ods: 'document',
  csv: 'document',
  rtf: 'document',
  txt: 'document',
  md: 'document',
}

const CODE_MIMES = new Set([
  'application/json',
  'application/ld+json',
  'application/javascript',
  'text/javascript',
  'application/typescript',
  'application/xml',
  'text/xml',
  'text/html',
  'text/css',
  'application/sql',
  'application/x-sh',
])

const ARCHIVE_MIMES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/gzip',
  'application/x-gzip',
  'application/x-tar',
  'application/x-7z-compressed',
  'application/vnd.rar',
  'application/x-rar-compressed',
  'application/x-bzip2',
  'application/x-xz',
])

const DOC_MIMES = new Set([
  'application/pdf',
  'application/rtf',
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
])

/**
 * Определяет категорию отображения вложения по заявленному MIME и расширению.
 * Используется ТОЛЬКО для выбора значка/подписи UI и не является проверкой содержимого.
 */
export function inferAttachmentKind(mimeType?: string, filename?: string): AttachmentKind {
  const mime = mimeType?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  if (mime) {
    if (mime.startsWith('image/')) return 'image'
    if (mime.startsWith('video/')) return 'video'
    if (mime.startsWith('audio/')) return 'audio'
    if (ARCHIVE_MIMES.has(mime)) return 'archive'
    if (CODE_MIMES.has(mime)) return 'code'
    if (DOC_MIMES.has(mime) || mime.startsWith('application/vnd.openxmlformats-officedocument') || mime.startsWith('application/vnd.oasis.opendocument')) {
      return 'document'
    }
  }
  const clean = filename?.trim() ?? ''
  const dot = clean.lastIndexOf('.')
  if (dot > 0 && dot < clean.length - 1) {
    const ext = clean.slice(dot + 1).toLowerCase()
    if (ext in EXT_KIND) return EXT_KIND[ext]!
  }
  if (mime.startsWith('text/')) return 'document'
  return 'file'
}

/** Человекочитаемый размер файла в байтах (русские единицы проекта). */
export function formatAttachmentBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 Б'
  if (bytes < 1024) return `${Math.round(bytes)} Б`
  if (bytes < 1048576) return `${Math.round(bytes / 1024)} КиБ`
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} МиБ`
  return `${(bytes / 1073741824).toFixed(1)} ГиБ`
}

/** Приводит прогресс к диапазону `0…100`, либо `null` (indeterminate / не задан). */
export function clampProgress(progress: number | null | undefined): number | null {
  if (progress === null || progress === undefined || Number.isNaN(progress)) return null
  return Math.min(100, Math.max(0, Math.round(progress)))
}

/** Строит формовую `AttachmentOption` из доменного `AttachmentItem`. */
export function toAttachmentOption<
  T extends Pick<AttachmentItem, 'id' | 'filename' | 'byteSize' | 'description'>,
>(
  item: T,
  overrides?: Partial<Omit<AttachmentOption<T>, 'item'>>,
): AttachmentOption<T> {
  const hint =
    overrides?.hint ??
    item.description ??
    (item.byteSize !== undefined ? formatAttachmentBytes(item.byteSize) : undefined)
  return {
    value: overrides?.value ?? item.id,
    label: overrides?.label || item.filename || item.id,
    hint,
    disabled: overrides?.disabled,
    item,
  }
}

/**
 * Чистое переключение выбранных строковых ID вложений:
 * - `multiple` добавляет/убирает `value` без дублей;
 * - `single` устанавливает единственный `[value]` (как нативный radio).
 */
export function toggleAttachmentValue(
  selected: readonly string[],
  value: string,
  mode: 'single' | 'multiple',
  disabled = false,
): string[] {
  if (disabled) return [...selected]
  if (mode === 'single') return [value]
  return selected.includes(value)
    ? selected.filter((v) => v !== value)
    : [...selected, value]
}

/** Возвращает элементы коллекции, чьи `id` входят в `values`, сохраняя порядок `items`. */
export function selectedItemsByValues<T extends { id: string }>(
  items: readonly T[],
  values: readonly string[],
): T[] {
  const set = new Set(values)
  return items.filter((item) => set.has(item.id))
}

function sanitizeDomKey(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned || 'item'
}

/**
 * Единая нормализация входа `Attachment`: локальный `File`, `AttachmentItem`
 * или плоские пропы (`filename`, `byteSize`, `mimeType`, …).
 */
export function normalizeAttachment(input: NormalizeAttachmentInput): NormalizedAttachment {
  const { file, item, option } = input
  const filename =
    input.filename ??
    item?.filename ??
    file?.name ??
    option?.label ??
    'Без названия'
  const mimeType = input.mimeType ?? item?.mimeType ?? file?.type
  const byteSize = input.byteSize ?? item?.byteSize ?? file?.size
  const kind = input.kind ?? item?.kind ?? inferAttachmentKind(mimeType, filename)
  const error = input.error ?? item?.error
  const state: AttachmentState =
    input.state ?? (error ? 'error' : item?.state ?? 'done')
  const progress = clampProgress(input.progress !== undefined ? input.progress : item?.progress)
  const sizeText = byteSize !== undefined ? formatAttachmentBytes(byteSize) : undefined
  const description = input.description ?? item?.description ?? option?.hint
  const rawValue = input.value ?? option?.value ?? item?.id ?? input.id ?? filename
  const label = option?.label?.trim() || filename.trim() || rawValue
  const disabled = Boolean(input.disabled || option?.disabled)

  return {
    key: sanitizeDomKey(input.id ?? item?.id ?? option?.value ?? filename),
    filename,
    label,
    sizeText,
    description,
    kind,
    kindLabel: ATTACHMENT_KIND_LABELS[kind],
    state,
    stateLabel: ATTACHMENT_STATE_LABELS[state],
    progress,
    error,
    // Источник превью различается строго по типу входа (`File` vs строковый URL в `item`/`previewUrl`).
    remotePreviewUrl: file ? undefined : (input.previewUrl ?? item?.previewUrl),
    localFile: file,
    alt: input.alt ?? item?.alt ?? '',
    option: {
      value: String(rawValue),
      label,
      hint: option?.hint ?? description ?? sizeText,
      disabled,
      item,
    },
  }
}
