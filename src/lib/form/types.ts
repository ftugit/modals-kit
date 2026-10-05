// Словарь понятий. Чистый TypeScript: ни фреймворка, ни DOM, ни HTTP.
//
// Ключи типов значения и представлений — ОТКРЫТЫЕ. Встроенные перечислены
// в интерфейсах ниже, приложение добавляет свои расширением:
//
//     declare module '$lib/form' {
//       interface FieldValues { money: number | null }
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
/** Ключ типа значения. */
export type ValueKind = (keyof FieldValues & string) | (string & {})

/** Представление → как поле выглядит в разметке. Расширяется потребителем. */
export interface InputModes {
  text: true; email: true; password: true; tel: true; url: true; search: true
  color: true; hidden: true; textarea: true; number: true; range: true
  date: true; 'datetime-local': true; time: true
  select: true; multiselect: true; radio: true; checkbox: true
  file: true; files: true
}
/** Ключ представления поля. */
export type InputMode = (keyof InputModes & string) | (string & {})

/** Путь поля в форме. */
export type FieldPath = string
/** Стабильный ключ строки повторяемой группы. */
export type RowKey = string        // выдаёт ядро или сервер, НИКОГДА не индекс массива
/** Идентификатор формы. */
export type FormId = string
/** Идентификатор экземпляра формы на странице. */
export type InstanceId = string
/** Идентификатор отправки. */
export type SubmissionId = string
/** Ревизия описания формы. */
export type Revision = number

/** Словарь HTML-атрибутов, который адаптер разворачивает на элемент. */
export type HtmlAttrs = Record<string, unknown>

/** Корень пути: нужен проверке согласованности состояния. */
export function root(path: FieldPath): string {
  return path.split('.')[0]!
}

/** Индексное представление — ПРОИЗВОДНОЕ. Ошибка адресуется ключом, не индексом. */
export function toIndexPath(path: FieldPath, rowKeys: readonly RowKey[]): string {
  return path.split('.').map((p) => {
    const i = rowKeys.indexOf(p)
    return i === -1 ? p : String(i)
  }).join('.')
}

/** Объекты без прототипа — на всей линии разбора. */
export function safeObject<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>
}
