/**
 * Что реально остаётся `pg`-драйверу, когда перед PostgreSQL стоит pooler в
 * transaction mode (PgBouncer/Supavisor — протокольно одно и то же). Замеры, а не
 * пересказ доков: транзакции, `-c` startup-параметры, SET LOCAL, именованные
 * prepared statements, TEMP, LISTEN, advisory locks, курсоры.
 *
 * Нужен pgbouncer, настроенный на pool_mode=transaction поверх локального PG17:
 *
 *   [databases]
 *   kitdb = host=/tmp port=5433 dbname=kitdb
 *   [pgbouncer]
 *   listen_addr = 127.0.0.1
 *   listen_port = 6432
 *   auth_type   = trust
 *   pool_mode   = transaction
 *   default_pool_size = 4
 *
 * Запуск: POOLER_URL=postgres://postgres@127.0.0.1:6432/kitdb DIRECT_URL=postgres://postgres@127.0.0.1:5433/kitdb \
 *         node probe/pooler.probe.mjs
 * Переменные: POOLER_URL, DIRECT_URL (для сравнения), POOLER_SESSION_URL (если есть session-mode).
 */
import { Pool } from "pg";

const POOL_URL = process.env.POOLER_URL ?? "postgres://postgres@127.0.0.1:6432/kitdb";
const DIRECT = process.env.DIRECT_URL ?? "postgres://postgres@127.0.0.1:5433/kitdb";

const out = [];
const measure = async (name, fn) => {
  let value;
  try {
    value = await fn();
  } catch (e) {
    value = "ERR: " + String(e.message).replace(/\s+/g, " ").slice(0, 70);
  }
  out.push([name, String(value)]);
  return value;
};

const withPool = async (opts, fn) => {
  const pool = new Pool({ connectionString: POOL_URL, max: 1, ...opts });
  try {
    return await fn(pool);
  } finally {
    await pool.end().catch(() => {});
  }
};
const q = (pool, text, values) => pool.query({ text, values });

/* ── A. startup-параметр `-c …`: доходит ли он вообще и живёт ли между запросами ── */
await measure("A1 `options=-c search_path=X` → SHOW search_path (1-й запрос)", () =>
  withPool({ options: "-c search_path=probe_pooler" }, async (pool) => String((await q(pool, "SHOW search_path")).rows[0].search_path)),
);
await measure("A2 то же, 2-й запрос (после возврата соединения в пул)", () =>
  withPool({ options: "-c search_path=probe_pooler" }, async (pool) => {
    await q(pool, "SELECT 1");
    return String((await q(pool, "SHOW search_path")).rows[0].search_path);
  }),
);
await measure("A3 `options=-c statement_timeout=1234ms` → SHOW statement_timeout", () =>
  withPool({ options: "-c statement_timeout=1234ms" }, async (pool) => {
    await q(pool, "SELECT 1");
    return String((await q(pool, "SHOW statement_timeout")).rows[0].statement_timeout);
  }),
);
await measure("A4 `options=-c application_name=x` → SHOW application_name", () =>
  withPool({ options: "-c application_name=probe_app" }, async (pool) => {
    await q(pool, "SELECT 1");
    return String((await q(pool, "SHOW application_name")).rows[0].application_name);
  }),
);

/* ── B. SET LOCAL внутри транзакции / вне ─────────────────────────────────────── */
await measure("B1 SET LOCAL внутри BEGIN…COMMIT", () =>
  withPool({}, async (pool) => {
    await q(pool, "BEGIN");
    await q(pool, "SELECT set_config('probe.guc', 'inside', true)");
    const v = (await q(pool, "SELECT current_setting('probe.guc', true)")).rows[0].current_setting;
    await q(pool, "COMMIT");
    return String(v);
  }),
);
await measure("B2 SET (session) вне транзакции, прочитать в следующем запросе", () =>
  withPool({}, async (pool) => {
    await q(pool, "SELECT set_config('probe.guc2', 'sess', false)");
    const v = (await q(pool, "SELECT current_setting('probe.guc2', true)")).rows[0].current_setting;
    return String(v);
  }),
);

/* ── C. prepared statements: именованные vs безымянные (дефолт node-postgres) ──── */
await measure("C1 PREPARE p1 AS SELECT 1 (именованный, SQL-уровень)", () =>
  withPool({}, async (pool) => {
    await q(pool, "PREPARE p1 AS SELECT 42");
    const v = (await q(pool, "EXECUTE p1")).rows[0];
    await q(pool, "DEALLOCATE p1").catch(() => {});
    return "ok " + JSON.stringify(v);
  }),
);
await measure("C2 pg-параметризованный запрос (unnamed extended protocol)", () =>
  withPool({}, async (pool) => JSON.stringify((await q(pool, "SELECT $1::int AS n", [7])).rows[0])),
);
await measure("C3 pg-запрос с `name` (именованный prepared в драйвере)", () =>
  withPool({}, async (pool) => {
    const r = await pool.query({ name: "probe_named", text: "SELECT $1::int AS n", values: [1] });
    return "ok " + JSON.stringify(r.rows[0]);
  }),
);

/* ── D. явная транзакция через НЕСКОЛЬКО round-trip: жива ли атомарность ───────── */
await measure("D1 BEGIN/INSERT/await/INSERT/COMMIT → обе строки", () =>
  withPool({}, async (pool) => {
    await q(pool, "DROP TABLE IF EXISTS probe_pooler_tx");
    await q(pool, "CREATE TABLE probe_pooler_tx (n int)");
    await q(pool, "BEGIN");
    await q(pool, "INSERT INTO probe_pooler_tx VALUES (1)");
    await new Promise((r) => setTimeout(r, 50)); // клиент «думает» между запросами
    await q(pool, "INSERT INTO probe_pooler_tx VALUES (2)");
    await q(pool, "COMMIT");
    return "строк = " + (await q(pool, "SELECT count(*)::int c FROM probe_pooler_tx")).rows[0].c;
  }),
);
await measure("D2 BEGIN/INSERT/ROLLBACK → ни одной строки", () =>
  withPool({}, async (pool) => {
    await q(pool, "BEGIN");
    await q(pool, "INSERT INTO probe_pooler_tx VALUES (3)");
    await q(pool, "ROLLBACK");
    return "строк = " + (await q(pool, "SELECT count(*)::int c FROM probe_pooler_tx")).rows[0].c;
  }),
);
await measure("D3 ошибку внутри tx видно (constraint) и транзакция откатана", () =>
  withPool({}, async (pool) => {
    await q(pool, "BEGIN");
    await q(pool, "INSERT INTO probe_pooler_tx VALUES (9)", []).catch(() => {});
    try {
      await q(pool, "INSERT INTO probe_pooler_tx(n) VALUES (CAST('x' AS int))");
      return "ожидались ошибки";
    } catch (e) {
      const msg = String(e.message).slice(0, 30);
      await q(pool, "ROLLBACK").catch(() => {});
      return "откат ок: " + msg;
    }
  }),
);

/* ── E–H. сессионные фичи ─────────────────────────────────────────────────────── */
await measure("E1 TEMP TABLE: создать, прочитать в следующем запросе", () =>
  withPool({}, async (pool) => {
    await q(pool, "CREATE TEMP TABLE probe_tmp (x int) ON COMMIT DROP").catch(() => {});
    await q(pool, "CREATE TEMP TABLE IF NOT EXISTS probe_tmp2 (x int)");
    await q(pool, "INSERT INTO probe_tmp2 VALUES (1)");
    const r = await q(pool, "SELECT count(*)::int c FROM probe_tmp2");
    return "видна, строк = " + r.rows[0].c;
  }),
);
await measure("E2 LISTEN probe_ch", () =>
  withPool({}, async (pool) => {
    await q(pool, "LISTEN probe_ch");
    return "принято (уведомления не доставляются без сессии?)";
  }),
);
await measure("F1 pg_advisory_lock(77) вне транзакции (session-level)", () =>
  withPool({}, async (pool) => {
    await q(pool, "SELECT pg_advisory_lock(77)");
    await q(pool, "SELECT pg_advisory_unlock(77)").catch(() => {});
    return "получен";
  }),
);
await measure("G1 DECLARE c1 CURSOR … FETCH (вне явной tx)", () =>
  withPool({}, async (pool) => {
    await q(pool, "BEGIN");
    await q(pool, "DECLARE c1 CURSOR FOR SELECT n FROM probe_pooler_tx ORDER BY n");
    const a = (await q(pool, "FETCH FORWARD 1 FROM c1")).rows;
    await q(pool, "CLOSE c1").catch(() => {});
    await q(pool, "COMMIT");
    return "fetch = " + JSON.stringify(a);
  }),
);
await measure("H1 дисконнект посреди транзакции → авто-откат", () =>
  (async () => {
    const pool = new Pool({ connectionString: POOL_URL, max: 1 });
    await q(pool, "BEGIN");
    await q(pool, "INSERT INTO probe_pooler_tx VALUES (99)");
    await pool.end().catch(() => {}); // без COMMIT
    const fresh = new Pool({ connectionString: POOL_URL, max: 1 });
    const c = (await q(fresh, "SELECT count(*)::int c FROM probe_pooler_tx WHERE n = 99")).rows[0].c;
    await fresh.end();
    return c === 0 ? "откатано" : "ЗАПИСАНО " + c;
  })(),
);

/* ── I. что должен сделать пакет: withTestDb обязан отказаться писать в public ─── */
let guard = "не проведён (нет dist-сборки)";
try {
  const { withTestDb } = await import("../dist/testing/index");
  guard = await withTestDb(
    async ({ schema }) => "ПРОПУСТИЛ ОПАСНЫЙ ПРОГОН, schema=" + schema,
    { url: POOL_URL, migrations: ["CREATE TABLE probe_leak (x int);"] },
  ).then(
    (v) => v,
    (e) => `${e?.kind}: ${String(e?.details?.issues?.[0] ?? e?.message).slice(0, 80)}`,
  );
} catch (e) {
  guard = "ERR " + String(e.message).slice(0, 60);
}
out.push(["I1 withTestDb({url: пулер}) → ожидаемо unsupported", String(guard)]);

/* ── J. просачивание чужого состояния (3 клиента, 1 серверное соединение) ─────── */
const mkPool = () => new Pool({ connectionString: POOL_URL, max: 1 });
{
  const [p1, p2, p3] = [mkPool(), mkPool(), mkPool()];
  await p1.query("CREATE TABLE IF NOT EXISTS probe_pooler_tx (n int)");
  await p1.query("SELECT set_config('probe.who', 'client1', false)");
  await p1.query("CREATE TEMP TABLE IF NOT EXISTS probe_tmp_shared (x int)");
  await p1.query("INSERT INTO probe_tmp_shared VALUES (1)").catch(() => {});
  const seenBy = async (p, name) => {
    const who = await p
      .query("SELECT current_setting('probe.who', true) AS v")
      .then((r) => String(r.rows[0].v))
      .catch(() => "?");
    const tmp = await p
      .query("SELECT count(*)::int AS c FROM probe_tmp_shared")
      .then((r) => "видна(" + r.rows[0].c + ")")
      .catch(() => "нет");
    return name + ": set_config=" + JSON.stringify(who) + ", TEMP=" + tmp;
  };
  out.push(["J1 чужой session-SET/TEMP у клиента 2", await seenBy(p2, "клиент 2")]);
  out.push(["J2 чужой session-SET/TEMP у клиента 3", await seenBy(p3, "клиент 3")]);
  const pids = new Set();
  for (let i = 0; i < 8; i++) {
    try {
      const r = await p2.query({ name: "leak_p" + i, text: "SELECT pg_backend_pid() AS pid" });
      pids.add(r.rows[0].pid);
    } catch {}
  }
  out.push(["J3 именованные prepared statements: разных серверных pid за 8 запросов", String(pids.size)]);
  for (const p of [p1, p2, p3]) await p.end().catch(() => {});
  await new Pool({ connectionString: DIRECT, max: 1 }).query("DROP TABLE IF EXISTS probe_pooler_tx").catch(() => {});
}

/* ── сравнение: прямое соединение (тот же прогон) ─────────────────────────────── */
const directResults = [];
{
  const pool = new Pool({ connectionString: DIRECT, max: 1 });
  const dm = async (name, fn) => {
    try {
      directResults.push([name, String(await fn())]);
    } catch (e) {
      directResults.push([name, "ERR: " + String(e.message).replace(/\s+/g, " ").slice(0, 70)]);
    }
  };
  await dm("A2 search_path 2-м запросом", async () => {
    await pool.query({ text: "SELECT 1" });
    return (await pool.query("SHOW search_path")).rows[0].search_path;
  });
  await dm("C1 PREPARE/EXECUTE", async () => {
    await pool.query("PREPARE p2 AS SELECT 42");
    const v = (await pool.query("EXECUTE p2")).rows[0];
    return JSON.stringify(v);
  });
  await dm("E1 TEMP TABLE", async () => {
    await pool.query("CREATE TEMP TABLE IF NOT EXISTS probe_tmp3 (x int)");
    await pool.query("INSERT INTO probe_tmp3 VALUES (1)");
    await pool.query("SELECT 1");
    const r = await pool.query("SELECT count(*)::int c FROM probe_tmp3");
    return "видна, строк = " + r.rows[0].c;
  });
  await dm("E2 LISTEN", async () => {
    await pool.query("LISTEN probe_ch");
    return "принято";
  });
  await dm("F1 advisory lock", async () => {
    await pool.query("SELECT pg_advisory_lock(78)");
    await pool.query("SELECT pg_advisory_unlock(78)").catch(() => {});
    return "получен";
  });
  await pool.query("DROP TABLE IF EXISTS probe_pooler_tx").catch(() => {});
  await pool.end();
}

const w = Math.max(...out.map(([n]) => n.length));
console.log(`\ntransaction-mode pooler (PgBouncer ${process.env.POOLER_LABEL ?? ""}) : ${POOL_URL}\n`);
for (const [n, v] of out) console.log(n.padEnd(w) + " │ " + v);
console.log("\nто же самое прямым соединением (" + DIRECT + "):\n");
for (const [n, v] of directResults) console.log(n.padEnd(38) + " │ " + v);
console.log("\nPOOLER_PROBE_DONE");
