// Стратегия файлов.
//
// inline    — файл идёт в теле формы, ограничен пределами приёма. Работает БЕЗ скрипта.
// reference — поле хранит идентификатор заранее загруженного файла; загрузка
//             идёт отдельной точкой. Без скрипта деградирует в inline, потому
//             что отдельная загрузка требует скрипта. Это документированная
//             деградация, и предел тела для такой формы обязан быть достаточным.
//
// Индикатор прогресса существует только в режиме reference при скрипте:
// нативная отправка его не даёт.
/** Способ передачи файла: inline или reference. */
export type UploadMode = 'inline' | 'reference'

/** Политика загрузки файлов. */
export interface UploadStrategy {
  readonly mode: UploadMode
  readonly maxBytes: number
  /** Точка загрузки для режима reference. */
  readonly endpoint?: string
}

/** Стратегия inline-загрузки по умолчанию. */
export const INLINE: UploadStrategy = { mode: 'inline', maxBytes: 8 * 1024 * 1024 }

/** Сериализуемая ссылка на загруженный файл. */
export interface UploadRef { readonly fileId: string; readonly name: string; readonly size: number }

/** Проверяет, является ли значение UploadRef. */
export const isUploadRef = (x: unknown): x is UploadRef =>
  !!x && typeof x === 'object' && typeof (x as UploadRef).fileId === 'string'

/** Решает АДАПТЕР: без скрипта отдельная загрузка невозможна. */
export const effectiveMode = (s: UploadStrategy, canUpload: boolean): UploadMode =>
  s.mode === 'reference' && canUpload ? 'reference' : 'inline'
