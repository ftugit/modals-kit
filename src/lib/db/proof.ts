// Метка «значение проверено этой схемой» — договорённость с `lib/form` без импорта.
//
// Тип и ключ скопированы в обе библиотеки (как сам контракт Standard Schema). Совпадение
// держат тесты договорённости с каждой стороны: `proof.test.ts` здесь и
// `src/lib/form/proof.test.ts` проверяют одну и ту же форму данных.
//
// Метка — только способ не повторять проверку значения. Совпало всё — объект схемы поля
// (`proof.schema === field.schema`) и значение после `normalize` — правила схемы не
// выполняются второй раз. Не совпало что-то одно или метки нет — поле проверяется
// полностью. `checks`, CHECK и индексы PostgreSQL выполняются всегда: метку может
// поставить только код приложения, а он и так может записать что угодно.

/** Ключ метки. Версия в имени: несовместимая форма данных получит новый ключ. */
export const VALIDATED_PROOF: unique symbol = Symbol.for("modals-kit.validated-proof.v1") as never;

/** Что проверено: поле → объект схемы, которой проверено, и проверенное значение. */
export interface ValidatedProof {
  readonly fields: Readonly<Record<string, { readonly schema: object; readonly value: unknown }>>;
}

/** Прочитать метку. Чужая форма данных — `undefined`, как будто метки нет. */
export function readProof(values: unknown): ValidatedProof | undefined {
  if (!values || typeof values !== "object") return undefined;
  const p = (values as Record<symbol, unknown>)[VALIDATED_PROOF];
  if (!p || typeof p !== "object") return undefined;
  const fields = (p as { fields?: unknown }).fields;
  return fields && typeof fields === "object" ? (p as ValidatedProof) : undefined;
}

/**
 * Совпадает ли значение с проверенным. Строки, числа, булевы и `null` — `Object.is`;
 * массив — поэлементно, если в нём только такие значения. Любой другой объект —
 * «не совпало»: его могли изменить после проверки, а замораживать чужие данные
 * библиотека не вправе.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  const flat = (x: unknown) => x === null || ["string", "number", "boolean"].includes(typeof x);
  if (flat(a) || flat(b)) return Object.is(a, b);
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((x, i) => flat(x) && Object.is(x, b[i]));
}

/** Проверено ли это значение этой схемой. */
export function provenFor(
  proof: ValidatedProof | undefined,
  key: string,
  schema: object,
  value: unknown,
): boolean {
  if (!proof || !Object.prototype.hasOwnProperty.call(proof.fields, key)) return false;
  const entry = proof.fields[key];
  return !!entry && entry.schema === schema && sameValue(value, entry.value);
}
