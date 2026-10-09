/**
 * Живой прогон пакета против PostgreSQL **напрямую**, без pgproxy — тот путь, который
 * включился после смены стартового скрипта контейнера на `exec postgres -D …`.
 *
 *   PG_URL=postgres://user:pass@host:5432/db \
 *     [PG_MODULES=/home/user/integration/node_modules] [PG_GAP_MS=300] \
 *     node probe/pg-live.probe.mjs
 *
 * Вежливость к бесплатному хостингу: последовательно, ≤ 14 обращений, `max: 1` в пуле,
 * пауза между шагами, своя таблица `kit_probe_<tag>` и `DROP` в конце. Ничего чужого не
 * трогает и не пересоздаёт.
 *
 * Смысл проверок — ровно те границы, которые недоступны через HTTP/WS-прокси:
 * SQLSTATE (⇒ `conflict`, а не `database`, то есть и HTTP 409 из REST-слоя), настоящие
 * транзакции, savepoint-семантика вложенных `db.transaction`, типизация, `icontains`
 * (нужна UTF8-кодировка кластера — на SQL_ASCII ILIKE молча не находит ничего).
 */
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";

const PG_URL = process.env.PG_URL;
if (!PG_URL) {
  console.log("PG_LIVE_SKIPPED: нужен PG_URL (postgres://user:pass@host:5432/db)");
  process.exit(0);
}
// pg — peerDependency пакета: в каталоге пакета его может не быть, поэтому резолвим
// через приложение (там он настоящая зависимость). Пути-заглушки в createRequire —
// обычный приём, чтобы оттолкнуться от каталога, а не от файла.
const MODS = process.env.PG_MODULES ?? "/home/user/integration/node_modules";
const require_ = createRequire(MODS + "/stub.js");
let PoolCtor;
try {
  ({ Pool: PoolCtor } = require_("pg"));
} catch (error) {
  console.log("PG_LIVE_SKIPPED: не найден pg (" + error.message.split("\n")[0] + "); укажите PG_MODULES");
  process.exit(0);
}

const core = await import("../index");
const { pgAdapter } = await import("../adapters/pg");
const { DbFailure, createDb, defineResource, f, field, s, policy } = core;

const tag = process.env.PG_TAG ?? String(process.pid % 10000);
const table = "public.kit_probe_" + tag;
const GAP = Number(process.env.PG_GAP_MS ?? 300);
let queries = 0;
const out = [];

const check = async (name, fn, expect) => {
  let value;
  try {
    value = await fn();
  } catch (error) {
    value = error instanceof DbFailure ? `${error.kind}` : "ERR " + error.message;
  }
  const got = typeof value === "string" ? value : JSON.stringify(value);
  const errored = String(got).startsWith("ERR ") || String(got) === "database";
  // без expect строка информационная, но «✓» поверх ошибки врать не должна
  const ok = expect === undefined ? !String(got).startsWith("ERR ") : String(got) === String(expect);
  out.push([name, String(got), ok]);
  console.log(`  ${ok ? "✓" : "✗"} ${name.padEnd(52)} → ${String(got).slice(0, 90)}`);
  await sleep(GAP);
  return ok;
};

/**
 * Предполёт, чтобы не жечь таймауты и не грузить чужой хост: 8-байтовый SSLRequest.
 * Настоящий PostgreSQL отвечает `S` или `N` за миллисекунды. Если TCP открывается, а
 * протокол молчит — на порту сидит не Postgres: так ведёт себя Cloudflare/nginx, который
 * принимает :5432 на anycast-адресе и не проксирует его к origin (проверено 09.10.2026
 * на pzlbdb.freesrv.com — пул ждал 15 с на каждый запрос).
 */
async function preflight(url, ms = 4000) {
  const { hostname: host, port } = new URL(url);
  const net = await import("node:net");
  return await new Promise((resolve) => {
    const sock = net.connect({ host, port: Number(port) || 5432, timeout: ms });
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(r);
    };
    sock.on("connect", () => {
      const buf = Buffer.alloc(8);
      buf.writeInt32BE(8, 0);
      buf.writeInt32BE(80877103, 4); // SSLRequest
      sock.write(buf);
    });
    sock.once("data", (d) => finish({ ok: true, note: "SSLRequest → " + JSON.stringify(d.slice(0, 1).toString("latin1")) }));
    sock.on("timeout", () => finish({ ok: false, note: "TCP есть, ответа по протоколу нет за " + ms + " мс — это не Postgres (обычно Cloudflare/nginx на порту)" }));
    sock.on("error", (e) => finish({ ok: false, note: "net: " + e.code }));
  });
}

const pre = await preflight(PG_URL);
if (!pre.ok) {
  console.log("PG_LIVE_SKIPPED: " + pre.note);
  console.log("  (проверять маршруты до БД пулом — плохая вежливость; сначала raw-хендшейк)");
  process.exit(0); // пул ещё не создан: здесь и умирать нечем
}
console.log("предполёт: " + pre.note);

const pool = new PoolCtor({
  connectionString: PG_URL,
  max: 1,
  connectionTimeoutMillis: 15000,
  statement_timeout: 10000,
});
const q = async (text, values) => {
  queries++;
  const r = await pool.query(text, values);
  return r.rows;
};
const driver = pgAdapter(pool, 1, 30000);
const db = createDb({
  driver,
  limits: {
    pageSize: 20,
    maxPageSize: 100,
    maxPage: 1000,
    filterDepth: 8,
    filterNodes: 100,
    inValues: 100,
    inputKeys: 64,
  },
});

const probe = defineResource({
  key: "probe.post.v1",
  table,
  primaryKey: "id",
  fields: {
    id: f.uuid({ read: () => true, createValue: () => crypto.randomUUID(), immutable: true, orderable: true, filters: ["eq"] }),
    title: field(s.text({ min: 3, max: 40 }), {
      read: () => true,
      create: () => true,
      update: () => true,
      required: true,
      filters: ["eq", "contains", "icontains"],
      orderable: true,
    }),
    created_at: f.timestamp({ read: () => true, generated: true, orderable: true, filters: ["gt", "lt"] }),
  },
  policy: {
    select: policy.publicRows(),
    insert: policy.roles(["author"]),
    update: policy.roles(["author"]),
    delete: policy.roles(["author"]),
  },
  order: [["created_at", "desc"]],
});
const api = db.resource(probe);
const ctx = { principal: { id: "probe@" + tag, roles: ["author"] }, requestId: "probe-" + tag };

console.log(`звоним напрямую в ${PG_URL.replace(/:[^:@/]*@/, ":***@")} (последовательно, пауза ${GAP} мс)\n`);

let failed = 0;
const run = async (name, fn, expect) => {
  if (!(await check(name, fn, expect))) failed++;
};

try {
  await run("capabilities pg-драйвера", () =>
    JSON.stringify({
      transactions: driver.capabilities.transactions,
      savepoints: driver.capabilities.savepoints,
      sqlstate: driver.capabilities.sqlstate,
    }),
  JSON.stringify({ transactions: true, savepoints: true, sqlstate: true }));

  await run("кто отвечает (не pgproxy ли?)", async () => {
    const r = await q("select version() v, current_setting('listen_addresses') la, current_setting('port') p");
    return r[0].v.slice(0, 28) + " | listen=" + r[0].la + " port=" + r[0].p;
  });

  let encoding = "";
  await run("кодировка базы", async () => {
    const r = await q("select pg_encoding_to_char(encoding) enc from pg_database where datname = current_database()");
    encoding = r[0].enc;
    return encoding;
  });

  await run("DDL: своя таблица", async () => {
    await q(
      `create table if not exists ${table} (
         id uuid primary key,
         title text not null unique check (length(title) between 3 and 40),
         created_at timestamptz not null default clock_timestamp()
       )`,
    );
    return "создана";
  }, "создана");

  await run("insert через ресурс (2 строки)", async () => {
    await api.insert(ctx, { title: "проверка одна" });
    await api.insert(ctx, { title: "проверка две" });
    return (await api.count(ctx, {})).toString();
  }, "2");

  await run("дубликат UNIQUE → conflict + 23505 (чего нет у прокси)", async () => {
    try {
      await api.insert(ctx, { title: "проверка одна" });
      return "не отказал";
    } catch (e) {
      if (!(e instanceof DbFailure)) return "не DbFailure";
      return e.kind + "/" + (e.details?.sqlstate ?? "без sqlstate");
    }
  }, "conflict/23505");

  await run("транзакция с откатом ничего не оставляет", async () => {
    try {
      await db.transaction(async (tx) => {
        await tx.resource(probe).insert(ctx, { title: "проверка откат" });
        throw Error("rollback");
      });
    } catch {
      /* ожидаемый откат */
    }
    return (await api.count(ctx, {})).toString();
  }, "2");

  await run("savepoint: сбой вложенной транзакции не убивает внешнюю", async () => {
    await db.transaction(async (tx) => {
      await tx.resource(probe).insert(ctx, { title: "проверка внешняя" });
      await tx
        .transaction(async (inner) => {
          await inner.resource(probe).insert(ctx, { title: "д" }); // min 3 → отказ на валидации
        })
        .catch(() => {
          /* savepoint откатан, внешний блок продолжается */
        });
    });
    return (await api.count(ctx, {})).toString();
  }, "3");

  await run("icontains по регистру (UTF8 нужна)", async () => {
    if (encoding !== "UTF8") return "ПРОПУЩЕНО: кластер " + encoding;
    // `select` отдаёт массив строк (обёртка {items,total} — это уровень REST/sveltekit,
    // а не ресурса):первая наивная r.items.length дало undefined.
    const items = await api.select(ctx, { filter: { field: "title", op: "icontains", value: "ПРОВЕРКА ВНЕШНЯЯ" }, limit: 5 });
    return items.length + " совпадени(й) без учёта регистра";
  });

  await run("свойства строки после select", async () => {
    const rows = await api.select(ctx, { filter: { field: "title", op: "eq", value: "проверка одна" }, limit: 1 });
    const row = rows[0];
    return row ? `uuid=${/^[0-9a-f-]{36}$/.test(String(row.id))} created_at=${typeof row.created_at}` : "пусто";
  });

  await run("откат политики: чужая роль не пишет", async () => {
    try {
      await api.insert({ principal: { roles: ["guest"] } }, { title: "не надо" });
      return "не отказал";
    } catch (e) {
      return e instanceof DbFailure ? e.kind : "не DbFailure";
    }
  }, "forbidden");

  await run("очистка: таблица удалена", async () => {
    await q(`drop table if exists ${table}`);
    const r = await q(`select to_regclass('${table}') as t`);
    return r[0].t === null ? "нет таблицы" : "осталась!";
  }, "нет таблицы");
} finally {
  await pool.end().catch(() => {});
}

console.log(
  `\n${failed ? "PG_LIVE_FAIL: " + failed + " из " + out.length : "PG_LIVE_OK (" + out.length + " проверок)"} · обращений к серверу: ${queries + 2}`,
);
process.exit(failed ? 1 : 0);
