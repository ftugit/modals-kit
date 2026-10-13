import { ident } from "../query/sql";
import type { Driver, Row } from "../types";
import { canonicalType, columnSQL, createTableSQL, type ObjectSpec, type TableSpec } from "./model";

/**
 * Шаг синхронизации.
 * - `auto` — данные не теряются и не нужен выбор человека: применяется само.
 * - `conflict` — само нельзя (данные, выбор «переименование или новая колонка»):
 *   пока он есть, запросы к БД отвечают `schema_pending`.
 * - `notice` — не мешает работе, но ждёт решения (колонка, которой нет в модели).
 */
export interface Step {
  level: "auto" | "conflict" | "notice";
  kind:
    | "create_schema"
    | "create_table"
    | "add_column"
    | "drop_not_null"
    | "set_default"
    | "drop_default"
    | "set_not_null"
    | "drop_check"
    | "drop_foreign"
    | "drop_index"
    | "add_check"
    | "create_index"
    | "add_foreign"
    | "run_sql"
    | "add_required_column"
    | "change_type"
    | "nulls_in_required"
    | "unique_duplicates"
    | "rename_or_replace"
    | "extra_required_column"
    | "primary_key"
    | "sql_changed"
    | "extra_column";
  /** `"schema"."table"`; у `run_sql`/`sql_changed` — пусто, `column` — это `id`. */
  table: string;
  column?: string;
  /** Для `rename_or_replace`: колонка в БД, которой нет в модели. */
  from?: string;
  /** Что выполнить (`auto`) или что предлагается (`conflict`/`notice`; пусто — нужен перенос данных). */
  sql: readonly string[];
}

/** Порядок выполнения автоматических шагов внутри таблицы. */
const ORDER: Step["kind"][] = [
  "create_schema",
  "create_table",
  "add_column",
  "drop_not_null",
  "drop_default",
  "set_default",
  "set_not_null",
  "drop_foreign",
  "drop_check",
  "drop_index",
  "add_check",
  "create_index",
  "add_foreign",
];
export const byOrder = (a: Step, b: Step) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind);

interface DbColumn extends Row {
  name: string;
  type: string;
  not_null: boolean;
  def: string | null;
}
type Query = <T extends Row>(text: string, values?: unknown[]) => Promise<T[]>;
const runner =
  (tx: Driver): Query =>
  async <T extends Row>(text: string, values: unknown[] = []) =>
    (await tx.query<T>({ text, values })).rows;

/**
 * Шаги для одной таблицы. `snapshot` — что синхронизация записала в прошлый раз
 * (`defaults`): по нему видно, какие DEFAULT ставила она, а какие — кто-то другой
 * (sequence у serial, ручной ALTER) и трогать их нельзя.
 */
export async function planTable(
  tx: Driver,
  spec: TableSpec,
  snapshot?: { defaults?: Record<string, string | null> },
): Promise<Step[]> {
  const q = runner(tx);
  const t = spec.qualified;
  const steps: Step[] = [];
  const add = (s: Omit<Step, "table">) => steps.push({ table: t, ...s });

  const [{ exists }] = await q<{ exists: boolean }>("SELECT to_regclass($1) IS NOT NULL AS exists", [t]);
  if (!exists) {
    if (spec.schema !== "public") {
      const [{ found }] = await q<{ found: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = $1) AS found",
        [spec.schema],
      );
      if (!found) add({ level: "auto", kind: "create_schema", sql: [`CREATE SCHEMA IF NOT EXISTS ${ident(spec.schema)}`] });
    }
    add({ level: "auto", kind: "create_table", sql: [createTableSQL(spec)] });
    for (const o of spec.objects)
      if (o.kind === "foreign") add({ level: "auto", kind: "add_foreign", column: o.columns[0], sql: [addForeignSQL(t, o)] });
      else if (o.kind !== "check") add({ level: "auto", kind: "create_index", sql: [o.sql] });
    return steps;
  }

  const cols = await q<DbColumn>(
    `SELECT a.attname::text AS name, format_type(a.atttypid, a.atttypmod) AS type,
            a.attnotnull AS not_null, pg_get_expr(d.adbin, d.adrelid) AS def
       FROM pg_catalog.pg_attribute a
       LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = to_regclass($1) AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum`,
    [t],
  );
  const cons = await q<{ name: string; type: string; cols: string[] | null }>(
    `SELECT c.conname::text AS name, c.contype::text AS type,
            (SELECT array_agg(a.attname::text ORDER BY a.attnum) FROM pg_catalog.pg_attribute a
              WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)) AS cols
       FROM pg_catalog.pg_constraint c WHERE c.conrelid = to_regclass($1)`,
    [t],
  );
  const indexes = await q<{ name: string }>(
    `SELECT ic.relname::text AS name FROM pg_catalog.pg_index i
       JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid WHERE i.indrelid = to_regclass($1)`,
    [t],
  );
  let emptyCache: boolean | undefined;
  const empty = async () =>
    (emptyCache ??= (await q<{ empty: boolean }>(`SELECT NOT EXISTS (SELECT 1 FROM ${t}) AS empty`))[0]!.empty);

  const inDb = new Map(cols.map((c) => [c.name, c]));
  const inModel = new Map(spec.columns.map((c) => [c.name, c]));
  const missing = spec.columns.filter((c) => !inDb.has(c.name));
  const extra = cols.filter((c) => !inModel.has(c.name));

  // Пропала колонка того же типа, что появилась: это может быть переименование.
  // Решает человек — иначе «само» добавило бы пустую колонку, а данные остались бы в старой.
  const renamed = new Map<string, string>();
  for (const m of missing) {
    const e = extra.find((x) => canonicalType(x.type) === m.type && ![...renamed.values()].includes(x.name));
    if (e) renamed.set(m.name, e.name);
  }
  const added = new Set<string>();
  for (const m of missing) {
    const from = renamed.get(m.name);
    if (from)
      add({
        level: "conflict",
        kind: "rename_or_replace",
        column: m.name,
        from,
        sql: [`ALTER TABLE ${t} RENAME COLUMN ${ident(from)} TO ${ident(m.name)}`],
      });
    else if (!m.notNull || m.default !== null || (await empty())) {
      add({ level: "auto", kind: "add_column", column: m.name, sql: [`ALTER TABLE ${t} ADD COLUMN ${columnSQL(m)}`] });
      added.add(m.name);
    } else
      add({ level: "conflict", kind: "add_required_column", column: m.name, sql: [] });
  }
  for (const e of extra) {
    if ([...renamed.values()].includes(e.name)) continue;
    const drop = [`ALTER TABLE ${t} DROP COLUMN ${ident(e.name)}`];
    // NOT NULL без DEFAULT и без поля в модели: любая вставка через модель упадёт
    if (e.not_null && e.def === null) add({ level: "conflict", kind: "extra_required_column", column: e.name, sql: drop });
    else add({ level: "notice", kind: "extra_column", column: e.name, sql: drop });
  }

  const managedDefaults = snapshot?.defaults ?? {};
  for (const m of spec.columns) {
    const d = inDb.get(m.name);
    if (!d) continue;
    const c = ident(m.name);
    if (canonicalType(d.type) !== m.type) {
      add({
        level: "conflict",
        kind: "change_type",
        column: m.name,
        sql: [`ALTER TABLE ${t} ALTER COLUMN ${c} TYPE ${m.type} USING ${c}::${m.type}`],
      });
      continue;
    }
    if (m.default !== null) {
      // PostgreSQL хранит выражение в своей записи (`'a'` → `'a'::text`), поэтому
      // «совпадает» — дословно или по записи прошлой синхронизации
      const same = d.def === m.default || (d.def !== null && managedDefaults[m.name] === m.default);
      if (!same) add({ level: "auto", kind: "set_default", column: m.name, sql: [`ALTER TABLE ${t} ALTER COLUMN ${c} SET DEFAULT ${m.default}`] });
    } else if (d.def !== null && managedDefaults[m.name]) {
      add({ level: "auto", kind: "drop_default", column: m.name, sql: [`ALTER TABLE ${t} ALTER COLUMN ${c} DROP DEFAULT`] });
    }
    if (!m.notNull && d.not_null)
      add({ level: "auto", kind: "drop_not_null", column: m.name, sql: [`ALTER TABLE ${t} ALTER COLUMN ${c} DROP NOT NULL`] });
    if (m.notNull && !d.not_null) {
      const [{ has }] = await q<{ has: boolean }>(`SELECT EXISTS (SELECT 1 FROM ${t} WHERE ${c} IS NULL) AS has`);
      if (has) add({ level: "conflict", kind: "nulls_in_required", column: m.name, sql: [] });
      else add({ level: "auto", kind: "set_not_null", column: m.name, sql: [`ALTER TABLE ${t} ALTER COLUMN ${c} SET NOT NULL`] });
    }
  }

  const pk = cons.find((c) => c.type === "p");
  if (!pk || (pk.cols ?? []).join(",") !== spec.primaryKey)
    add({
      level: "conflict",
      kind: "primary_key",
      column: spec.primaryKey,
      sql: pk ? [] : [`ALTER TABLE ${t} ADD PRIMARY KEY (${ident(spec.primaryKey)})`],
    });

  // Управляемые объекты: по имени (в нём хеш определения).
  const present = new Set([...cons.map((c) => c.name), ...indexes.map((i) => i.name)]);
  const managed = new RegExp(`^${spec.prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_(ck|ix|ux|fk)_[0-9a-f]{8}$`);
  const wanted = new Set(spec.objects.map((o) => o.name));
  for (const c of cons)
    if (c.type === "c" && managed.test(c.name) && !wanted.has(c.name))
      add({ level: "auto", kind: "drop_check", sql: [`ALTER TABLE ${t} DROP CONSTRAINT ${ident(c.name)}`] });
    else if (c.type === "f" && managed.test(c.name) && !wanted.has(c.name))
      add({ level: "auto", kind: "drop_foreign", sql: [`ALTER TABLE ${t} DROP CONSTRAINT ${ident(c.name)}`] });
  for (const i of indexes)
    if (managed.test(i.name) && !wanted.has(i.name))
      add({ level: "auto", kind: "drop_index", sql: [`DROP INDEX ${ident(spec.schema)}.${ident(i.name)}`] });
  for (const o of spec.objects) {
    if (present.has(o.name)) continue;
    // объект на колонке, которую сейчас не добавить (конфликт) — после решения
    if (o.columns.some((c) => !inDb.has(c) && !added.has(c))) continue;
    if (o.kind === "check")
      add({ level: "auto", kind: "add_check", sql: [`ALTER TABLE ${t} ADD CONSTRAINT ${ident(o.name)} CHECK (${o.sql}) NOT VALID`] });
    else if (o.kind === "foreign") add({ level: "auto", kind: "add_foreign", column: o.columns[0], sql: [addForeignSQL(t, o)] });
    else if (o.kind === "index") add({ level: "auto", kind: "create_index", sql: [o.sql] });
    else if (
      // новая колонка с одинаковым DEFAULT у нескольких строк — дубли гарантированы
      (o.columns.some((c) => added.has(c) && inModel.get(c)?.default !== null) && !(await empty())) ||
      (await duplicates(q, t, o))
    ) add({ level: "conflict", kind: "unique_duplicates", column: o.columns.join(","), sql: [o.sql] });
    else add({ level: "auto", kind: "create_index", sql: [o.sql] });
  }
  return steps;
}

/**
 * Внешний ключ без проверки старых строк (`NOT VALID`), как и CHECK: новые и
 * изменённые строки он проверяет сразу, а «сироты» из прошлого не роняют открытие БД.
 * Выполняется после всех таблиц этого прогона: цель может создаваться в нём же.
 */
function addForeignSQL(t: string, o: ObjectSpec): string {
  return `ALTER TABLE ${t} ADD CONSTRAINT ${ident(o.name)} ${o.sql} NOT VALID`;
}

async function duplicates(q: Query, t: string, o: ObjectSpec): Promise<boolean> {
  // колонка добавляется этим же планом — в ней пока ничего нет (DEFAULT разобран выше)
  const [{ absent }] = await q<{ absent: boolean }>(
    `SELECT count(*) < $3 AS absent FROM pg_catalog.pg_attribute
      WHERE attrelid = to_regclass($1) AND attname = ANY ($2::text[]) AND NOT attisdropped`,
    [t, [...o.columns], o.columns.length],
  );
  if (absent) return false;
  const cols = o.columns.map(ident).join(", ");
  const rows = await q(
    `SELECT 1 FROM ${t}${o.where ? " WHERE " + o.where : ""} GROUP BY ${cols} HAVING count(*) > 1 LIMIT 1`,
  );
  return rows.length > 0;
}
