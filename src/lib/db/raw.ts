/**
 * Сырой экземпляр модели (`raw`): ничего не фильтрует, не проверяет и не дополняет — ни
 * при записи, ни при чтении (README §7 «Сырой экземпляр», решение владельца, ход 206). Нет прав
 * строк и полей, скрытия удалённых, хуков, белых списков фильтров и сортировки, лимитов
 * страницы, проверки схемой, `normalize`/`fill`/`createValue`/`store`, сдвига `updatedAt`,
 * мягкого удаления. Остаётся то, без чего запроса нет: имена полей → колонки (неизвестное
 * поле — `validation`), значения — параметрами SQL, транзакция, отмена по `signal`.
 */
import { DbFailure, fail } from "./errors";
import { chainDelete, chainPlan, deleteOptions } from "./chain";
import { estimateRows } from "./rules";
import { col, expr, filterSQL, ident, projection, Sql, table, orderSQL } from "./query/sql";
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
    // Путь `relation.field` — как в обычном ресурсе: связь объявлена, поле у цели есть.
    const badPath = (k: unknown): boolean => {
      if (typeof k !== "string") return true;
      const dot = k.indexOf(".");
      if (dot === -1) return !own(r.fields, k);
      const rel = r.relations?.[k.slice(0, dot)];
      return !rel || !own(rel.resource.fields, k.slice(dot + 1));
    };
    if (!Array.isArray(o) || o.some((p) => !Array.isArray(p) || badPath(p[0]) || !["asc", "desc"].includes(p[1])))
      fail("validation");
    return o.some(([k]) => k === r.primaryKey) ? o : [...o, [r.primaryKey, "asc"]];
  };
  const where = (ctx: DataContext, s: Sql, filter: Filter | undefined) => filterSQL(r, ctx, filter ?? true, s, OPEN, true);
  async function select(ctx0: DataContext, input: Row = {}) {
    const ctx = context(ctx0);
    if (!isRecord(input)) fail("validation");
    for (const k of Object.keys(input))
      if (!["fields", "filter", "order", "page", "limit", "includeDeleted", "include"].includes(k))
        fail(k === "after" ? "unsupported" : "validation", undefined, [`raw: ${k} не поддерживается`]);
    const limit = (input.limit as number | undefined) ?? db.limits.pageSize;
    const page = (input.page as number | undefined) ?? 1;
    if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(page) || page < 1) fail("validation");
    const s = new Sql();
    const predicate = await where(ctx, s, input.filter as Filter | undefined);
    const ord = order(input.order);
    // Сортировка по связанному полю подтягивает join сама, как в обычном ресурсе.
    const includeNames = [
      ...new Set([
        ...((input.include as readonly string[] | undefined) ?? []),
        ...ord.filter(([k]) => k.includes(".")).map(([k]) => k.slice(0, k.indexOf("."))),
      ]),
    ];
    const inc = includes(includeNames, s);
    const orderSql = ord.some(([k]) => k.includes("."))
      ? ord
          .map(([k, d]) => {
            const dot = k.indexOf(".");
            if (dot === -1) return col(r, k) + " " + d.toUpperCase() + " NULLS LAST";
            const alias = ident("_db_include_" + includeNames.indexOf(k.slice(0, dot)));
            return `${alias}.payload->>${s.param(k.slice(dot + 1))} ${d.toUpperCase()} NULLS LAST`;
          })
          .join(", ")
      : orderSQL(r, ord);
    return run(ctx, s, `SELECT ${projection(r, keysOf(input.fields))}${inc.select} FROM ${table(r)}${inc.joins} WHERE ${predicate} ORDER BY ${orderSql} LIMIT ${s.param(limit)} OFFSET ${s.param((page - 1) * limit)}`);
  }
  /**
   * Связанные записи сырого экземпляра — тоже сырые: все поля, без правил строк, удалённые
   * тоже. Ограничения те же, что у обычного `include`: связь по первичному ключу или
   * уникальному полю цели, не на свою таблицу, не больше 8.
   */
  function includes(names: unknown, s: Sql) {
    if (names === undefined) return { joins: "", select: "" };
    if (!Array.isArray(names) || names.length > 8 || new Set(names).size !== names.length) fail("validation");
    const joins: string[] = [];
    const select: string[] = [];
    names.forEach((name, i) => {
      if (typeof name !== "string" || !r.relations || !own(r.relations, name) || own(r.fields, name)) fail("validation", undefined, [`raw: нет связи ${String(name)}`]);
      const rel = r.relations[name]!;
      const target = rel.resource;
      // Как в обычном ресурсе: primaryKey цели или её уникальное поле (LATERAL с LIMIT 1).
      if (target.table === r.table || (rel.foreignField !== target.primaryKey && target.fields[rel.foreignField]?.db?.unique !== true) || !own(r.fields, rel.localField)) fail("unsupported");
      const alias = ident("_db_include_" + i);
      const object = `jsonb_build_object(${Object.keys(target.fields).map((k) => `${s.param(k)}::text, ${expr(target, k)}`).join(", ")})`;
      joins.push(
        ` LEFT JOIN LATERAL (SELECT ${object} AS payload FROM ${table(target)} WHERE ${col(target, rel.foreignField)} = ${col(r, rel.localField)} LIMIT 1) ${alias} ON TRUE`,
      );
      select.push(`${alias}.payload AS ${ident(name)}`);
    });
    return { joins: joins.join(""), select: select.length ? ", " + select.join(", ") : "" };
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
    // Сырой экземпляр не спрашивает «что изменилось»: у него нет ни политики, ни
    // времени, которым можно верить. Отказ, а не пустой ответ.
    changes: () => unsupported(),
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
    // сырой экземпляр удаляет только навсегда: `hard` ничего не меняет, `chain` — со звеньями (тоже сырыми)
    delete: (ctx, id, options) =>
      db.guard(() =>
        deleteOptions(options, true).chain
          ? chainDelete(db, r, context(ctx), id, true)
          : byId(ctx, id, (_s, match) => `DELETE FROM ${table(r)} WHERE ${match} RETURNING ${projection(r, all)}`),
      ),
    canDelete: (ctx0, ids) =>
      db.guard(async () => {
        const ctx = context(ctx0);
        if (!Array.isArray(ids) || !ids.length) fail("validation");
        const s = new Sql();
        const rows = await run(ctx, s, `SELECT ${projection(r, [r.primaryKey])} FROM ${table(r)} WHERE ${col(r, r.primaryKey)} IN (${ids.map((v) => s.param(v)).join(",")})`);
        return { allowed: rows.map((x) => x[r.primaryKey]), soft: false };
      }),
    chain: (ctx, id) => db.guard(() => chainPlan(db, r, context(ctx), id)),
    cursor: unsupported,
    restore: unsupported,
    // видна вся таблица, и удалённые тоже: без фильтра — статистика планировщика
    estimate: (ctx0, input = {}) =>
      db.guard(async () => {
        const ctx = context(ctx0);
        if (!isRecord(input) || Object.keys(input).some((k) => !["filter", "includeDeleted"].includes(k))) fail("validation");
        const s = new Sql();
        return estimateRows(db, r, ctx, s, await where(ctx, s, input.filter), !input.filter);
      }),
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
