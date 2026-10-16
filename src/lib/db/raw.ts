/**
 * Сырой экземпляр модели (`raw`): ничего не фильтрует, не проверяет и не дополняет — ни
 * при записи, ни при чтении (docs/design/model-automation.md §9, ответы хода 206). Нет прав
 * строк и полей, скрытия удалённых, хуков, белых списков фильтров и сортировки, лимитов
 * страницы, проверки схемой, `normalize`/`fill`/`createValue`/`store`, сдвига `updatedAt`,
 * мягкого удаления. Остаётся то, без чего запроса нет: имена полей → колонки (неизвестное
 * поле — `validation`), значения — параметрами SQL, транзакция, отмена по `signal`.
 */
import { DbFailure, fail } from "./errors";
import { col, filterSQL, ident, projection, Sql, table, orderSQL } from "./query/sql";
import { context, inputRecord, isRecord, MODELS, own } from "./validation";
import type { DataContext, Database, Filter, Limits, Order, Resource, ResourceApi, Row } from "./types";

/** Модель-двойник с признаком `raw`: по нему `db.resource` отдаёт сырой экземпляр. */
export function rawResource(model: Resource): Resource {
  const from = MODELS.get(model);
  const origin = from?.origin ?? model;
  const clone = Object.freeze({ ...origin });
  MODELS.set(clone, { source: from?.source ?? origin, origin, off: [], raw: true });
  return clone;
}

/** Лимиты сырого чтения: только защита самого процесса от бесконечного фильтра. */
const OPEN: Limits = Object.freeze({
  pageSize: 20, maxPageSize: Number.MAX_SAFE_INTEGER, maxPage: Number.MAX_SAFE_INTEGER,
  filterDepth: 64, filterNodes: 100_000, inValues: 100_000, inputKeys: 10_000,
});

export function rawApi(db: Database, r: Resource): ResourceApi {
  const all = Object.keys(r.fields);
  const keysOf = (fields: unknown): string[] => {
    if (fields === undefined) return all;
    if (!Array.isArray(fields) || fields.some((k) => typeof k !== "string" || !own(r.fields, k))) fail("validation");
    return [...new Set([r.primaryKey, ...(fields as string[])])];
  };
  const run = async (ctx: DataContext, s: Sql, text: string) =>
    (await db.query({ ...s.statement(text), ...(ctx.signal ? { signal: ctx.signal } : {}) })).rows;
  const record = (input: unknown): Row => {
    const row = inputRecord(input, all.length);
    for (const k of Object.keys(row)) if (!own(r.fields, k)) fail("validation", k);
    return row;
  };
  const sets = (s: Sql, row: Row) => Object.entries(row).map(([k, v]) => `${ident(r.fields[k]!.column ?? k)} = ${s.fieldParam(r.fields[k]!, v)}`);
  const order = (input: unknown): Order => {
    const o = (input ?? r.order) as Order;
    if (!Array.isArray(o) || o.some((p) => !Array.isArray(p) || !own(r.fields, p[0]) || !["asc", "desc"].includes(p[1])))
      fail("validation");
    return o.some(([k]) => k === r.primaryKey) ? o : [...o, [r.primaryKey, "asc"]];
  };
  const where = (ctx: DataContext, s: Sql, filter: Filter | undefined) => filterSQL(r, ctx, filter ?? true, s, OPEN, true);
  async function select(ctx0: DataContext, input: Row = {}) {
    const ctx = context(ctx0);
    if (!isRecord(input)) fail("validation");
    for (const k of Object.keys(input))
      if (!["fields", "filter", "order", "page", "limit", "includeDeleted"].includes(k))
        fail(k === "include" || k === "after" ? "unsupported" : "validation", undefined, [`raw: ${k} не поддерживается`]);
    const limit = (input.limit as number | undefined) ?? db.limits.pageSize;
    const page = (input.page as number | undefined) ?? 1;
    if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(page) || page < 1) fail("validation");
    const s = new Sql();
    const predicate = await where(ctx, s, input.filter as Filter | undefined);
    return run(ctx, s, `SELECT ${projection(r, keysOf(input.fields))} FROM ${table(r)} WHERE ${predicate} ORDER BY ${orderSQL(r, order(input.order))} LIMIT ${s.param(limit)} OFFSET ${s.param((page - 1) * limit)}`);
  }
  async function insertRows(ctx: DataContext, rows: Row[], dbx: Database, ignore: boolean) {
    const keys = Object.keys(rows[0]!);
    if (rows.some((x) => Object.keys(x).length !== keys.length || !keys.every((k) => own(x, k))))
      fail("validation", undefined, ["raw insertMany: у всех строк один набор полей"]);
    const s = new Sql();
    const values = rows.map((x) => "(" + keys.map((k) => s.fieldParam(r.fields[k]!, x[k])).join(",") + ")").join(",");
    const text = keys.length
      ? `INSERT INTO ${table(r)} (${keys.map((k) => ident(r.fields[k]!.column ?? k)).join(",")}) VALUES ${values}`
      : `INSERT INTO ${table(r)} DEFAULT VALUES`;
    return (await dbx.query({ ...s.statement(`${text}${ignore ? " ON CONFLICT DO NOTHING" : ""} RETURNING ${projection(r, all)}`), ...(ctx.signal ? { signal: ctx.signal } : {}) })).rows;
  }
  const byId = async (ctx0: DataContext, id: unknown, make: (s: Sql, match: string) => string) => {
    const ctx = context(ctx0);
    const s = new Sql();
    const row = (await run(ctx, s, make(s, `${col(r, r.primaryKey)} = ${s.param(id)}`)))[0];
    if (!row) fail("not_found");
    return row;
  };
  const unsupported = () => Promise.reject(new DbFailure("unsupported", { issues: ["raw: у сырого экземпляра этого нет"] }));
  const api: ResourceApi = {
    select: (ctx, input) => db.guard(() => select(ctx, (input ?? {}) as Row)),
    get: (ctx, id, input = {}) =>
      db.guard(async () => {
        const row = (await select(ctx, { ...input, filter: { field: r.primaryKey, op: "eq", value: id }, limit: 1 }))[0];
        if (!row) fail("not_found");
        return row;
      }),
    count: (ctx0, input = {}) =>
      db.guard(async () => {
        const ctx = context(ctx0);
        const s = new Sql();
        const rows = await run(ctx, s, `SELECT count(*)::text AS n FROM ${table(r)} WHERE ${await where(ctx, s, input.filter)}`);
        return Number(rows[0]!.n);
      }),
    insert: (ctx0, input) => db.guard(async () => (await insertRows(context(ctx0), [record(input)], db, false))[0]!),
    insertMany: (ctx0, rows, opts = {}) =>
      db.guard(async () => {
        const ctx = context(ctx0);
        if (!Array.isArray(rows) || !rows.length) fail("validation");
        const list = rows.map(record);
        const size = Math.max(1, Math.min(opts.chunkSize ?? 100, 500));
        if (list.length <= size) return insertRows(ctx, list, db, !!opts.onConflictIgnore);
        if (!db.driver.capabilities.transactions) fail("unsupported");
        return db.transaction(async (tx) => {
          const out: Row[] = [];
          for (let i = 0; i < list.length; i += size) out.push(...(await insertRows(ctx, list.slice(i, i + size), tx, !!opts.onConflictIgnore)));
          return out;
        });
      }),
    update: (ctx, id, patch) =>
      db.guard(() => {
        const row = record(patch);
        if (!Object.keys(row).length) fail("validation");
        return byId(ctx, id, (s, match) => `UPDATE ${table(r)} SET ${sets(s, row).join(",")} WHERE ${match} RETURNING ${projection(r, all)}`);
      }),
    delete: (ctx, id) => db.guard(() => byId(ctx, id, (_s, match) => `DELETE FROM ${table(r)} WHERE ${match} RETURNING ${projection(r, all)}`)),
    canDelete: (ctx0, ids) =>
      db.guard(async () => {
        const ctx = context(ctx0);
        if (!Array.isArray(ids) || !ids.length) fail("validation");
        const s = new Sql();
        const rows = await run(ctx, s, `SELECT ${projection(r, [r.primaryKey])} FROM ${table(r)} WHERE ${col(r, r.primaryKey)} IN (${ids.map((v) => s.param(v)).join(",")})`);
        return { allowed: rows.map((x) => x[r.primaryKey]), soft: false };
      }),
    cursor: unsupported,
    restore: unsupported,
    estimate: unsupported,
    validator: () => {
      throw new DbFailure("unsupported", { issues: ["raw: у сырого экземпляра нет проверки"] });
    },
    without: () => Promise.reject(new DbFailure("validation", { issues: ["without: у сырого экземпляра (raw) выключено всё"] })),
    raw: (fn) => db.guard(async () => fn(api)),
    behavior: () =>
      Object.freeze({
        timestamps: Object.freeze({ ...((r.timestamps ?? {}) as Record<string, string>) }),
        live: Object.freeze({ inserted: true as const, updated: false, deleted: false }),
        off: Object.freeze([]),
        raw: true,
      }),
  };
  return api;
}
