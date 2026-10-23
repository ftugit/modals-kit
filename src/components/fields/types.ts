import type { Snippet } from 'svelte'
import type { FieldSetItem, FormDescription, Result } from '#lib/form/index.js'
import type { BoundForm } from '#lib/form/svelte/index.js'

export interface SchemaBuilderLabels {
  readonly label?: string
  readonly kind?: string
  readonly rules?: string
}

export interface SchemaBuilderProps {
  /** Описание формы с полем `field.fields` (например, `collectionForm(saved, limit)`). */
  description: FormDescription
  /** Имя поля набора в `description.fields` (по умолчанию `'props'`). */
  name?: string
  /** HTML `id` тега `<form>` (по умолчанию `description.id`). */
  formId?: string
  /** Подпись кнопки отправки. */
  submitLabel?: string
  /** `data-testid` кнопки отправки. */
  submitTestId?: string
  /** Заголовок блока общих ошибок формы. */
  errorTitle?: string
  /** Подписи внутренних колонок конструктора (`label`, `kind`, `rules`). */
  labels?: SchemaBuilderLabels
  /** Человекочитаемые названия правил валидации. */
  ruleLabels?: Readonly<Record<string, string>>
  /** Плейсхолдер названия поля. */
  placeholder?: string
  /** Ключ блокировки навигации шагов в `page.state`. */
  lockStateKey?: string
  /** Вызывается при применённом сохранении набора (`outcome !== 'not-applied'`). */
  onSuccess?: (result: Result) => void
  class?: string
}

export interface SchemaFieldsProps {
  /** Описание формы записи (`defineForm({ from, fields })`). */
  description: FormDescription
  /** HTML `id` тега `<form>` (по умолчанию `description.id`). */
  formId?: string
  /** Подпись кнопки отправки. */
  submitLabel?: string
  /** `data-testid` кнопки отправки. */
  submitTestId?: string
  /** Заголовок блока общих ошибок формы. */
  errorTitle?: string
  /** Ключ блокировки навигации шагов в `page.state`. */
  lockStateKey?: string
  /** Вызывается при успешном сохранении записи (`outcome !== 'not-applied'`). */
  onSuccess?: (result: Result) => void
  /** Дополнительные статические поля записи (заголовок, обложка и т.д.) внутри той же формы. */
  extraFields?: Snippet<[BoundForm]>
  class?: string
}

export interface SchemaValuesProps {
  /** Схема полей набора, по которой берутся подписи и порядок ключей. */
  fields: readonly FieldSetItem[]
  /** Сохранённые значения записи по ключам полей схемы. */
  values: Readonly<Record<string, unknown>>
  /** Символ прочерка для пустых значений. */
  emptyText?: string
  class?: string
}
