// Метка «значение проверено этой схемой» — договорённость с `lib/db` без импорта.
//
// Тип и ключ скопированы в обе библиотеки (как сам контракт Standard Schema), а не
// вынесены в третий пакет. Совпадение держат тесты договорённости с каждой стороны:
// `proof.test.ts` здесь и `src/lib/db/proof.test.ts` проверяют одну и ту же форму данных.
//
// Метка — только способ не повторять проверку. Нет метки, другая схема, другое значение —
// БД проверяет всё сама. Метка не переживает копию объекта (`{...values}`, JSON, очередь):
// это безопасно, получатель просто проверит заново. Через HTTP метку не передают никогда.

/** Ключ метки. Версия в имени: несовместимая форма данных получит новый ключ. */
export const VALIDATED_PROOF: unique symbol = Symbol.for('modals-kit.validated-proof.v1') as never

/** Что проверено: поле → объект схемы, которой проверено, и проверенное значение. */
export interface ValidatedProof {
  readonly fields: Readonly<Record<string, { readonly schema: object; readonly value: unknown }>>
}

/**
 * Поставить метку на объект значений. Ключ — символ, свойство неперечисляемое и
 * только для чтения: в `Object.keys`, JSON и копию оно не попадает.
 * @param values Объект значений, который получит обработчик.
 * @param fields Проверенные поля.
 * @returns Тот же объект.
 */
export function stampProof<T extends object>(values: T, fields: ValidatedProof['fields']): T {
  const proof: ValidatedProof = Object.freeze({ fields: Object.freeze({ ...fields }) })
  Object.defineProperty(values, VALIDATED_PROOF, { value: proof, enumerable: false, writable: false, configurable: false })
  return values
}

/**
 * Прочитать метку. Чужая форма данных — `undefined`, как будто метки нет.
 * @param values Что угодно.
 */
export function readProof(values: unknown): ValidatedProof | undefined {
  if (!values || typeof values !== 'object') return undefined
  const p = (values as Record<symbol, unknown>)[VALIDATED_PROOF]
  if (!p || typeof p !== 'object') return undefined
  const fields = (p as { fields?: unknown }).fields
  return fields && typeof fields === 'object' ? (p as ValidatedProof) : undefined
}
