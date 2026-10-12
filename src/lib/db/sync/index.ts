/**
 * Схема БД из моделей: таблицы создаются и дополняются сами, опасное ждёт человека.
 *
 * ```ts
 * export const schema = defineSchema({ resources: [posts], sql: [{ id: 'seed', text: '…' }] })
 * // при открытии драйвера (lazyDriver → open):
 * return schema.gate(driver)
 * ```
 *
 * Как работает `sync` (его вызывает `gate`):
 * 1. Быстрая проверка — один SELECT из `kit_schema`: отпечатки моделей и `id` ручного
 *    SQL совпали с записанными — ничего не делать (обычный старт экземпляра).
 * 2. Иначе — транзакция под `pg_advisory_xact_lock`: экземпляров много, менять схему
 *    должен один, остальные дождутся и увидят результат. Внутри — чтение
 *    `pg_catalog`, сравнение с моделью (`planTable`), выполнение шагов `auto`.
 * 3. Шаги `conflict` не выполняются. Пока они есть, драйвер из `gate` отвечает на
 *    каждый запрос `schema_pending` (503) и перед этим перепроверяет `kit_schema`:
 *    когда расхождение снимут (на этом или другом экземпляре), запросы пойдут сами.
 *
 * Отпечаток таблицы записывается, только когда у неё не осталось конфликтов. Изменение
 * схемы мимо моделей (ручной ALTER) при совпавшем отпечатке не замечается — как и у
 * WordPress, сверка идёт по версии, записанной в самой БД.
 */
import { DbFailure, fail, normalizeFailure } from "../errors";
import { ident } from "../query/sql";
import { splitSqlStatements } from "../query/split";
import type { Driver, Resource, Row } from "../types";
import { sha256, tableSpec, type TableSpec } from "./model";
import { byOrder, planTable, type Step } from "./plan";

export type { Step } from "./plan";
export { canonicalType } from "./model";

/** Ручной SQL (триггеры, функции, начальные данные): выполняется один раз на `id`. */
export interface SqlStep {
  id: string;
  text: string;
}
export interface SchemaSpec {
  resources: readonly Resource[];
  /** По порядку, после таблиц. Текст под тем же `id` менять нельзя — нужен новый `id`. */
  sql?: readonly SqlStep[];
  /** Где хранить записи синхронизации. По умолчанию `public.kit_schema`. */
  table?: string;
}
export interface SchemaReport {
  status: "ok" | "pending";
  /** Что выполнено сейчас (пусто при быстрой проверке). */
  applied: readonly Step[];
  /** Блокирует запросы до решения человеком. */
  conflicts: readonly Step[];
  /** Не блокирует, но ждёт решения. */
  notices: readonly Step[];
}
export interface DbSchema {
  sync(driver: Driver): Promise<SchemaReport>;
  /**
   * `sync` + драйвер, который при конфликтах отвечает `schema_pending`, пока их не снимут.
   * `onReport` — для журнала: что применено и чего ждём.
   */
  gate(driver: Driver, options?: { onReport?: (report: SchemaReport) => void }): Promise<Driver>;
}

const OK: SchemaReport = Object.freeze({ status: "ok", applied: [], conflicts: [], notices: [] });

export function defineSchema(spec: SchemaSpec): DbSchema {
  if (!spec || !Array.isArray(spec.resources) || !spec.resources.length)
    fail("validation", undefined, ["defineSchema: resources — непустой массив ресурсов"]);
  const tables = new Set<string>();
  for (const r of spec.resources) {
    if (!r?.fields || !r.table) fail("validation", undefined, ["defineSchema: каждый элемент resources — Resource"]);
    const t = r.table.includes(".") ? r.table : "public." + r.table;
    if (tables.has(t)) fail("validation", undefined, [`defineSchema: таблица ${t} описана дважды`]);
    tables.add(t);
  }
  const ids = new Set<string>();
  for (const step of spec.sql ?? []) {
    if (!step || typeof step.id !== "string" || !step.id.trim() || typeof step.text !== "string" || !step.text.trim())
      fail("validation", undefined, ["defineSchema: sql — [{ id, text }] с непустыми строками"]);
    if (ids.has(step.id)) fail("validation", undefined, [`defineSchema: sql id «${step.id}» повторяется`]);
    ids.add(step.id);
  }
  const kitParts = (spec.table ?? "public.kit_schema").split(".");
  if (kitParts.length !== 2) fail("validation", undefined, ["defineSchema: table — «схема.имя»"]);
  const kit = kitParts.map(ident).join(".");

  // Описание считается один раз и лениво: Web Crypto асинхронен, а ошибка
  // конфигурации (нет типа колонки) должна всплыть при открытии БД, а не при импорте.
  let prepared: Promise<{ specs: TableSpec[]; want: Map<string, string> }> | undefined;
  const prepare = () =>
    (prepared ??= (async () => {
      const specs = await Promise.all(spec.resources.map(tableSpec));
      const want = new Map<string, string>();
      for (const s of specs) want.set("table\0" + s.qualified, s.fingerprint);
      for (const s of spec.sql ?? []) want.set("sql\0" + s.id, (await sha256(s.text)).slice(0, 16));
      return { specs, want };
    })().catch((e) => {
      prepared = undefined;
      throw e;
    }));

  const recorded = async (d: Driver) => {
    const rows = (await d.query<Row & { kind: string; name: string; hash: string; detail: unknown }>({
      text: `SELECT kind, name, hash, detail FROM ${kit}`,
    })).rows;
    return new Map(rows.map((r) => [r.kind + "\0" + r.name, r]));
  };
  const missingTable = (e: unknown) => normalizeFailure(e).details.sqlstate === "42P01";

  /** Быстрая проверка без блокировки: всё записанное совпадает с моделями. */
  async function upToDate(d: Driver): Promise<boolean> {
    const { want } = await prepare();
    let have;
    try {
      have = await recorded(d);
    } catch (e) {
      if (missingTable(e)) return false;
      throw e;
    }
    for (const [key, hash] of want) if (have.get(key)?.hash !== hash) return false;
    return true;
  }

  async function sync(driver: Driver): Promise<SchemaReport> {
    if (!driver?.capabilities?.transactions)
      throw new DbFailure("unsupported", {}, new Error("defineSchema: нужен транзакционный драйвер (pg, PGlite, Hyperdrive)"));
    const { specs, want } = await prepare();
    if (await upToDate(driver)) return OK;
    return driver.transaction(async (tx) => {
      const run = (text: string, values: unknown[] = []) => tx.query({ text, values });
      await run("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [kit]);
      if (kitParts[0] !== "public") await run(`CREATE SCHEMA IF NOT EXISTS ${ident(kitParts[0]!)}`);
      await run(
        `CREATE TABLE IF NOT EXISTS ${kit} (
           kind text NOT NULL, name text NOT NULL, hash text NOT NULL,
           detail jsonb NOT NULL DEFAULT '{}'::jsonb,
           applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
           PRIMARY KEY (kind, name))`,
      );
      const have = await recorded(tx);
      const record = (kind: string, name: string, hash: string, detail: unknown) =>
        run(
          `INSERT INTO ${kit} (kind, name, hash, detail) VALUES ($1, $2, $3, $4::jsonb)
           ON CONFLICT (kind, name) DO UPDATE SET hash = EXCLUDED.hash, detail = EXCLUDED.detail, applied_at = clock_timestamp()`,
          [kind, name, hash, JSON.stringify(detail)],
        );
      const applied: Step[] = [],
        conflicts: Step[] = [],
        notices: Step[] = [];
      for (const s of specs) {
        const prev = have.get("table\0" + s.qualified);
        if (prev?.hash === s.fingerprint) continue;
        const detail = (typeof prev?.detail === "string" ? JSON.parse(prev.detail) : prev?.detail) as
          | { defaults?: Record<string, string | null> }
          | undefined;
        const steps = await planTable(tx, s, detail);
        for (const step of steps.filter((x) => x.level === "auto").sort(byOrder)) {
          for (const text of step.sql) await run(text);
          applied.push(step);
        }
        const blocking = steps.filter((x) => x.level === "conflict");
        conflicts.push(...blocking);
        notices.push(...steps.filter((x) => x.level === "notice"));
        if (!blocking.length)
          await record("table", s.qualified, s.fingerprint, {
            resource: s.resource,
            defaults: Object.fromEntries(s.columns.map((c) => [c.name, c.default])),
          });
      }
      for (const step of spec.sql ?? []) {
        const hash = want.get("sql\0" + step.id)!;
        const prev = have.get("sql\0" + step.id);
        if (prev && prev.hash !== hash) {
          conflicts.push({ level: "conflict", kind: "sql_changed", table: "", column: step.id, sql: [] });
          continue;
        }
        // ручной SQL опирается на таблицы — только когда они в порядке
        if (prev || conflicts.length) continue;
        for (const text of splitSqlStatements(step.text)) await run(text);
        await record("sql", step.id, hash, {});
        applied.push({ level: "auto", kind: "run_sql", table: "", column: step.id, sql: [step.text] });
      }
      return Object.freeze({
        status: conflicts.length ? "pending" : "ok",
        applied: Object.freeze(applied),
        conflicts: Object.freeze(conflicts),
        notices: Object.freeze(notices),
      }) as SchemaReport;
    });
  }

  async function gate(driver: Driver, options: { onReport?: (report: SchemaReport) => void } = {}): Promise<Driver> {
    const report = await sync(driver);
    if (report !== OK) options.onReport?.(report);
    let pending = report.status === "pending";
    const pass = async () => {
      if (!pending) return;
      if (await upToDate(driver)) pending = false;
      else throw new DbFailure("schema_pending");
    };
    return {
      capabilities: driver.capabilities,
      ...(driver.close ? { close: () => driver.close!() } : {}),
      async query(statement) {
        await pass();
        return driver.query(statement);
      },
      async transaction(fn, txOptions) {
        await pass();
        return driver.transaction(fn, txOptions);
      },
    };
  }

  return { sync, gate };
}
