// Внешние схемы: источник ОШИБОК, но не источник атрибутов.
//
// Словарь правил чужой, и вывод разметки из него был бы догадкой. Поэтому
// схема даёт только ошибки, а ограничения остаются за валидаторами.
import type { FormError } from './result'
import { stableId } from './result'

export interface StandardSchemaLike<T = unknown> {
  readonly '~standard': {
    validate(value: unknown): StandardResult<T> | Promise<StandardResult<T>>
  }
}

/**
 * Issue в формате Standard Schema. Необязательные `code`/`params`/`template`
 * понимаются, если есть: тогда текст берётся из словарей формы по коду (как у
 * своих правил), а `template` — свой текст, сильнее словарей. Так приходят,
 * например, ошибки `lib/db` (`failureIssues`) — без импорта друг друга.
 */
export interface IssueLike {
  readonly message: string
  readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[]
  readonly code?: unknown
  readonly params?: unknown
  readonly template?: unknown
}

export type StandardResult<T> =
  | { readonly value: T; readonly issues?: undefined }
  | { readonly issues: readonly IssueLike[] }

/**
 * Проверка на контракт Standard Schema (`~standard`).
 * @param x Что угодно.
 */
export const isStandardSchema = (x: unknown): x is StandardSchemaLike =>
  !!x && typeof x === 'object' && '~standard' in x

/**
 * Перевести один issue в ошибку формы. Путь склеивается в `path`. Есть строковый
 * `code` — он и параметры идут в словарь; нет — код `schema`, текст как есть.
 * @param i Issue (Standard Schema, возможно с `code`/`params`/`template`).
 * @param origin Откуда ошибка: `core` для схемы формы, `server` для бизнес-действия.
 */
export function issueError(i: IssueLike, origin: FormError['origin'] = 'core'): FormError {
  const path = i.path?.map((p) => String(typeof p === 'object' && p !== null ? p.key : p)).join('.')
  const coded = typeof i.code === 'string' && i.code !== ''
  const code = coded ? (i.code as string) : 'schema'
  const params = coded
    ? (i.params && typeof i.params === 'object' && !Array.isArray(i.params) ? i.params as Record<string, unknown> : undefined)
    : { message: i.message }
  const template = typeof i.template === 'string' ? i.template : undefined
  return {
    id: stableId({ path, code, params }),
    code, message: i.message,
    ...(params ? { params } : {}),
    ...(template !== undefined ? { template } : {}),
    path: path || undefined, origin,
  }
}

/**
 * Перевести issues схемы в ошибки формы (см. `issueError`).
 * @param result Результат `~standard.validate`.
 */
export function schemaErrors(result: StandardResult<unknown>): FormError[] {
  if (!result.issues) return []
  return result.issues.map((i) => issueError(i))
}

/** Прогон схемы над значениями формы. Асинхронные схемы тоже допустимы. */
/**
 * Прогнать внешнюю схему над значениями формы: источник ошибок, но не атрибутов.
 * @param schema Схема с контрактом Standard Schema.
 * @param values Значения формы.
 */
export async function runSchema(
  schema: StandardSchemaLike, values: Record<string, unknown>,
): Promise<FormError[]> {
  return schemaErrors(await schema['~standard'].validate(values))
}
