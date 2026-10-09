/**
 * Матрица транспортов: что у lib/db работает, а что отваливается, если БД доступна
 * только «по HTTP/через пулер», и деградирует ли ядро **явно**.
 *
 * Смысл: Vercel/Cloudflare не дают TCP-сессии (Neon HTTP, pgproxy, PgBouncer/Supavisor
 * в transaction mode, Hyperdrive). Вопрос был — нужен ли из-за этого отдельный lib.
 * Ответ измеряется здесь: ровно 5 возможностей завязаны на транзакцию/сессию, и все они
 * обязаны отказывать `unsupported` (или `database` там, где нет SQLSTATE), а не тихо
 * портить данные.
 *
 * Запуск:  node probe/transport-matrix.probe.mjs
 * Нужны: PostgreSQL 17 (CHECKLIST-2 §0) и запущенный pgproxy (лаборатория §0).
 * Переменные: PG_MATRIX_URL, PGPROXY_URL, PGPROXY_SECRET (обязательно), PGPROXY_MODULES.
 */
import assert from "node:assert/strict";
import { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
import { createDb, defineResource, conservativeLimits, f, make, policy, withRetry } from "../index";
import { createCursorCodec } from "../cursor/codec";
import { pgAdapter } from "../adapters/pg";
import { pgliteAdapter } from "../adapters/pglite";
import { applyMigrationText } from "../sveltekit/index";
import { proxyAdapters } from "./lib/proxy-driver.mjs";

const PG_URL = process.env.PG_MATRIX_URL ?? "postgres://postgres@127.0.0.1:5433/kitdb"; // та же БД, что у прокси
const PROXY_URL = process.env.PGPROXY_URL ?? "http://127.0.0.1:5434";
const SECRET = process.env.PGPROXY_SECRET ?? "";
if (!SECRET) {
  console.error("нужен PGPROXY_SECRET (тот же, что у запуска лаборатории; в репозиторий он не попадает)");
  process.exit(2);
}

const DDL = `DROP TABLE IF EXISTS probe_transport;
DROP TABLE IF EXISTS probe_migrated;
CREATE TABLE probe_transport (id serial PRIMARY KEY, tag text UNIQUE, n int NOT NULL DEFAULT 0);`;

const transportCfg = { url: PROXY_URL, secret: SECRET, allowInsecureLocalhost: true, timeoutMs: 8000, maxInFlight: 2 };
const { http, ws } = await proxyAdapters(transportCfg);

const pool = new Pool({ connectionString: PG_URL, max: 4 });
const transports = [
  { name: "pg (native PG17, пул)", driver: pgAdapter(pool), close: () => pool.end() },
  { name: "PGlite (memory)", driver: pgliteAdapter(new PGlite()) },
  { name: "pgproxy HTTP (без сессий)", driver: http },
  { name: "pgproxy WS (сессия есть)", driver: ws },
];

const resource = defineResource({
  key: "probe.transport.v1",
  table: "probe_transport",
  primaryKey: "id",
  fields: {
    id: f.integer({ read: () => true, orderable: true, filters: ["eq", "in"] }),
    tag: f.text({ read: () => true, create: () => true, update: () => true, required: true, filters: ["eq", "contains", "icontains"] }),
    n: f.integer({ read: () => true, create: () => true, update: () => true, orderable: true, filters: ["eq", "gte"] }),
  },
  policy: { select: () => true, insert: () => true, update: () => true, delete: () => true },
  order: [["id", "asc"]],
});
const withFinal = defineResource({ ...resource, key: "probe.transport.final.v1", validateFinal: make("probe", () => true) });

const DEBUG = process.env.DEBUG_MATRIX === "1";
const label = async (fn) => {
  try {
    const r = await fn();
    return typeof r === "string" ? r : "ok";
  } catch (e) {
    const kind = e?.kind ?? "throw";
    return DEBUG ? `${kind}: ${String(e?.cause?.message ?? e?.message).slice(0, 90)}` : kind;
  }
};

const ops = [
  ["DDL (DROP + CREATE последовательно)", (db) => (async () => { for (const t of DDL.split(";").filter(Boolean)) await db.query({ text: t }); })()],
  ["select + count + order + limit", (db) => {
    const api = db.resource(resource);
    return api.select({ principal: { roles: [] } }, { order: [["id", "desc"]], limit: 1 }).then(() => api.count({ principal: { roles: [] } }, {}));
  }],
  ["фильтр ILIKE (icontains)", (db) => db.resource(resource).select({ principal: { roles: [] } }, { filter: { field: "tag", op: "icontains", value: "AAA" } })],
  ["keyset-страница (cursor)", (db) => db.resource(resource).cursor({ principal: { roles: [] } }, { limit: 1 })],
  ["estimate (reltuples/EXPLAIN/count)", (db) =>
    db.resource(resource).estimate({ principal: { roles: [] } }, {}).then((r) => (r.exact ? "ok" : "ok"))],
  ["insert + update + delete", (db) => {
    const ctx = { principal: { roles: [] } };
    const api = db.resource(resource);
    return api.insert(ctx, { tag: "a1", n: 1 }).then((row) => api.update(ctx, row.id, { n: 2 }).then(() => api.delete(ctx, row.id)));
  }],
  ["insertMany (1 чанк)", (db) => db.resource(resource).insertMany({ principal: { roles: [] } }, [{ tag: "m1", n: 1 }, { tag: "m2", n: 2 }])],
  ["insertMany (3 чанка: на HTTP просто 3 INSERT подряд)", (db) =>
    db.resource(resource).insertMany({ principal: { roles: [] } }, Array.from({ length: 5 }, (_, i) => ({ tag: "c" + i, n: i })), { chunkSize: 2 })],
  ["insertMany (3 чанка) + atomic: true", (db) =>
    db.resource(resource).insertMany({ principal: { roles: [] } }, Array.from({ length: 5 }, (_, i) => ({ tag: "a" + i, n: i })), { chunkSize: 2, atomic: true })],
  ["транзакция: rollback не оставляет следов", async (db) => {
    const ctx = { principal: { roles: [] } };
    const before = await db.resource(resource).count(ctx, {});
    await assert.rejects(() =>
      db.transaction(async (tx) => {
        await tx.resource(resource).insert(ctx, { tag: "tx-rollback", n: 9 });
        throw new Error("откат");
      }),
    );
    const after = await db.resource(resource).count(ctx, {});
    if (after !== before) return "ДАННЫЕ ИСПОРЧЕНЫ";
    await db.transaction(async (tx) => {
      await tx.resource(resource).insert(ctx, { tag: "tx-commit", n: 9 });
    });
    return ((await db.resource(resource).count(ctx, {})) === before + 1 ? "ok" : "ДАННЫЕ ИСПОРЧЕНЫ");
  }],
  ["savepoint (вложенная откатка)", async (db) => {
    const ctx = { principal: { roles: [] } };
    await db.transaction(async (tx) => {
      await tx.resource(resource).insert(ctx, { tag: "sp-outer", n: 1 });
      await tx.transaction(async (inner) => {
        await inner.resource(resource).insert(ctx, { tag: "sp-inner", n: 2 });
        throw new Error("внутренний откат");
      }).catch(() => {});
    });
    const find = async (tag) => (await db.resource(resource).select(ctx, { filter: { field: "tag", op: "eq", value: tag }, limit: 1 })).length;
    const [outer, inner] = [await find("sp-outer"), await find("sp-inner")];
    return outer && !inner ? "ok" : `savepoint не изолировал (outer=${outer}, inner=${inner})`;
  }],
  ["write с hooks/validateFinal (хочет tx)", (db) =>
    db.resource(withFinal).insert({ principal: { roles: [] } }, { tag: "final-1", n: 1 }).then((row) => db.resource(withFinal).update({ principal: { roles: [] } }, row.id, { n: 3 }))],
  ["applyMigrationText (хочет tx)", (db) => applyMigrationText(db, "CREATE TABLE probe_migrated (x int);")],
  ["конфликт UNIQUE → 409 conflict", async (db) => {
    const ctx = { principal: { roles: [] } };
    await db.resource(resource).insert(ctx, { tag: "dup", n: 1 });
    const e = await label(() => db.resource(resource).insert(ctx, { tag: "dup", n: 2 }));
    return e === "conflict" ? "ok" : "kind=" + e;
  }],
  ["set_config(...,true) внутри транзакции", async (db) => {
    const got = await db.transaction(async (tx) => {
      await tx.query({ text: "SELECT set_config('probe.uid', $1, true)", values: ["u42"] });
      const r = await tx.query({ text: "SELECT current_setting('probe.uid', true) AS v" });
      return r.rows[0]?.v;
    });
    return got === "u42" ? "ok" : "потерян: " + JSON.stringify(got);
  }],
  ["set_config вне транзакции (пул = лотерея)", async (db) => {
    await db.query({ text: "SELECT set_config('probe.uid2', $1, true)", values: ["u7"] });
    const r = await db.query({ text: "SELECT current_setting('probe.uid2', true) AS v" });
    return r.rows[0]?.v === "u7" ? "совпало (нестабильно!)" : "потерян";
  }],
  ["TEMP TABLE в следующем запросе (лотерея пула, не гарантия)", async (db) => {
    const made = await label(() => db.query({ text: "CREATE TEMP TABLE IF NOT EXISTS probe_tmp (x int)" }));
    if (made !== "ok") return made;
    const r = await db.query({ text: "SELECT to_regclass('pg_temp.probe_tmp') AS t" });
    return r.rows[0]?.t == null ? "не видна" : "видна";
  }],
  ["withRetry обёртка (x3 на 40001)", async (db) => {
    let calls = 0;
    return await withRetry(db, async () => {
      calls++;
      if (calls < 2) {
        const { DbFailure } = await import("../errors");
        throw new DbFailure("transaction", { retryable: true });
      }
      return "ok";
    }, { wait: async () => {}, attempts: 3 });
  }],
];

const rows = [];
for (const t of transports) {
  const db = createDb({
    driver: t.driver,
    limits: conservativeLimits,
    cursorCodec: createCursorCodec({ keys: { v1: "0".repeat(32) }, activeKey: "v1", ttlSeconds: 600 }),
  });
  const cells = [];
  for (const [name, fn] of ops) {
    let value;
    try {
      value = await label(() => fn(db));
    } catch (e) {
      value = "throw";
    }
    cells.push([name, String(value)]);
  }
  rows.push([t.name, cells]);
  await t.driver.close?.().catch(() => {});
  await t.close?.();
}

const width = Math.max(...ops.map(([n]) => n.length));
const keys = rows.map(([, cells]) => cells.map(([k, v]) => [k, v]));
const nameWidth = Math.max(...rows.map(([n]) => n.length), ...rows.flatMap(([,c]) => c.map(([,v]) => String(v).length)));
console.log("\n" + " ".repeat(width + 3) + rows.map(([n]) => n.padEnd(Math.max(...rows.map(([x]) => x.length)) + 3)).join(""));
for (let i = 0; i < ops.length; i++) {
  const label2 = ops[i][0].padEnd(width);
  console.log(label2 + " │ " + rows.map(([, cells]) => String(cells[i][1]).padEnd(nameWidth + 3)).join(" │ "));
}

/* ── вердикт: что обязано деградировать ЯВНО, а не молча ───────────────────────── */
const byName = Object.fromEntries(rows.map(([name, cells]) => [name, Object.fromEntries(cells)]));
const cols = {
  pg: byName["pg (native PG17, пул)"],
  pglite: byName["PGlite (memory)"],
  http: byName["pgproxy HTTP (без сессий)"],
  ws: byName["pgproxy WS (сессия есть)"],
};
/** Опасные операции: обязан быть явный `unsupported`, а не тихая эмуляция. */
const NEEDS_TX = [
  "транзакция: rollback не оставляет следов",
  "savepoint (вложенная откатка)",
  "write с hooks/validateFinal (хочет tx)",
  "applyMigrationText (хочет tx)",
  "set_config(...,true) внутри транзакции",
  "insertMany (3 чанка) + atomic: true",
  "withRetry обёртка (x3 на 40001)",
];
/** Одиночные инструкции: обязаны работать везде, включая HTTP. */
const SINGLE_STATEMENT = [
  "DDL (DROP + CREATE последовательно)",
  "select + count + order + limit",
  "фильтр ILIKE (icontains)",
  "keyset-страница (cursor)",
  "estimate (reltuples/EXPLAIN/count)",
  "insert + update + delete",
  "insertMany (1 чанк)",
  "insertMany (3 чанка: на HTTP просто 3 INSERT подряд)",
];
for (const op of NEEDS_TX)
  assert.ok(String(cols.http[op]).includes("unsupported"), `${op}: на HTTP ожидался явный unsupported, получено ${cols.http[op]}`);
for (const [t, c] of Object.entries(cols)) {
  for (const op of SINGLE_STATEMENT) assert.equal(c[op], "ok", `${op}: обязан работать на ${t}`);
  for (const op of NEEDS_TX) {
    if (t === "http") continue;
    assert.ok(["ok", "видна", "ok (повтор)".includes(op) ? "ok" : "ok"].includes(String(c[op])) || String(c[op]).includes("ok"), `${op}: на ${t} должно быть ok, получено ${c[op]}`);
  }
}
// маппинг конфликта: с SQLSTATE = 409, без него = 500 (явно документированная потеря)
assert.equal(cols.pg["конфликт UNIQUE → 409 conflict"], "ok", "с SQLSTATE конфликт = 409");
assert.equal(cols.pglite["конфликт UNIQUE → 409 conflict"], "ok", "с SQLSTATE конфликт = 409");
assert.ok(/kind=database/.test(cols.http["конфликт UNIQUE → 409 conflict"]), "без SQLSTATE конфликт деградирует в 500");
assert.ok(/kind=database/.test(cols.ws["конфликт UNIQUE → 409 conflict"]), "без SQLSTATE конфликт деградирует в 500");
// сессионное состояние: вне транзакции его нет НИГДЕ (пул = лотерея) → только SET LOCAL в tx
for (const [t, c] of Object.entries(cols))
  assert.equal(c["set_config вне транзакции (пул = лотерея)"], "потерян", `${t}: сессионный set_config не должен переживать следующий запрос`);
/* ── цена round-trip: один и тот же запрос через каждый транспорт ───────────── */
const bench = async (name, driver) => {
  const db = createDb({ driver, limits: conservativeLimits });
  for (const t of DDL.split(";").filter(Boolean)) await db.query({ text: t }); // PGlite живёт в памяти
  await db.query({ text: "SELECT 1" }); // прогрев
  const t0 = performance.now();
  for (let i = 0; i < 40; i++) await db.resource(resource).select({ principal: { roles: [] } }, { limit: 1 });
  const ms = (performance.now() - t0) / 40;
  await driver.close?.().catch(() => {});
  return ms.toFixed(2);
};
const pool2 = new Pool({ connectionString: PG_URL, max: 4 });
const { http: http2, ws: ws2 } = await proxyAdapters(transportCfg);
const timing = [
  ["pg (пул)", await bench("pg", pgAdapter(pool2))],
  ["PGlite", await bench("pglite", pgliteAdapter(new PGlite()))],
  ["pgproxy HTTP", await bench("http", http2)],
  ["pgproxy WS", await bench("ws", ws2)],
];
void pool2.end();
console.log("\nround-trip одного select (40 повторов, localhost): " + timing.map(([n, ms]) => `${n} ${ms} мс`).join(" · "));
console.log("Каждый include = отдельный LATERAL-запрос → на HTTP-транспорте N+1 умножается на эти мс.");

console.log("\nВЫВОД: транспорт без транзакций теряет ровно 7 возможностей, и все 7 — явный unsupported;\nодиночные инструкции (включая ILIKE, estimate, insertMany в 1 чанк) работают как на pg.\n");
console.log("TRANSPORT_MATRIX_OK");
