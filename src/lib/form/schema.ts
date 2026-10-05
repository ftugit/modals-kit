// Внешние схемы: источник ОШИБОК, но не источник атрибутов.
//
// Словарь правил чужой, и вывод разметки из него был бы догадкой. Поэтому
// схема даёт только ошибки, а ограничения остаются за валидаторами.
import type { FormError } from './result'
import { stableId } from './result'

/** Минимальный контракт Standard Schema-подобного валидатора. */
export interface StandardSchemaLike<T = unknown> {
  readonly '~standard': {
    validate(value: unknown): StandardResult<T> | Promise<StandardResult<T>>
  }
}

/** Результат Standard Schema-подобной проверки. */
export type StandardResult<T> =
  | { readonly value: T; readonly issues?: undefined }
  | { readonly issues: readonly {
        readonly message: string
        readonly path?: readonly (string | { key: string })[]
      }[] }

/** Проверяет, похож ли объект на Standard Schema. */
export const isStandardSchema = (x: unknown): x is StandardSchemaLike =>
  !!x && typeof x === 'object' && '~standard' in x

/** Преобразует issues схемы в FormError. */
export function schemaErrors(result: StandardResult<unknown>): FormError[] {
  if (!result.issues) return []
  return result.issues.map((i) => {
    const path = i.path?.map((p) => (typeof p === 'string' ? p : p.key)).join('.')
    return {
      id: stableId({ path, code: 'schema', params: { message: i.message } }),
      code: 'schema', message: i.message, params: { message: i.message },
      path: path || undefined, origin: 'core' as const,
    }
  })
}

/** Прогон схемы над значениями формы. Асинхронные схемы тоже допустимы. */
export async function runSchema(
  schema: StandardSchemaLike, values: Record<string, unknown>,
): Promise<FormError[]> {
  return schemaErrors(await schema['~standard'].validate(values))
}
