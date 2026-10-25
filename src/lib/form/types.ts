// Словарь понятий. Чистый TypeScript: ни фреймворка, ни DOM, ни HTTP.
//
// Ключи типов значения и представлений — ОТКРЫТЫЕ. Встроенные перечислены
// в интерфейсах ниже, приложение добавляет свои расширением:
//
//     declare module '#lib/form/index.js' {
//       interface FieldValues { rating: number | null }
//     }
import type { FieldSetItem } from './kit'

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
  /** Файл или список файлов: список — то же значение при `multiple: true`. */
  file: File | readonly File[] | null
  /** Поля, которые собрал пользователь (`field.fields`). */
  fields: readonly FieldSetItem[]
}
/** Вид значения поля: известное имя из `FieldValues` или своё, зарегистрированное приложением. */
export type ValueKind = (keyof FieldValues & string) | (string & {})

/** Представление → как поле выглядит в разметке. Расширяется потребителем. */
export interface InputModes {
  text: true; email: true; password: true; tel: true; url: true; search: true
  color: true; hidden: true; textarea: true; number: true; range: true
  date: true; 'datetime-local': true; time: true
  select: true; multiselect: true; radio: true; checkbox: true; switch: true
  file: true
  /** Одноразовый код: строка цифр, ячейки рисует компонент приложения. */
  otp: true
  /** Набор полей от пользователя: места расставляет разметка приложения (`fieldSet`). */
  fields: true
}
/** Режим ввода (`inputmode`): известное имя или своё. */
export type InputMode = (keyof InputModes & string) | (string & {})

/** Путь поля в описании формы — имя поля верхнего уровня. */
export type FieldPath = string
/** Идентификатор формы: `[a-z][a-z0-9_-]{0,31}` (иначе конверт отвергается). */
export type FormId = string
/** Идентификатор экземпляра формы (`<formId>:<метка>`): им форма отличает свои результаты. */
export type InstanceId = string
/** Идентификатор отправки: связывает результат с конкретным нажатием кнопки. */
export type SubmissionId = string
/** Ревизия описания: клиент присылает её в конверте, сервер выбирает описание по ней. */
export type Revision = number

/** Атрибуты разметки, выведенные из ограничений (`required`, `pattern`, `min`…). */
export type HtmlAttrs = Record<string, unknown>

/**
 * Объект без прототипа: `__proto__` в нём — обычный ключ.
 * Используется на всей линии разбора чужих данных.
 * @returns Пустой объект с прототипом `null`.
 */
export function safeObject<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>
}
