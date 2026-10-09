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

/** Схема из предиката: `check` возвращает `true` либо текст ошибки. */
export function make<T>(
  vendor: string,
  check: (value: unknown) => true | string,
): StandardSchemaV1<unknown, T> {
  return {
    "~standard": {
      version: 1,
      vendor,
      validate(value): Result<T> {
        const r = check(value);
        return r === true
          ? { value: value as T }
          : { issues: [{ message: r }] };
      },
    },
  };
}
const failWith = (message: string): string => message;
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
    if (typeof v !== "string" || !DATE_RE.test(v)) return failWith("Invalid ISO date");
    const y = digits(v, 0, 4),
      m = digits(v, 5, 2),
      d = digits(v, 8, 2);
    if (!validDate(y, m, d)) return failWith("Invalid ISO date");
    return true;
  });
/**
 * `YYYY-MM-DDTHH:MM:SS[.fff](Z|±HH:MM)` — соответствует
 * `z.iso.datetime({ offset: true })`: смещение принято, секунды до 60
 * (високосная), календарная дата обязательна.
 */
export const timestampSchema = (): StandardSchemaV1<unknown, string> =>
  make("kit-db/timestamp", (v) => {
    if (typeof v !== "string" || v.length < 20 || !DATE_RE.test(v.slice(0, 10)))
      return failWith("Invalid ISO datetime");
    const y = digits(v, 0, 4),
      m = digits(v, 5, 2),
      d = digits(v, 8, 2);
    if (!validDate(y, m, d)) return failWith("Invalid ISO datetime");
    const tail = v.slice(10);
    if (!TIME_TAIL.test(tail)) return failWith("Invalid ISO datetime");
    const hh = digits(tail, 1, 2),
      mm = digits(tail, 4, 2),
      ss = digits(tail, 7, 2);
    if (hh > 23 || mm > 59 || ss > 59) return failWith("Invalid ISO datetime");
    const offset = tail.match(/(Z|[+-]\d{2}:\d{2})$/)?.[1];
    if (!offset) return failWith("Invalid ISO datetime");
    if (offset !== "Z") {
      const oh = Number(offset.slice(1, 3)),
        om = Number(offset.slice(4, 6));
      if (oh > 23 || om > 59) return failWith("Invalid ISO datetime");
    }
    return true;
  });

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
      return failWith(`Too small: expected string to have >=${o.min} characters`);
    if (o.max !== undefined && s.length > o.max)
      return failWith(`Too big: expected string to have <=${o.max} characters`);
    if (o.pattern !== undefined) {
      if (o.pattern.global || o.pattern.sticky)
        throw new Error("schema.pattern must not be global or sticky");
      if (!o.pattern.test(s)) return failWith(o.message ?? "Invalid string");
    }
    return true;
  });
export const uuid = (): StandardSchemaV1<unknown, string> =>
  make(
    "kit-db/uuid",
    (v) =>
      (typeof v === "string" &&
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(v)) ||
      failWith("Invalid UUID"),
  );
export const integer = (
  o: { min?: number; max?: number } = {},
): StandardSchemaV1<unknown, number> =>
  make("kit-db/integer", (v) => {
    if (typeof v !== "number" || !Number.isSafeInteger(v))
      return failWith("Expected int");
    if (o.min !== undefined && v < o.min) return failWith("Too small");
    if (o.max !== undefined && v > o.max) return failWith("Too big");
    return true;
  });
/** bigint в PostgreSQL: строка цифр, точность JS-числа не используется намеренно. */
export const bigint = (): StandardSchemaV1<unknown, string> =>
  make("kit-db/bigint", (v) =>
    (typeof v === "string" && /^-?\d+$/.test(v)) || failWith("Expected bigint string"),
  );
/** numeric/decimal: строка, чтобы не терять разряды через Number. */
export const decimal = (): StandardSchemaV1<unknown, string> =>
  make("kit-db/decimal", (v) =>
    (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) ||
    failWith("Expected decimal string"),
  );
export const boolean = (): StandardSchemaV1<unknown, boolean> =>
  make("kit-db/boolean", (v) => is(v, "boolean") || failWith("Expected boolean"));
/** Значение, которое можно положить в jsonb: рекурсивно JSON-представимо. */
export const json = (): StandardSchemaV1<unknown, unknown> =>
  make("kit-db/json", (v) => {
    const seen = new Set<unknown>();
    const walk = (x: unknown): true | string => {
      if (x === null || is(x, "boolean") || is(x, "string")) return true;
      if (is(x, "number"))
        return Number.isFinite(x) ? true : failWith("Invalid JSON number");
      if (Array.isArray(x)) {
        if (seen.has(x)) return failWith("Cyclic JSON value");
        seen.add(x);
        for (let i = 0; i < x.length; i++) {
          const r = walk(i in x ? x[i] : null);
          if (r !== true) return r;
        }
        return true;
      }
      if (x && typeof x === "object") {
        if (seen.has(x)) return failWith("Cyclic JSON value");
        seen.add(x);
        for (const [k, value] of Object.entries(x)) {
          const r = walk(value);
          if (r !== true) return r;
          void k;
        }
        return true;
      }
      return failWith("Invalid JSON value");
    };
    return walk(v);
  });
export const array = (
  item: StandardSchemaV1<unknown, unknown>,
  o: { min?: number; max?: number } = {},
): StandardSchemaV1<unknown, readonly unknown[]> => ({
  "~standard": {
    version: 1,
    vendor: "kit-db/array",
    async validate(value) {
      if (!Array.isArray(value)) return { issues: [{ message: "Expected array" }] };
      if (o.min !== undefined && value.length < o.min)
        return { issues: [{ message: "Too small" }] };
      if (o.max !== undefined && value.length > o.max)
        return { issues: [{ message: "Too big" }] };
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
    failWith("Invalid option"),
  );
/** Свой предикат: один шаг, свой текст ошибки. */
export const custom = <T>(
  check: (value: unknown) => T | undefined | string,
): StandardSchemaV1<unknown, T> =>
  make("kit-db/custom", (v) => {
    const r = check(v);
    return typeof r === "string" ? failWith(r) : true;
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
