import { fail } from "../errors";
import { ident } from "../query/sql";
import { columnMeta } from "../schema";
import type { Resource } from "../types";
import { timestampField } from "../validation";

/** Колонка таблицы, как её описывает модель. */
export interface ColumnSpec {
  field: string;
  name: string;
  /** Канонический тип — тот, что вернёт `format_type()` (см. `canonicalType`). */
  type: string;
  notNull: boolean;
  default: string | null;
}
/**
 * Объект, которым управляет синхронизация: CHECK, индекс, уникальный индекс. Имя
 * содержит хеш определения — изменилось определение, изменилось имя: старое
 * удаляется, новое создаётся, сравнивать тексты, переписанные PostgreSQL, не нужно.
 */
export interface ObjectSpec {
  name: string;
  kind: "check" | "index" | "unique" | "foreign";
  /**
   * Для `check` — выражение; для индексов — полный `CREATE … INDEX`; для `foreign` —
   * `FOREIGN KEY (…) REFERENCES … ON DELETE …`.
   */
  sql: string;
  /** Колонки, на которые объект опирается. */
  columns: readonly string[];
  /** Условие частичного индекса (`softDelete`), для проверки дублей. */
  where?: string;
}
export interface TableSpec {
  resource: string;
  schema: string;
  name: string;
  /** `"schema"."name"` — для SQL и для `to_regclass`. */
  qualified: string;
  primaryKey: string;
  columns: readonly ColumnSpec[];
  objects: readonly ObjectSpec[];
  /** Префикс имён управляемых объектов этой таблицы. */
  prefix: string;
  fingerprint: string;
}

const ALIASES: Record<string, string> = {
  int: "integer",
  int4: "integer",
  int8: "bigint",
  int2: "smallint",
  bool: "boolean",
  decimal: "numeric",
  timestamptz: "timestamp with time zone",
  timestamp: "timestamp without time zone",
  timetz: "time with time zone",
  time: "time without time zone",
  float8: "double precision",
  float4: "real",
  varchar: "character varying",
  char: "character",
};

/**
 * Тип в том виде, в каком его печатает `format_type()`: `timestamptz` →
 * `timestamp with time zone`, `int8` → `bigint`, `varchar(20)` →
 * `character varying(20)`. Неизвестное имя остаётся как есть (в нижнем регистре).
 */
export function canonicalType(type: string): string {
  let t = type.trim().toLowerCase().replace(/\s+/g, " ");
  let array = "";
  while (t.endsWith("[]")) {
    array += "[]";
    t = t.slice(0, -2).trim();
  }
  const m = /^([a-z_][a-z0-9_ ]*?)\s*(\([0-9, ]+\))?$/.exec(t);
  if (!m) return type.trim();
  return (ALIASES[m[1]!] ?? m[1]!) + (m[2]?.replace(/\s+/g, "") ?? "") + array;
}

const literal = (v: string) => "'" + v.replace(/'/g, "''") + "'";
const num = (v: unknown) => {
  if (typeof v !== "number" || !Number.isFinite(v)) fail("validation", undefined, ["граница диапазона — конечное число"]);
  return String(v);
};
function between(expr: string, min?: number, max?: number): string | undefined {
  if (min !== undefined && max !== undefined) return `${expr} BETWEEN ${num(min)} AND ${num(max)}`;
  if (min !== undefined) return `${expr} >= ${num(min)}`;
  if (max !== undefined) return `${expr} <= ${num(max)}`;
  return undefined;
}

/** SHA-256 (Web Crypto: Node, браузер, Workers) → hex. */
export async function sha256(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Описание таблицы из ресурса. Ошибка конфигурации — сразу, с именем поля. */
export async function tableSpec(r: Resource): Promise<TableSpec> {
  const parts = r.table.split(".");
  const schema = parts.length > 1 ? parts[0]! : "public";
  const name = parts[parts.length - 1]!;
  const qualified = ident(schema) + "." + ident(name);
  const deleted = r.softDelete ? r.fields[r.softDelete.field]?.column ?? r.softDelete.field : undefined;
  const where = deleted ? `${ident(deleted)} IS NULL` : undefined;

  const columns: ColumnSpec[] = [];
  const checks: { expr: string; columns: string[] }[] = [];
  for (const [key, field] of Object.entries(r.fields)) {
    const column = field.column ?? key;
    const meta = columnMeta(field.schema);
    const type = field.db?.type ?? meta?.type;
    if (!type)
      fail("validation", key, [
        `${r.key}.${key}: тип колонки неизвестен — схема поля не из s.*, задайте db: { type: '…' }`,
      ]);
    columns.push({
      field: key,
      name: column,
      type: canonicalType(type),
      // метка мягкого удаления — NULL у живой строки, что бы ни говорила схема поля
      notNull: !field.nullable && column !== deleted,
      default: field.db?.default?.trim() ?? null,
    });
    // CHECK повторяет только то, что схема знает точно; при своём `db.type` — ничего:
    // ограничения s.* описаны для её собственного типа
    if (meta && !field.db?.type) {
      const c = ident(column);
      const expr =
        (meta.length && between(`char_length(${c})`, meta.length.min, meta.length.max)) ||
        (meta.range && between(c, meta.range.min, meta.range.max)) ||
        (meta.values && `${c} IN (${meta.values.map(literal).join(", ")})`);
      if (expr) checks.push({ expr, columns: [column] });
    }
  }

  const prefix = name.slice(0, 50);
  const objects: ObjectSpec[] = [];
  const named = async (kind: ObjectSpec["kind"], body: string) =>
    `${prefix}_${{ check: "ck", index: "ix", unique: "ux", foreign: "fk" }[kind]}_${(await sha256(kind + "\n" + qualified + "\n" + body)).slice(0, 8)}`;
  for (const c of checks)
    objects.push({ kind: "check", name: await named("check", c.expr), sql: c.expr, columns: c.columns });

  const colOf = (k: string) => r.fields[k]!.column ?? k;
  const pk = colOf(r.primaryKey);
  const index = async (kind: "index" | "unique", keys: string[], only = where) => {
    const body = `(${keys.join(", ")})${only ? " WHERE " + only : ""}`;
    const n = await named(kind, body);
    objects.push({
      kind,
      name: n,
      sql: `CREATE ${kind === "unique" ? "UNIQUE " : ""}INDEX ${ident(n)} ON ${qualified} ${body}`,
      columns: keys.map((k) => k.split(" ")[0]!.replace(/"/g, "")),
      where: only,
    });
  };
  // keyset: сортировка ресурса + primaryKey, ровно как её пишет orderSQL
  const order = r.order.map(([k, d]) => `${ident(colOf(k))} ${d.toUpperCase()} NULLS LAST`);
  if (!r.order.some(([k]) => k === r.primaryKey)) order.push(`${ident(pk)} ASC NULLS LAST`);
  if (order.length > 1 || where) await index("index", order);
  for (const [k, f] of Object.entries(r.fields)) if (f.db?.unique) await index("unique", [ident(colOf(k))]);
  for (const keys of r.db?.unique ?? []) await index("unique", keys.map((k) => ident(colOf(k))));
  for (const keys of r.db?.indexes ?? []) await index("index", keys.map((k) => ident(colOf(k))));
  // Опрос удалённых (`timestamps.deletedAt`) спрашивает «удалены после метки» — это
  // только удалённые строки, поэтому индекс по ним, а не частичный по живым.
  const tombstone = timestampField(r, "deletedAt");
  if (tombstone && deleted)
    await index("index", [ident(deleted), ident(pk)], `${ident(deleted)} IS NOT NULL`);
  for (const [k, f] of Object.entries(r.fields)) {
    const ref = f.db?.references;
    if (!ref) continue;
    const target = ref.resource();
    if (!target?.fields || !target.table) fail("validation", k, [`${r.key}.${k}: db.references.resource() вернул не ресурс`]);
    const targetKey = ref.field ?? target.primaryKey;
    if (!target.fields[targetKey]) fail("validation", k, [`${r.key}.${k}: у ${target.key} нет поля ${targetKey}`]);
    const tParts = target.table.split(".");
    const tQualified = ident(tParts.length > 1 ? tParts[0]! : "public") + "." + ident(tParts[tParts.length - 1]!);
    const body =
      `FOREIGN KEY (${ident(colOf(k))}) REFERENCES ${tQualified} (${ident(target.fields[targetKey]!.column ?? targetKey)})` +
      ` ON DELETE ${(ref.onDelete ?? "no action").toUpperCase()}`;
    objects.push({ kind: "foreign", name: await named("foreign", body), sql: body, columns: [colOf(k)] });
  }

  const fingerprint = (
    await sha256(JSON.stringify({ qualified, pk, columns, objects: objects.map((o) => o.name) }))
  ).slice(0, 16);
  return { resource: r.key, schema, name, qualified, primaryKey: pk, columns, objects, prefix, fingerprint };
}

/** `CREATE TABLE` целиком: колонки, PRIMARY KEY, CHECK; индексы — отдельно. */
export function createTableSQL(spec: TableSpec): string {
  const lines = spec.columns.map((c) => columnSQL(c));
  lines.push(`PRIMARY KEY (${ident(spec.primaryKey)})`);
  for (const o of spec.objects) if (o.kind === "check") lines.push(`CONSTRAINT ${ident(o.name)} CHECK (${o.sql})`);
  return `CREATE TABLE ${spec.qualified} (\n  ${lines.join(",\n  ")}\n)`;
}
export function columnSQL(c: ColumnSpec): string {
  return `${ident(c.name)} ${c.type}${c.notNull ? " NOT NULL" : ""}${c.default !== null ? " DEFAULT " + c.default : ""}`;
}
