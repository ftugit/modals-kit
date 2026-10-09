// Словарь понятий. Чистый TypeScript: ни фреймворка, ни DOM, ни HTTP.
//
// Ключи типов значения и представлений — ОТКРЫТЫЕ. Встроенные перечислены
// в интерфейсах ниже, приложение добавляет свои расширением:
//
//     declare module '$lib/form' {
//       interface FieldValues { rating: number | null }
//     }

/** Тип значения → что он декодирует. Расширяется потребителем. */
export interface FieldValues {
  text: string
  number: number | null
  checkbox: boolean
  date: string | null
  time: string | null
  datetime: string | null
  select: string | null
  multiselect: readonly string[]
  file: File | null
  files: readonly File[]
}
export type ValueKind = (keyof FieldValues & string) | (string & {})

/** Представление → как поле выглядит в разметке. Расширяется потребителем. */
export interface InputModes {
  text: true; email: true; password: true; tel: true; url: true; search: true
  color: true; hidden: true; textarea: true; number: true; range: true
  date: true; 'datetime-local': true; time: true
  select: true; multiselect: true; radio: true; checkbox: true
  file: true; files: true
}
export type InputMode = (keyof InputModes & string) | (string & {})

export type FieldPath = string
export type RowKey = string        // выдаёт ядро или сервер, НИКОГДА не индекс массива
export type FormId = string
export type InstanceId = string
export type SubmissionId = string
export type Revision = number

export type HtmlAttrs = Record<string, unknown>

/**
 * Корень составного пути: `items.r1.sku` → `items`. Нужен проверке
 * согласованности состояния группы.
 * @param path Составной путь поля.
 * @returns Имя корневого сегмента.
 */
export function root(path: FieldPath): string {
  return path.split('.')[0]!
}

/**
 * Индексное представление — ПРОИЗВОДНОЕ. Ошибка адресуется ключом, не индексом.
 * @param path Путь с ключами строк: `items.r1.sku`.
 * @param rowKeys Ключи строк группы в порядке объявления.
 * @returns Путь с индексами строк: `items.0.sku`.
 */
export function toIndexPath(path: FieldPath, rowKeys: readonly RowKey[]): string {
  return path.split('.').map((p) => {
    const i = rowKeys.indexOf(p)
    return i === -1 ? p : String(i)
  }).join('.')
}

/**
 * Объект без прототипа: `__proto__` в нём — обычный ключ.
 * Используется на всей линии разбора чужих данных.
 * @returns Пустой объект с прототипом `null`.
 */
export function safeObject<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>
}
