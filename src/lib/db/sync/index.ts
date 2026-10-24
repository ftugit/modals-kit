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
 * 4. Конфликт снимает человек: `sync(driver, { resolve })` — тот же прогон под той же
 *    блокировкой, но с решениями по конфликтным шагам (`stepKey` → `choices(step)`).
 *    Что выполнено по решению — в `report.resolved`. Шаги без SQL (нужен перенос
 *    данных) решением не снимаются: их снимает правка модели или данных.
 *
 * Отпечаток таблицы записывается, только когда у неё не осталось конфликтов. Изменение
 * схемы мимо моделей (ручной ALTER) при совпавшем отпечатке не замечается — как и у
 * WordPress, сверка идёт по версии, записанной в самой БД.
 */
import { DbFailure, fail, normalizeFailure } from "../errors";
import { choices, stepKey, type Choice, type Resolution } from "./decisions";
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
  /** Конфликтные шаги, выполненные по решению человека (`sync(driver, { resolve })`). */
  resolved: readonly Step[];
  /** Блокирует запросы до решения человеком. */
  conflicts: readonly Step[];
  /** Не блокирует, но ждёт решения. */
  notices: readonly Step[];
}
// Решения (`Choice`, `Resolution`) и их формат живут в `./decisions.ts`: этот
// модуль тянет DDL-код (`./model.ts`, `./plan.ts`), а клиенту, который рисует
// экран решений, нужны только ключ шага и список допустимых решений.
export type { Choice, Resolution } from "./decisions";
export { choices, stepKey } from "./decisions";

/**
 * Ход сверки — для показа ожидания (`onStep`). Этапы: `check` (быстрая проверка),
 * `table` (по ресурсу, `name` — таблица), `sql` (по ручному скрипту, `name` — `id`).
 * `done` — сколько этапов позади, `total` = 1 + ресурсы + скрипты; последнее событие —
 * `done === total` без `step`. Быстрая проверка, которой хватило, сразу даёт итог.
 */
export interface SyncStep {
  done: number;
  total: number;
  step?: "check" | "table" | "sql";
  name?: string;
}


export interface DbSchema {
  /** `resolve` — решения человека по конфликтам и ожидающим шагам (см. `choices`). */
  sync(driver: Driver, options?: { resolve?: Resolution; onStep?: (step: SyncStep) => void }): Promise<SchemaReport>;
  /**
   * `sync` + драйвер, который при конфликтах отвечает `schema_pending`, пока их не снимут.
   * `onReport` — для журнала: что применено и чего ждём.
   */
  gate(
    driver: Driver,
    options?: { onReport?: (report: SchemaReport) => void; onStep?: (step: SyncStep) => void },
  ): Promise<Driver>;
}

const OK: SchemaReport = Object.freeze({ status: "ok", applied: [], resolved: [], conflicts: [], notices: [] });

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

  async function sync(
    driver: Driver,
    options: { resolve?: Resolution; onStep?: (step: SyncStep) => void } = {},
  ): Promise<SchemaReport> {
    if (!driver?.capabilities?.transactions)
      throw new DbFailure("unsupported", {}, new Error("defineSchema: нужен транзакционный драйвер (pg, PGlite, Hyperdrive)"));
    const total = 1 + spec.resources.length + (spec.sql?.length ?? 0);
    const step = (done: number, name?: SyncStep["step"], what?: string) =>
      options.onStep?.(name ? { done, total, step: name, ...(what === undefined ? {} : { name: what }) } : { done, total });
    // В цикле скриптов имя `step` занято шагом SQL — этап отмечает `onSql`.
    const onSql = (index: number, id: string) => step(1 + spec.resources.length + index, "sql", id);
    step(0, "check");
    const { specs, want } = await prepare();
    const decisions = options.resolve ?? {};
    const deciding = Object.keys(decisions).length > 0;
    if (!deciding && (await upToDate(driver))) {
      step(total);
      return OK;
    }
    const report = await driver.transaction(async (tx) => {
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
        resolved: Step[] = [],
        conflicts: Step[] = [],
        notices: Step[] = [],
        foreign: Step[] = [];
      const used = new Set<string>();
      for (const [index, s] of specs.entries()) {
        step(1 + index, "table", spec.resources[index]!.table);
        const prev = have.get("table\0" + s.qualified);
        if (prev?.hash === s.fingerprint) continue;
        const detail = (typeof prev?.detail === "string" ? JSON.parse(prev.detail) : prev?.detail) as
          | { defaults?: Record<string, string | null> }
          | undefined;
        // План → автоматические шаги → решения человека → план заново: после
        // переименования или удаления колонки появляются новые автоматические шаги
        // (индексы на ней, добавление новой колонки). Внешние ключи — после всех таблиц.
        let steps: Step[] = [];
        for (let round = 0; round < 4; round++) {
          steps = await planTable(tx, s, detail);
          for (const step of steps.filter((x) => x.level === "auto" && x.kind !== "add_foreign").sort(byOrder)) {
            for (const text of step.sql) await run(text);
            applied.push(step);
          }
          const chosen = steps.filter((x) => x.level !== "auto" && decisions[stepKey(x)] !== undefined && !used.has(stepKey(x)));
          if (!chosen.length) break;
          for (const step of chosen) {
            const key = stepKey(step);
            used.add(key);
            for (const text of decidedSQL(step, decisions[key]!)) await run(text);
            resolved.push(step);
          }
        }
        foreign.push(...steps.filter((x) => x.kind === "add_foreign"));
        const blocking = steps.filter((x) => x.level === "conflict");
        conflicts.push(...blocking);
        notices.push(...steps.filter((x) => x.level === "notice"));
        if (!blocking.length)
          await record("table", s.qualified, s.fingerprint, {
            resource: s.resource,
            defaults: Object.fromEntries(s.columns.map((c) => [c.name, c.default])),
          });
      }
      for (const step of foreign) {
        for (const text of step.sql) await run(text);
        applied.push(step);
      }
      const unknown = Object.keys(decisions).filter((k) => !used.has(k));
      if (unknown.length)
        // Решение по шагу, которого нет в плане: экран устарел (другой экземпляр уже
        // применил или модель сменилась) — откат всего прогона, а не частичное применение.
        throw new DbFailure("conflict", { issues: [`defineSchema: шагов больше нет в плане: ${unknown.join(", ")}`] });
      for (const [index, step] of (spec.sql ?? []).entries()) {
        onSql(index, step.id);
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
        resolved: Object.freeze(resolved),
        conflicts: Object.freeze(conflicts),
        notices: Object.freeze(notices),
      }) as SchemaReport;
    });
    step(total);
    return report;
  }

  async function gate(
    driver: Driver,
    options: { onReport?: (report: SchemaReport) => void; onStep?: (step: SyncStep) => void } = {},
  ): Promise<Driver> {
    const report = await sync(driver, { onStep: options.onStep });
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

/** SQL по решению человека; решение, которого у шага нет, — отказ до выполнения. */
function decidedSQL(step: Step, choice: Choice): readonly string[] {
  if (!choices(step).includes(choice))
    throw new DbFailure("validation", {
      issues: [`defineSchema: решение «${String(choice)}» не подходит шагу ${stepKey(step)} (возможно: ${choices(step).join(", ") || "нет"})`],
    });
  if (step.kind === "rename_or_replace" && choice === "replace")
    return [`ALTER TABLE ${step.table} DROP COLUMN ${ident(step.from!)}`];
  return step.sql;
}

// Решения по шагам — отдельный модуль: формат `<choice>|<key>` знает только он
// (`./decisions.ts`), поэтому и форма приложения, и нативная форма без `lib/form`
// идут одной дорогой.
export { KEEP, decisionValue, decisionsFrom, decisionsFromForm, parseDecision } from "./decisions";
export type { DecisionChoice, DecisionValues, DecisionsResult, ParsedDecision } from "./decisions";

// Админка переноса: отчёт и выполнение решений под секретом. Библиотечная часть
// (`./admin.ts`) не знает ни окружения, ни маршрутов — их подставляет приложение.
export { createSchemaAdmin } from "./admin";
export type { ResolveOutcome, SchemaAdmin } from "./admin";
