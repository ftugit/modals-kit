/**
 * Живой прогон портированных pgproxy-адаптеров против настоящего прокси.
 *
 *   PROXY_URL=https://host[:port][/path] PROXY_SECRET=… \
 *     [PGPROXY_MODULES=/home/user/pgproxy-lab/node_modules] node probe/proxy-live.probe.mjs
 *
 * Рассчитан на хостинг, который нельзя loading-таргетить: последовательно, без
 * параллелизма, ≤ 12 запросов всего, между обращениями пауза. Ничего не пересоздаёт
 * в схеме, кроме собственной таблицы kit_probe_<tag>, и удаляет её.
 *
 * Проверки — ровно те границы, которые ради которых адаптер и написан:
 *   HTTP  : select, параметры, ошибка SQL как `database` (не `conflict`), транзакция запрещена;
 *   WS    : BEGIN/…/ROLLBACK одним сокетом (то есть сессия есть), savepoint-механика не нужна;
 *   вместе: одноразовость `?auth=`, отсутствие SQLSTATE, лимит maxInFlight.
 */
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";

const URL_ = process.env.PROXY_URL;
const SECRET = process.env.PROXY_SECRET;
if (!URL_ || !SECRET) {
  console.log("PROXY_LIVE_SKIPPED: нужны PROXY_URL и PROXY_SECRET");
  process.exit(0);
}
const MODS = process.env.PGPROXY_MODULES;
const require_ = MODS ? createRequire(MODS + "/stub.js") : createRequire(import.meta.url);
let WebSocketCtor;
try {
  ({ WebSocket: WebSocketCtor } = require_("ws"));
} catch {
  WebSocketCtor = globalThis.WebSocket;
}
if (!WebSocketCtor) {
  console.log("PROXY_LIVE_SKIPPED: нет WebSocket (Node < 21 и ws не найден)");
  process.exit(0);
}

const { proxyHttpAdapter, proxyWsAdapter } = await import("../adapters/proxy");
const { DbFailure } = await import("../errors");

const tag = process.env.PROXY_TAG ?? String(process.pid % 10000);
const table = "kit_probe_" + tag;
const GAP = Number(process.env.PROXY_GAP_MS ?? 400);
const out = [];
const check = async (name, fn, expect) => {
  let value;
  try {
    value = await fn();
  } catch (error) {
    value = error instanceof DbFailure ? `${error.kind}` : "ERR " + error.message;
  }
  const got = typeof value === "string" ? value : JSON.stringify(value);
  const ok = expect === undefined || String(got) === String(expect);
  out.push([name, String(got), ok]);
  await sleep(GAP);
  return ok;
};

const INSECURE = process.env.PROXY_INSECURE === "1";
const http = proxyHttpAdapter({
  url: URL_,
  secret: SECRET,
  allowInsecureLocalhost: INSECURE,
  timeoutMs: Number(process.env.PROXY_TIMEOUT_MS ?? 25000),
  maxInFlight: 1,
});
const ws = proxyWsAdapter({
  url: URL_,
  secret: SECRET,
  allowInsecureLocalhost: INSECURE,
  WebSocket: WebSocketCtor,
  timeoutMs: Number(process.env.PROXY_TIMEOUT_MS ?? 25000),
  maxInFlight: 1,
});

console.log("звоним на " + URL_ + " (последовательно, пауза " + GAP + " мс)\n");
await check("HTTP capabilities", async () => JSON.stringify(http.capabilities),
  JSON.stringify({ transactions: false, savepoints: false, sqlstate: false, isolationLevels: [] }));
await check("WS capabilities (сессия есть, SQLSTATE нет)", async () => JSON.stringify(ws.capabilities.transactions) + "/" + ws.capabilities.sqlstate, "true/false");
await check("HTTP select 1", async () => JSON.stringify((await http.query({ text: "select 1 as one" })).rows[0]));
await check("HTTP параметры уезжают в params, не в текст", async () =>
  JSON.stringify((await http.query({ text: "select $1::int + $2::int as sum", values: [2, 3] })).rows[0]));
await check("HTTP транзакция → unsupported (отказ до сети)", async () => {
  try {
    await http.transaction(async () => 1);
    return "не отказал";
  } catch (e) {
    return e instanceof DbFailure ? e.kind : String(e);
  }
}, "unsupported");
await check("HTTP " + table + ": DDL", async () => {
  await http.query({ text: `create table if not exists ${table} (n int primary key)` });
  return "ok";
}, "ok");
await check("HTTP вставка", async () => (await http.query({ text: `insert into ${table} values (1)` })).rowCount, "1");
await check("HTTP дубликат → database (SQLSTATE нет → ядро не может собрать 409)", async () => {
  try {
    await http.query({ text: `insert into ${table} values (1)` });
    return "принял дубликат";
  } catch (e) {
    return e instanceof DbFailure ? e.kind : String(e);
  }
}, "database");
await check("WS транзакция: откат не оставляет строку", async () => {
  try {
    await ws.transaction(async (t) => {
      await t.query({ text: `insert into ${table} values (2)` });
      throw new Error("откат");
    });
  } catch {
    /* ожидали */
  }
  return (await ws.query({ text: `select count(*)::int as n from ${table}` })).rows[0].n;
}, "1");
await check("WS два запроса в одной транзакции видят друг друга", async () =>
  await ws.transaction(async (t) => {
    await t.query({ text: `insert into ${table} values (3)` });
    return (await t.query({ text: `select count(*)::int as n from ${table}` })).rows[0].n;
  }), "2");
await check("убрать за собой", async () => {
  await http.query({ text: `drop table if exists ${table}` });
  return "ok";
}, "ok");

const failed = out.filter(([, , ok]) => !ok);
console.log("");
for (const [name, got, ok] of out) console.log((ok ? "  ✓ " : "  ✗ ") + name.padEnd(56) + " → " + got);
await http.close?.();
await ws.close?.();
console.log(failed.length ? `\nPROXY_LIVE_FAIL: ${failed.length} из ${out.length}` : `\nPROXY_LIVE_OK (${out.length} проверок)`);
process.exit(failed.length ? 1 : 0);
