/**
 * Примитивы Standard Schema (v1) без внешних зависимостей.
 *
 * Зачем: в SolidHono поля ресурса объявлялись через zod, и `zod` становился
 * обязательной зависимостью всей lib. Контракт ядра при этом — только
 * `schema['~standard'].validate` (см. `validation.ts#validateField`), так что
 * библиотека умеем принимать ЛЮБУЮ Standard-Schema-совместимую схему: zod 4,
 * valibot, свою. Здесь — минимальный набор, покрывающий `f.*` из источника.
 *
 * Семантика сверена с zod 4 отдельным дифференциальным тестом
 * (`test/parity.mts`): на корпусе значений оба набора должны принимать и
 * отклонять одно и то же. Расхождение — баг этого файла, а не «особенность».
 */
import type { StandardSchemaV1 } from "@standard-schema/spec";

type Result<T> = StandardSchemaV1.Result<T>;

type Issue = NonNullable<StandardSchemaV1.Result<unknown>["issues"]>[number];

/**
 * Что схема знает о колонке PostgreSQL: тип и ограничения, которые можно повторить
 * в БД как CHECK. Читает `defineSchema` (`#lib/db/sync/index.js`), когда строит
 * таблицу из модели. У чужих схем (zod, valibot) этого нет — там тип колонки
 * задаётся полем `db.type`.
 */
export interface ColumnMeta {
  type: string;
  /** Длина строки (`char_length`). */
  length?: { min?: number; max?: number };
  /** Диапазон числа. */
  range?: { min?: number; max?: number };
  /** Допустимые значения (enum). */
  values?: readonly string[];
}
const META = "~kitDb";
/** Метаданные колонки у схемы `s.*`; `undefined` — схема их не несёт. */
export function columnMeta(schema: unknown): ColumnMeta | undefined {
  if (!schema || typeof schema !== "object") return undefined;
  const m = (schema as Record<string, unknown>)[META];
  return m && typeof m === "object" ? (m as ColumnMeta) : undefined;
}
/**
 * Ошибка с кодом: Standard Schema issue плюс `code`/`params` (для словаря текстов)
 * и `template` (свой текст схемы). Лишние поля стандарт допускает.
 */
export interface CodedIssue {
  message: string;
  code: string;
  params?: Record<string, unknown>;
  template?: string;
}
/**
 * Схема из предиката: `check` возвращает `true`, текст ошибки либо ошибку с
 * кодом (`CodedIssue`) — её код и параметры доедут до формы (`FieldError`).
 */
export function make<T>(
  vendor: string,
  check: (value: unknown) => true | string | CodedIssue,
  meta?: ColumnMeta,
): StandardSchemaV1<unknown, T> {
  return {
    ...(meta ? { [META]: Object.freeze(meta) } : {}),
    "~standard": {
      version: 1,
      vendor,
      validate(value): Result<T> {
        const r = check(value);
        return r === true
          ? { value: value as T }
          : { issues: [typeof r === "string" ? { message: r } : r] };
      },
    },
  };
}
const failWith = (
  message: string,
  code = "invalid",
  params?: Record<string, unknown>,
): CodedIssue => (params ? { message, code, params } : { message, code });
const is = (v: unknown, t: string): boolean => typeof v === t;
const digits = (s: string, from: number, len: number): number => {
  let n = 0;
  for (let i = from; i < from + len; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return NaN;
    n = n * 10 + (c - 48);
  }
  return n;
};
/** Календарно верная дата (включая високосные годы) — как в zod. */
function validDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= days[m - 1]!;
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/* Разделитель — только `T`, как в `z.iso.datetime()`: PostgreSQL в `to_char`
 * тоже даёт `T`. Секунды 60 (високосная) не принимаем — zod их отклоняет,
 * а в `timestamptz` они всё равно приходят как `00:00:00` следующей минуты. */
const TIME_TAIL = /^T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** `YYYY-MM-DD` + реально существующая дата. */
export const dateSchema = (): StandardSchemaV1<unknown, string> =>
  make("kit-db/date", (v) => {
    if (typeof v !== "string" || !DATE_RE.test(v)) return failWith("Invalid ISO date", "type.date");
    const y = digits(v, 0, 4),
      m = digits(v, 5, 2),
      d = digits(v, 8, 2);
    if (!validDate(y, m, d)) return failWith("Invalid ISO date", "type.date");
    return true;
  }, { type: "date" });
/**
 * `YYYY-MM-DDTHH:MM:SS[.fff](Z|±HH:MM)` — соответствует
 * `z.iso.datetime({ offset: true })`: смещение принято, секунды до 59
 * (високосную 60 не принимаем, см. `TIME_TAIL`), календарная дата обязательна.
 */
export const timestampSchema = (): StandardSchemaV1<unknown, string> =>
  make("kit-db/timestamp", (v) => {
    if (typeof v !== "string" || v.length < 20 || !DATE_RE.test(v.slice(0, 10)))
      return failWith("Invalid ISO datetime", "type.datetime");
    const y = digits(v, 0, 4),
      m = digits(v, 5, 2),
      d = digits(v, 8, 2);
    if (!validDate(y, m, d)) return failWith("Invalid ISO datetime", "type.datetime");
    const tail = v.slice(10);
    if (!TIME_TAIL.test(tail)) return failWith("Invalid ISO datetime", "type.datetime");
    const hh = digits(tail, 1, 2),
      mm = digits(tail, 4, 2),
      ss = digits(tail, 7, 2);
    if (hh > 23 || mm > 59 || ss > 59) return failWith("Invalid ISO datetime", "type.datetime");
    const offset = tail.match(/(Z|[+-]\d{2}:\d{2})$/)?.[1];
    if (!offset) return failWith("Invalid ISO datetime", "type.datetime");
    if (offset !== "Z") {
      const oh = Number(offset.slice(1, 3)),
        om = Number(offset.slice(4, 6));
      if (oh > 23 || om > 59) return failWith("Invalid ISO datetime", "type.datetime");
    }
    return true;
  }, { type: "timestamptz" });

export interface TextOptions {
  min?: number;
  max?: number;
  /** Неглобальный RegExp: глобальный даёт состояние lastIndex и тихую ошибку. */
  pattern?: RegExp;
  message?: string;
}
export const text = (o: TextOptions = {}): StandardSchemaV1<unknown, string> =>
  make("kit-db/text", (v) => {
    if (typeof v !== "string") return failWith("Expected string");
    const s = v;
    if (o.min !== undefined && s.length < o.min)
      return failWith(`Too small: expected string to have >=${o.min} characters`, "minLength", { min: o.min });
    if (o.max !== undefined && s.length > o.max)
      return failWith(`Too big: expected string to have <=${o.max} characters`, "maxLength", { max: o.max });
    if (o.pattern !== undefined) {
      if (o.pattern.global || o.pattern.sticky)
        throw new Error("schema.pattern must not be global or sticky");
      if (!o.pattern.test(s))
        return o.message !== undefined
          ? { message: o.message, code: "pattern", template: o.message }
          : failWith("Invalid string", "pattern");
    }
    return true;
  }, { type: "text", ...(o.min !== undefined || o.max !== undefined ? { length: { min: o.min, max: o.max } } : {}) });
export const uuid = (): StandardSchemaV1<unknown, string> =>
  make(
    "kit-db/uuid",
    (v) =>
      (typeof v === "string" &&
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(v)) ||
      failWith("Invalid UUID"),
    { type: "uuid" },
  );
export const integer = (
  o: { min?: number; max?: number } = {},
): StandardSchemaV1<unknown, number> =>
  make("kit-db/integer", (v) => {
    if (typeof v !== "number" || !Number.isSafeInteger(v))
      return failWith("Expected int", "integer");
    if (o.min !== undefined && v < o.min) return failWith("Too small", "minValue", { min: o.min });
    if (o.max !== undefined && v > o.max) return failWith("Too big", "maxValue", { max: o.max });
    return true;
  }, { type: "integer", ...(o.min !== undefined || o.max !== undefined ? { range: { min: o.min, max: o.max } } : {}) });
/** bigint в PostgreSQL: строка цифр, точность JS-числа не используется намеренно. */
export const bigint = (): StandardSchemaV1<unknown, string> =>
  make("kit-db/bigint", (v) =>
    (typeof v === "string" && /^-?\d+$/.test(v)) || failWith("Expected bigint string"),
  { type: "bigint" });
/** numeric/decimal: строка, чтобы не терять разряды через Number. */
export const decimal = (): StandardSchemaV1<unknown, string> =>
  make("kit-db/decimal", (v) =>
    (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) ||
    failWith("Expected decimal string"),
  { type: "numeric" });
export const boolean = (): StandardSchemaV1<unknown, boolean> =>
  make("kit-db/boolean", (v) => is(v, "boolean") || failWith("Expected boolean"), { type: "boolean" });
/** Значение, которое можно положить в jsonb: рекурсивно JSON-представимо. */
export const json = (): StandardSchemaV1<unknown, unknown> =>
  make("kit-db/json", (v) => {
    // Цикл — только объект на ТЕКУЩЕМ пути: общая ссылка из двух мест (`{ a: x, b: x }`)
    // законна, `JSON.stringify` её сохраняет (DB-9).
    const path = new Set<unknown>();
    const enter = (x: object, body: () => true | CodedIssue): true | CodedIssue => {
      if (path.has(x)) return failWith("Cyclic JSON value");
      path.add(x);
      try {
        return body();
      } finally {
        path.delete(x);
      }
    };
    const walk = (x: unknown): true | CodedIssue => {
      if (x === null || is(x, "boolean") || is(x, "string")) return true;
      if (is(x, "number"))
        return Number.isFinite(x) ? true : failWith("Invalid JSON number");
      if (Array.isArray(x))
        return enter(x, () => {
          for (let i = 0; i < x.length; i++) {
            const r = walk(i in x ? x[i] : null);
            if (r !== true) return r;
          }
          return true;
        });
      // Только plain-объект: `Map`, `Set`, `Date`, экземпляры классов JSON превратил бы
      // в `{}` или строку — данные терялись бы молча (DB-9).
      if (x && typeof x === "object") {
        const proto = Object.getPrototypeOf(x);
        if (proto !== Object.prototype && proto !== null) return failWith("Invalid JSON value");
        return enter(x, () => {
          for (const value of Object.values(x)) {
            const r = walk(value);
            if (r !== true) return r;
          }
          return true;
        });
      }
      return failWith("Invalid JSON value");
    };
    return walk(v);
  }, { type: "jsonb" });
export const array = (
  item: StandardSchemaV1<unknown, unknown>,
  o: { min?: number; max?: number } = {},
): StandardSchemaV1<unknown, readonly unknown[]> => ({
  ...(columnMeta(item) ? { [META]: Object.freeze({ type: columnMeta(item)!.type + "[]" }) } : {}),
  "~standard": {
    version: 1,
    vendor: "kit-db/array",
    async validate(value) {
      if (!Array.isArray(value)) return { issues: [failWith("Expected array")] };
      if (o.min !== undefined && value.length < o.min)
        return { issues: [failWith("Too small", "minCount", { min: o.min })] };
      if (o.max !== undefined && value.length > o.max)
        return { issues: [failWith("Too big", "maxCount", { max: o.max })] };
      const issues: Issue[] = [];
      for (let i = 0; i < value.length; i++) {
        const r = await item["~standard"].validate(value[i]);
        if (r.issues)
          for (const issue of r.issues)
            issues.push({ message: String(issue.message), path: [i, ...(issue.path ?? [])] });
      }
      return issues.length ? { issues } : { value };
    },
  },
});
export const enumOf = <const T extends readonly string[]>(
  values: T,
): StandardSchemaV1<unknown, T[number]> =>
  make("kit-db/enum", (v) =>
    (typeof v === "string" && (values as readonly string[]).includes(v)) ||
    failWith("Invalid option", "oneOf"),
    { type: "text", values: [...values] },
  );
/** Свой предикат: один шаг, свой текст ошибки. */
export const custom = <T>(
  check: (value: unknown) => T | undefined | string,
): StandardSchemaV1<unknown, T> =>
  make("kit-db/custom", (v) => {
    const r = check(v);
    return typeof r === "string" ? { message: r, code: "custom", template: r } : true;
  });
/** Публичный неймспейс: `s.text()`, `s.uuid()`, … */
export const s = {
  text,
  uuid,
  integer,
  bigint,
  decimal,
  boolean,
  date: dateSchema,
  timestamp: timestampSchema,
  json,
  array,
  enum: enumOf,
  custom,
};
