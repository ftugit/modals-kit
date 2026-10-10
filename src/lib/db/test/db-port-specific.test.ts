/**
 * Проверки собственно адаптации: то, чего в источнике не было
 * (SvelteKit-слой, signal, zero-dep схемы, разбор SQL, маппинг в ошибки формы).
 */
import assert from "node:assert/strict";
import { z } from "zod";
import {
  conservativeLimits,
  createDb,
  withRetry,
  defineResource,
  f,
  field,
  policy,
  s,
  DbFailure,
  normalizeFailure,
} from"../index";
import {
  BodyTooLarge,
  cursorCodecFromEnv,
  dbHandle,
  parseListInput,
  readJson,
  toFormFailure,
  toKitError,
  FAILURE_STATUS,
} from"../sveltekit/index";
import { applyMigrationText, splitSqlStatements } from"../sveltekit/migrate";
import { openNodeDatabase } from"../sveltekit/node";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { hyperdriveAdapter } from"../adapters/hyperdrive";
import type { Driver, Statement, QueryResult, Row } from"../index";
import { it } from 'vitest'

/**
 * Каждая группа — отдельный `it`: имена и порядок те же, что были у самописца.
 * Таймаут 30 с, а не дефолтные 5: группы поднимают PGlite (WASM-инициализация)
 * и прогоняют fail-fast ветку прокси-адаптера, у которой предельный `timeoutMs`
 * — 15 с; за 5 с она не успевает честно дойти до отказа.
 */
const test = (name: string, fn: () => Promise<void> | void) => it(name, fn, 30_000)

/* ── фикстура: драйвер-заглушка, записывающий statements ─────────────────── */
function stubDriver(onQuery?: (s: Statement) => Row[]): Driver & { seen: Statement[]; tx: number } {
  const seen: Statement[] = [];
  return {
    seen,
    tx: 0,
    capabilities: {
      transactions: true,
      savepoints: true,
      sqlstate: true,
      isolationLevels: ["read committed", "repeatable read", "serializable"],
    },
    query<T extends Row>(s: Statement): Promise<QueryResult<T>> {
      seen.push(s);
      // onQuery может вернуть строки (имитация RETURNING) — иначе пусто.
      const rows = (onQuery?.(s) ?? []) as T[];
      return Promise.resolve({ rows, rowCount: rows.length });
    },
    transaction<T>(fn: (tx: Driver) => Promise<T>): Promise<T> {
      this.tx++;
      return fn(this);
    },
  };
}
const posts = defineResource({
  key: "test.post.v1",
  table: "public.post",
  primaryKey: "id",
  fields: {
    id: f.uuid({ read: () => true, createValue: () => crypto.randomUUID(), immutable: true, filters: ["eq"], orderable: true }),
    title: field(s.text({ min: 3, max: 10 }), {
      read: () => true,
      create: () => true,
      update: () => true,
      required: true,
      filters: ["eq", "contains"],
      orderable: true,
    }),
    at: f.timestamp({ read: () => true, create: () => true, update: () => true, filters: ["eq"], orderable: true }),
  },
  policy: { select: policy.publicRows(), insert: () => true, update: policy.deny(), delete: policy.deny() },
  order: [["at", "desc"]],
});

/* ── 1. DataContext.signal доезжает до Statement, и только из сервера ─────── */
test("ctx.signal попадает в Statement, а чужие поля ctx — нет", async () => {
  const driver = stubDriver();
  const db = createDb({ driver, limits: conservativeLimits });
  const ac = new AbortController();
  const ctx = Object.freeze({ principal: { roles: [] as string[] }, signal: ac.signal }) as any;
  await db.resource(posts).select({ ...ctx, extra: "from-client" });
  assert.equal(driver.seen.length, 1);
  assert.equal(driver.seen[0].signal, ac.signal, "signal должен доехать до драйвера");
});
test("отменённый до запроса signal не порождает SQL у адаптера Hyperdrive", async () => {
  const calls: string[] = [];
  const client = {
    query: async (text: string) => { calls.push(text); return { rows: [], rowCount: 0 }; },
    end: async () => {}, on: () => {}, once: () => {}, removeListener: () => {},
  };
  const driver = hyperdriveAdapter({
    connectionString: "postgres://x/y",
    openClient: async () => client as any,
  });
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    () => driver.query({ text: "SELECT 1", signal: ac.signal }),
    (e) => e instanceof DbFailure && e.kind === "unavailable",
  );
  assert.deepEqual(calls, [], "уже отменённый запрос не должен уходить на сервер вовсе");
});
test("Hyperdrive: backpressure отказывает сразу, без очереди", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const client = {
    query: async () => { await gate; return { rows: [{ n: 1 }], rowCount: 1 }; },
    end: async () => {},
  };
  const driver = hyperdriveAdapter({
    connectionString: "postgres://x/y", maxInFlight: 1, openClient: async () => client as any,
  });
  const first = driver.query({ text: "SELECT 1" });
  await assert.rejects(
    () => driver.query({ text: "SELECT 2" }),
    (e) => e instanceof DbFailure && e.kind === "unavailable",
  );
  release();
  await first;
});

/* ── 2. Сообщения схемы доходят до формы (в источнике терялись) ──────────── */
test("toFormFailure: тексты Standard Schema идут в fieldErrors по полям", async () => {
  const db = createDb({ driver: stubDriver(), limits: conservativeLimits });
  const ctx = { principal: { roles: [] as string[] } };
  const before = Date.now();
  const err = await db.resource(posts).insert(ctx, { title: "ab", at: new Date(before).toISOString() }).catch((e) => e);
  assert.ok(err instanceof DbFailure && err.kind === "validation");
  const out = toFormFailure(err);
  assert.equal(out.status, 422);
  assert.deepEqual(Object.keys(out.data.fieldErrors), ["title"]);
  assert.match(out.data.fieldErrors.title[0]!, /Too small/);
  const dev = toFormFailure(err, true);
  assert.equal(dev.data.fieldErrors.title[0], out.data.fieldErrors.title[0]);
});
test("toKitError: 404 для not_found, SQL и cause наружу не уходят", async () => {
  const { status, body } = toKitError(new DbFailure("not_found"));
  assert.equal(status, 404);
  assert.equal(body.code, "not_found");
  assert.equal(JSON.stringify(body).includes("SELECT"), false);
  assert.equal(JSON.stringify(body).includes("diagnostic"), false);
  const dev = toKitError(new DbFailure("database", { sqlstate: "42P01", condition: "undefined_table" }), true);
  assert.equal(dev.status, 500);
  assert.deepEqual(dev.body.diagnostic, { sqlstate: "42P01", condition: "undefined_table", field: undefined });
});

/* ── 3. Разбор query → ListInput (deny-safe, как в источнике) ────────────── */
test("parseListInput повторяющиеся и неизвестные ключи, курсорные конфликты", () => {
  assert.deepEqual(parseListInput(new URLSearchParams("page=2&limit=5")), { page: 2, limit: 5 });
  assert.deepEqual(parseListInput(new URLSearchParams("fields=a,b")), { fields: ["a", "b"] });
  assert.deepEqual(parseListInput(new URLSearchParams('order=[["title","desc"]]')), { order: [["title", "desc"]] });
  for (const q of ["sort=title", "limit=1&limit=2", "page=0", "limit=1e9", "filter=notjson", "includeDeleted=yes", "order=[bad]"])
    assert.throws(() => parseListInput(new URLSearchParams(q)), (e) => e instanceof DbFailure && e.kind === "validation", q);
  assert.throws(() => parseListInput(new URLSearchParams("page=2"), { cursor: true }), /./);
  assert.deepEqual(parseListInput(new URLSearchParams("after=x"), { cursor: true }), { after: "x" });
});
test("parseListInput: маркер form action SvelteKit не считается мусором", () => {
  // На POST `?/create` попадает в `event.url.searchParams` как «/create»="" —
  // load не должен падать. Со значением — это уже данные клиента: отказ.
  assert.deepEqual(parseListInput(new URLSearchParams("/create")), {});
  assert.deepEqual(parseListInput(new URLSearchParams("limit=2&/remove")), { limit: 2 });
  for (const q of ["/create=1", "/a&/a", "/a/b"])
    assert.throws(() => parseListInput(new URLSearchParams(q)), (e) => e instanceof DbFailure && e.kind === "validation", q);
});

const insertReturning = (s: Statement) => {
  const tuples = /VALUES/.test(s.text) ? (s.text.match(/\)\s*,\s*\(/g) ?? []).length + 1 : 1;
  return Array.from({ length: tuples }, (_, i) => ({
    id: `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`,
  }));
};

test("insertMany: один INSERT на пачку, валидация та же, лимиты честные", async () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ title: `запись ${i}`, at: "2024-01-01T00:00:00Z" }));
  const driver = stubDriver(insertReturning);
  const db = createDb({ driver, limits: conservativeLimits });
  const ctx = { principal: { roles: [] as string[] } };
  const out = await db.resource(posts).insertMany(ctx, rows(3));
  const st = driver.seen[driver.seen.length - 1]!;
  assert.equal(out.length, 3, "RETURNING отдаётся построчно");
  assert.equal(
    (String(st.text).match(/\),\(/g) ?? []).length,
    2,
    "одна инструкция на три кортежа",
  );
  assert.ok(
    /^INSERT INTO "public"\."post" \("title","at","id"\) VALUES/.test(String(st.text)),
    String(st.text).slice(0, 90),
  );
  assert.ok(!/\*/.test(String(st.text)), "проекция RETURNING — явный список");
  assert.equal(st.values?.length, 9, "колонки × строки; id добавлен из createValue");
  // чужое поле в write-маске = отказ, а не «тихо пропущено»
  await assert.rejects(
    () => db.resource(posts).insertMany(ctx, [{ title: "abcd", id: "11111111-1111-4111-8111-111111111111" }]),
    (e: DbFailure) => e.kind === "validation" || e.kind === "forbidden",
  );
  await assert.rejects(
    () => db.resource(posts).insertMany(ctx, [] as never[]),
    (e: DbFailure) => e.kind === "validation",
    "пустая пачка не порождает SQL",
  );
  // разные наборы полей → отказ (иначе часть строк получила бы DEFAULT)
  await assert.rejects(
    () => db.resource(posts).insertMany(ctx, [{ title: "abcd" }, { title: "efgh", at: "2024-01-01T00:00:00Z" }]),
    (e: DbFailure) => e.kind === "validation" && /одинаковый набор/.test((e.details.issues as string[]).join(" ")),
  );
  // короткий RETURNING (потеря строк без ON CONFLICT) = ошибка, а не «тихий недобор»
  await assert.rejects(
    () =>
      createDb({ driver: stubDriver(() => [{ id: "11111111-1111-4111-8111-111111111111" }]), limits: conservativeLimits })
        .resource(posts)
        .insertMany(ctx, rows(3)),
    (e: DbFailure) => e.kind === "database" && /RETURNING не совпал/.test((e.details.issues as string[]).join(" ")),
  );
  // тот же случай легален с ON CONFLICT DO NOTHING
  const ignored = await createDb({ driver: stubDriver(() => [{ id: "11111111-1111-4111-8111-111111111111" }]), limits: conservativeLimits })
    .resource(posts)
    .insertMany(ctx, rows(3), { onConflictIgnore: true });
  assert.equal(ignored.length, 1, "skipped-строки не выдумываются");

  // хук/validateFinal = построчный контроль → пакетный путь закрыт явно
  const hooked = defineResource({
    ...posts,
    key: "test.post.hooked.v1",
    hooks: { afterWrite: async () => {} },
  });
  await assert.rejects(
    () => db.resource(hooked).insertMany(ctx, rows(2)),
    (e: DbFailure) => e.kind === "unsupported",
  );
  // больше одного чанка на транзакционном транспорте = одна транзакция
  const big = stubDriver(insertReturning);
  const db2 = createDb({ driver: big, limits: conservativeLimits });
  await db2.resource(posts).insertMany(ctx, rows(5), { chunkSize: 2 });
  assert.ok(big.tx >= 1, "пачка из 5 при chunkSize 2 идёт в транзакции");
  assert.equal(big.seen.filter((s) => /INSERT/.test(s.text)).length, 3, "3 чанка = 3 INSERT");

  // Транспорт без транзакций (HTTP/пулер): по умолчанию пачка дописывается
  // последовательно, а { atomic: true } отказывает ДО первого запроса на запись.
  const noTxBase = stubDriver(insertReturning);
  const noTx: Driver & { seen: Statement[] } = {
    ...noTxBase,
    capabilities: { transactions: false, savepoints: false, sqlstate: true, isolationLevels: [] },
  };
  const dbNoTx = createDb({ driver: noTx, limits: conservativeLimits });
  await dbNoTx.resource(posts).insertMany(ctx, rows(5), { chunkSize: 2 });
  assert.equal(
    noTx.seen.filter((s) => /INSERT/.test(s.text)).length,
    3,
    "без tx пачка = 3 INSERT подряд (неатомарно, но без вранья о результате)",
  );
  noTx.seen.length = 0;
  await assert.rejects(
    () => dbNoTx.resource(posts).insertMany(ctx, rows(5), { chunkSize: 2, atomic: true }),
    (e: DbFailure) =>
      e.kind === "unsupported" && /atomic/.test((e.details.issues as string[]).join(" ")),
  );
  assert.equal(noTx.seen.filter((s) => /INSERT/.test(s.text)).length, 0, "отказ до первого INSERT");
});

test("pgAdapter: отменяемый запрос возвращает соединение в пул (иначе пул высыхает)", async () => {
  const { pgAdapter } = await import("../adapters/pg.ts");
  const mk = (behavior: "ok" | "hang") => {
    let releases = 0;
    let checkedOut = 0;
    let fail: (e: unknown) => void = () => {};
    const client = {
      processID: 42,
      query: () =>
        behavior === "ok"
          ? Promise.resolve({ rows: [{ one: 1 }], rowCount: 1, command: "SELECT" })
          : new Promise((_res, rej) => { fail = rej as (e: unknown) => void; }),
      // pg-pool запрещает второй release на том же клиенте (_releaseOnce) — стаб это
      // повторяет: двойной release обязан уронить тест.
      release: (err?: unknown) => {
        if (checkedOut === 0) throw new Error("double release: pg-pool не переживает повторный release");
        checkedOut--;
        releases++;
        void err;
      },
      // обрыв сокета — это I/O, а не текущий микротаск: иначе он выиграл бы гонку у
      // reject() из cancel() и тест проверял бы не то
      end: async () => { setTimeout(() => fail(new Error("connection terminated")), 0); },
      once: () => {},
      removeListener: () => {},
    };
    const pool = {
      connect: async () => { checkedOut++; return client; },
      query: async (text: string) =>
        /pg_cancel_backend/.test(text) ? { rows: [{ cancel: true }], rowCount: 1 } : { rows: [], rowCount: 0 },
      on: () => {},
      end: async () => {},
    };
    return { driver: pgAdapter(pool as unknown as import("pg").Pool, 4, 30_000), stats: () => ({ releases, checkedOut }) };
  };
  // Успех: каждый запрос забирает и ОБЯЗАН вернуть соединение. До 2026-10-09 возврата
  // не было, и приложение на signal-запросах умирало, не доживая до простоя: пул max=2
  // исчерпывался двумя запросами, дальше — виси до connectionTimeoutMillis и 500.
  const ok = mk("ok");
  for (let i = 0; i < 3; i++) await ok.driver.query({ text: "select 1 as one", signal: new AbortController().signal });
  assert.deepEqual(ok.stats(), { releases: 3, checkedOut: 0 }, "успешный отменяемый запрос обязан делать release");
  // Без signal путь идёт через pool.query, и клиента брать не нужно вовсе.
  const plain = mk("ok");
  await plain.driver.query({ text: "select 1 as one" });
  assert.deepEqual(plain.stats(), { releases: 0, checkedOut: 0 }, "без signal не должно быть connect()/release()");
  // Отмена: release ровно один (с ошибкой — то есть клиент уходит из пула, а не
  // остаётся занятым). Какая именно ошибка дойдёт до вызывающего — гонка cancel() и
  // обрыва сокета, её мы не фиксируем.
  const hung = mk("hang");
  const ac = new AbortController();
  const p = hung.driver.query({ text: "select pg_sleep(9)", signal: ac.signal });
  await new Promise((r) => setTimeout(r, 10));
  ac.abort();
  await assert.rejects(() => p);
  assert.deepEqual(hung.stats(), { releases: 1, checkedOut: 0 }, "отменённое соединение не должно оставаться занятым");
});

test("openPgPool: serverless-дефолты и startupParameters для пулера", async () => {
  const { openPgPool } = await import("../sveltekit/node.ts");
  const url = "postgres://u@127.0.0.1:1/none";
  const plain = openPgPool({ connectionString: url, applicationName: "kit-app" });
  assert.equal(plain.pool.options.statement_timeout, 15000, "по умолчанию statement_timeout уходит в startup-пакет");
  assert.equal(plain.pool.options.application_name, "kit-app");
  assert.equal(plain.pool.options.connectionTimeoutMillis, 10000);
  assert.equal(plain.pool.options.idleTimeoutMillis, 30000);
  // keepalive по умолчанию: иначе труп-сокет от NAT превращает первый запрос после
  // простоя в 500 (замер на живом хосте — в комментарии опции).
  assert.equal(plain.pool.options.keepAlive, true);
  assert.equal(plain.pool.options.keepAliveInitialDelayMillis, 10000);
  const noka = openPgPool({ connectionString: url, keepAlive: false, keepAliveInitialDelayMillis: 1000 });
  assert.equal(noka.pool.options.keepAlive, false, "keepalive можно выключить явно — например, для локального сокета");
  assert.equal(noka.pool.options.keepAliveInitialDelayMillis, 1000);
  await noka.close();
  const pooled = openPgPool({ connectionString: url, applicationName: "kit-app", startupParameters: "skip" });
  assert.equal(pooled.pool.options.statement_timeout, undefined, "за pooler'ом GUC не отправляем: иначе отказ подключения или молча 0");
  assert.equal(pooled.pool.options.application_name, undefined);
  // значения, влияющие на пул, проверяются до подключения — и не дают «странного» зависания
  for (const bad of [{ max: 0 }, { statementTimeoutMs: -1 }, { maxInFlight: 1.5 }, { keepAliveInitialDelayMillis: -1 }])
    assert.throws(() => openPgPool({ connectionString: url, ...bad }), /Invalid pg pool option|pool option/, JSON.stringify(bad));
  assert.throws(() => openPgPool({ connectionString: "" }), /Missing DATABASE_URL/);
  await plain.close();
  await pooled.close();
});

test("estimate: reltuples без фильтра, EXPLAIN с фильтром, точный count как откат", async () => {
  const ctx = { principal: { roles: [] as string[] } };
  const reltuples = stubDriver((s) =>
    /pg_class/.test(s.text) ? [{ n: "1200" }] : [{ n: 0 }],
  );
  const a = await createDb({ driver: reltuples, limits: conservativeLimits })
    .resource(posts)
    .estimate(ctx, {});
  assert.deepEqual(a, { rows: 1200, exact: false, method: "reltuples" });
  assert.ok(/relkind IN \('r', 'p', 'm'\)/.test(String(reltuples.seen[0].text)), "вьюхи не считаются таблицами");

  const explained = stubDriver((s) =>
    /EXPLAIN/.test(s.text)
      ? [{ "QUERY PLAN": JSON.stringify([{ Plan: { "Plan Rows": 42 } }]) }]
      : [{ n: 0 }],
  );
  const b = await createDb({ driver: explained, limits: conservativeLimits })
    .resource(posts)
    .estimate(ctx, { filter: { field: "title", op: "contains", value: "abc" } });
  assert.deepEqual(b, { rows: 42, exact: false, method: "explain" });
  assert.ok(/EXPLAIN \(FORMAT JSON\)/.test(String(explained.seen[0].text)));
  assert.ok(/"title"/.test(String(explained.seen[0].text)), "в EXPLAIN уходит тот же предикат с политикой");

  const fallback = stubDriver((s) => (/pg_class/.test(s.text) ? [] : [{ n: 7 }]));
  const c = await createDb({ driver: fallback, limits: conservativeLimits })
    .resource(posts)
    .estimate(ctx, {});
  assert.deepEqual(c, { rows: 7, exact: true, method: "count" }, "нет статистики → честный count");
});

test("withRetry: повторяет только на откатанные транзакции, паузы экспоненциальные", async () => {
  const db = createDb({ driver: stubDriver(), limits: conservativeLimits });
  const failures: Array<{ retryable: boolean; kind: string }> = [
    { retryable: true, kind: "transaction" },
    { retryable: true, kind: "transaction" },
  ];
  let calls = 0;
  const waits: number[] = [];
  const result = await withRetry(
    db,
    async () => {
      const f = failures[calls];
      calls++;
      if (f) throw new DbFailure(f.kind as never, { retryable: f.retryable });
      return "ок";
    },
    { baseDelayMs: 10, maxDelayMs: 40, wait: async (ms) => void waits.push(ms) },
  );
  assert.equal(result, "ок");
  assert.equal(calls, 3, "две повторные попытки");
  assert.equal(waits.length, 2);
  assert.ok(waits[1] >= waits[0], "пауза не уменьшается");
  assert.ok(waits.every((w) => w <= 40), "потолок паузы соблюдён");

  calls = 0;
  await assert.rejects(
    () =>
      withRetry(
        db,
        async () => {
          calls++;
          throw new DbFailure("conflict", { retryable: false, sqlstate: "23505" });
        },
        { attempts: 4, wait: async () => {} },
      ),
    (e: DbFailure) => e.kind === "conflict",
  );
  assert.equal(calls, 1, "уникальный конфликт не ретраится: это не откатанная транзакция");

  //Attempts считаются: после исчерпания бросаем исходную ошибку
  calls = 0;
  await assert.rejects(
    () =>
      withRetry(
        db,
        async () => {
          calls++;
          throw new DbFailure("transaction", { retryable: true });
        },
        { attempts: 2, wait: async () => {} },
      ),
    (e: DbFailure) => e.kind === "transaction",
  );
  assert.equal(calls, 2, "attempts включает первую попытку");
});

test("icontains/istartsWith: ILIKE там, где LIKE был регистрозависимым", async () => {
  const driver = stubDriver();
  const db = createDb({ driver, limits: conservativeLimits });
  const ctx = { principal: { roles: [] as string[] } };
  const ci = defineResource({
    ...posts,
    key: "test.post.ci.v1",
    fields: {
      ...posts.fields,
      title: { ...posts.fields.title, filters: ["eq", "contains", "icontains", "istartsWith"] },
    },
  });
  await db.resource(ci).select(ctx, { filter: { field: "title", op: "icontains", value: "сталь" } });
  const t1 = String(driver.seen[driver.seen.length - 1].text);
  assert.ok(/ILIKE/.test(t1), t1.slice(0, 120));
  assert.equal(driver.seen[driver.seen.length - 1].values?.[0], "%сталь%");
  await db.resource(ci).select(ctx, { filter: { field: "title", op: "istartsWith", value: "сталь" } });
  assert.equal(driver.seen[driver.seen.length - 1].values?.[0], "сталь%");
  assert.ok(/ILIKE/.test(String(driver.seen[driver.seen.length - 1].text)));
  // экранирование % и _ сохраняется и в ILIKE
  await db.resource(ci).select(ctx, { filter: { field: "title", op: "icontains", value: "50%" } });
  assert.equal(driver.seen[driver.seen.length - 1].values?.[0], "%50\\%%");
  await assert.rejects(
    () => db.resource(posts).select(ctx, { filter: { field: "title", op: "icontains", value: "x" } as never }),
    (e: DbFailure) => e.kind === "forbidden",
    "оператор обязан быть объявлен в filters поля",
  );
});

test("withTestDb: PGlite в памяти, миграции, таблицы, isolated повторно", async () => {
  const { withTestDb } = await import("../testing/index.ts");
  const migration = `
    CREATE TABLE demo_post (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      title text NOT NULL,
      at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
  `;
  await withTestDb(
    async ({ db, sql, tables, encoding }) => {
      assert.deepEqual(await tables(), ["demo_post"]);
      assert.equal(encoding.encoding, "UTF8", "хелпер сообщает энкодинг");
      assert.equal(encoding.caseFolds, true, "не-ASCII складывается → icontains честный");
      const { defineResource: d, f, policy: pol } = await import("../index.ts");
      const def = d({
        key: "test.demo.v1",
        table: "demo_post",
        primaryKey: "id",
        fields: {
          id: f.uuid({ read: () => true, orderable: true, filters: ["eq"] }),
          title: f.text({ read: () => true, create: () => true, required: true, filters: ["eq", "icontains"] }),
          at: f.timestamp({ read: () => true, generated: true, orderable: true }),
        },
        policy: { select: () => true, insert: () => true, update: pol.deny(), delete: pol.deny() },
        order: [["at", "desc"]],
      });
      const api = db.resource(def);
      const made = await api.insertMany({ principal: { roles: [] } }, [
        { title: "раз" },
        { title: "два" },
      ]);
      assert.equal(made.length, 2, "пакетная вставка на реальном PG (в-process)");
      const listed = await api.select({ principal: { roles: [] } }, {});
      assert.deepEqual(listed.map((r) => r.title).sort(), ["два", "раз"]);
      assert.equal(await api.count({ principal: { roles: [] } }, {}), 2);
      const est = await api.estimate({ principal: { roles: [] } }, {});
      assert.ok(est.rows >= 0 && est.exact === false, "оценка есть и помечена неточной");
      assert.equal(
        (await api.select({ principal: { roles: [] } }, { filter: { field: "title", op: "icontains", value: "РАЗ" } })).length,
        1,
        "icontains работает на реальном PostgreSQL",
      );
      await sql("INSERT INTO demo_post (title) VALUES ('из sql')");
      assert.equal(await api.count({ principal: { roles: [] } }, {}), 3, "sql() — тот же коннект");
    },
    { migrations: [migration] },
  );
  // второй вызов = чистая база: структура создаётся миграциями, данных нет
  await withTestDb(
    async ({ tables, sql }) => {
      assert.deepEqual(await tables(), ["demo_post"], "свежий инстанс = только то, что создали миграции");
      const { rows } = await sql("SELECT count(*)::int AS n FROM demo_post");
      assert.equal(rows[0]!.n, 0, "строки прошлого теста не пережили вызов");
    },
    { migrations: [migration], encoding: "any" },
  );
});

test("данные-как-схема: компилятор не принимает враждебные идентификаторы и «сырые» узлы", async () => {
  // Схема коллекции приходит из БД — значит враждебная строка может содержать то, что
  // раньше писал только программист в роут-файле. Всё это должно разбиваться о компилятор.
  for (const table of ['public.x; DROP TABLE y', "a.b.c", 'a"b', "1a", "public.*", ""])
    assert.throws(
      () => defineResource({ ...posts, key: "shape." + table, table }),
      (e: DbFailure) => e.kind === "validation",
      table,
    );
  assert.throws(
    () => defineResource({ ...posts, fields: { ...posts.fields, 'bad"col': f.text({ read: () => true }) } }),
    (e: DbFailure) => e.kind === "validation",
    "имя поля идёт в ident() и обязано быть безопасным",
  );
  const driver = stubDriver();
  const db = createDb({ driver, limits: conservativeLimits });
  const ctx = { principal: { roles: [] as string[] } };
  const api = db.resource(posts);
  await assert.rejects(
    () => api.select(ctx, { filter: { raw: "1=1" } as never }),
    (e: DbFailure) => e.kind === "validation",
    "узла «сырой SQL» в грамматике нет",
  );
  await assert.rejects(
    () => api.select(ctx, { filter: { field: "secret", op: "eq", value: 1 } as never }),
    (e: DbFailure) => e.kind === "forbidden",
    "поля, которого нет в коллекции, достаточно, чтобы получить 403",
  );
  await assert.rejects(
    () => api.select(ctx, { filter: { field: "title", op: "lt", value: "a" } as never }),
    (e: DbFailure) => e.kind === "forbidden",
    "оператор обязан быть объявлен в filters поля",
  );
  await api.select(ctx, { filter: { field: "title", op: "contains", value: "x' OR 1=1" }, limit: 5 });
  const last = driver.seen[driver.seen.length - 1];
  assert.ok(!String(last.text).includes("OR 1=1"), "значение остаётся параметром: в тексте нет ни кавычки, ни «OR»");
  assert.deepEqual(last.values, ["%x' OR 1=1%", 5, 0], "значение, лимит и offset — параметры");
  assert.ok(/\$\d/.test(String(last.text)), "и лимит, и значение — плейсхолдеры");
  assert.ok(!/\*/.test(String(last.text)), "звёздочки в проекции нет: колонки перечислены");
});

test("defineResource отклоняет конфигурации, которые иначе молча не работают", () => {
  const base = {
    key: "shape.check.v1",
    table: "posts",
    primaryKey: "id",
    fields: {
      id: f.uuid({ read: () => true, orderable: true }),
      title: f.text({ read: () => true, create: () => true }),
      deleted_at: f.timestamp({ read: () => true, generated: true, filters: ["isNotNull"] }),
    },
    policy: { select: () => true, insert: () => true, update: () => true, delete: () => true },
    order: [["id", "asc"]],
  } as const;
  const reasons = (def: Record<string, unknown>): string => {
    try {
      defineResource(def as never);
      return "";
    } catch (e) {
      return ((e as DbFailure).details.issues as string[] | undefined)?.join("; ") ?? "";
    }
  };
  assert.equal(reasons({ ...base }), "", "корректная конфигурация проходит");
  // 1) softDelete без value/readDeleted: метку писали бы undefined, includeDeleted был бы вечный 403
  assert.match(reasons({ ...base, softDelete: { field: "deleted_at" } }), /softDelete\.value/);
  assert.match(reasons({ ...base, softDelete: { field: "deleted_at", value: () => 1 } }), /softDelete\.readDeleted/);
  // 2) поле, которое пишет только БД, нельзя «разрешить к записи»
  assert.match(
    reasons({ ...base, fields: { ...base.fields, deleted_at: { ...base.fields.deleted_at, generated: true, update: () => true } } }),
    /generated/,
  );
  // 3) опечатка в операторе фильтра = 403 на первом же запросе (ловим заранее)
  assert.match(reasons({ ...base, fields: { ...base.fields, title: { ...base.fields.title, filters: ["contain"] } } }), /неизвестный оператор/);
  // 4) связи: локального поля нет → LATERAL упал бы на каждом select
  assert.match(
    reasons({ ...base, relations: { author: { resource: { fields: { id: {} } } as never, localField: "author_id", foreignField: "id" } } }),
    /localField/,
  );
  // 5) validateFinal без Standard Schema (частая ошибка «true»)
  assert.match(reasons({ ...base, validateFinal: true }), /validateFinal/);
  // 6) сортировка по полю, которое не объявлено orderable
  assert.match(reasons({ ...base, order: [["title", "asc"]] }), /orderable/);
  // 7) PK без orderable: его дописывает orderBy → 403 на первом же select
  assert.match(
    reasons({ ...base, fields: { ...base.fields, id: { ...base.fields.id, orderable: false } } }),
    /primaryKey .*обязан быть orderable/,
  );
});

test("SQLSTATE отказа прав (42501/42502) идёт в forbidden, а не в database", () => {
  for (const code of ["42501", "42502"]) {
    const e = normalizeFailure({ code, severity: "ERROR", routine: "ExecGrant", message: "x" });
    assert.equal(e.kind, "forbidden", code);
    assert.equal(FAILURE_STATUS[e.kind], 403, code);
    assert.equal(e.details.sqlstate, code);
  }
  // остальные 42xxx — по-прежнему «база», а не «запрет»
  assert.equal(normalizeFailure({ code: "42P01", severity: "ERROR", routine: "r" }).kind, "database");
  assert.equal(normalizeFailure({ code: "23505", severity: "ERROR", routine: "r" }).kind, "conflict");
});

test("readJson: лимит тела срабатывает до парсинга, мусор = validation", async () => {
  const big = new Request("http://x/y", { method: "POST", body: "x".repeat(65537) });
  await assert.rejects(() => readJson(big, { maxBytes: 65536 }), (e) => e instanceof BodyTooLarge);
  await assert.rejects(
    () => readJson(new Request("http://x/y", { method: "POST", body: "{" })),
    (e) => e instanceof DbFailure && e.kind === "validation",
  );
  assert.deepEqual(await readJson(new Request("http://x/y", { method: "POST", body: '{"a":1}' })), { a: 1 });
});

/* ── 4. handle: ctx создаёт только сервер ───────────────────────────────── */
test("dbHandle вешает locals.db/locals.dbCtx, гость = пустые роли, signal из запроса", async () => {
  const db = createDb({ driver: stubDriver(), limits: conservativeLimits });
  const handle = dbHandle({ db, principal: (event) => (event.url.searchParams.get("who") === "a" ? { id: "u1", roles: ["author"] } : undefined) });
  async function run(path: string) {
    const request = new Request("http://x" + path);
    const event: any = { request, url: new URL(request.url), locals: {}, platform: undefined };
    let seen: any;
    await handle({ event, resolve: async () => { seen = event.locals; return new Response("ok"); } });
    return seen;
  }
  const asAuthor = await run("/posts?who=a");
  assert.equal(asAuthor.db, db);
  assert.deepEqual(asAuthor.dbCtx.principal, { id: "u1", roles: ["author"] });
  assert.ok(asAuthor.dbCtx.signal instanceof AbortSignal);
  assert.match(asAuthor.dbCtx.requestId, /.+/);
  const guest = await run("/posts");
  assert.deepEqual(guest.dbCtx.principal, { roles: [] });
  // Клиентский заголовок не может назначить роль: principal даёт только resolver.
  assert.equal((await run("/posts?roles=admin")).dbCtx.principal.roles.length, 0);
});
test("dbHandle: нематемные roles отказывают, paths=scope ограничивает резолв", async () => {
  const db = createDb({ driver: stubDriver(), limits: conservativeLimits });
  const handle = dbHandle({ db, principal: () => ({ roles: "author" as any }) });
  const request = new Request("http://x/posts");
  await assert.rejects(
    () => handle({ event: { request, url: new URL(request.url), locals: {} } as any, resolve: async () => new Response() }),
    (e) => e instanceof DbFailure && e.kind === "forbidden",
  );
  let resolved = 0;
  const scoped = dbHandle({ db, principal: () => { resolved++; return { roles: ["author"] }; }, paths: ["/api"] });
  const other = new Request("http://x/modals");
  await scoped({ event: { request: other, url: new URL(other.url), locals: {} } as any, resolve: async () => new Response() });
  assert.equal(resolved, 0, "для чужих путей principal резолвить не нужно");
});

/* ── 5. Разделитель SQL и миграции ──────────────────────────────────────── */
test("splitSqlStatements: ; внутри строк, комментариев и $$…$$ не режет оператор", async () => {
  assert.deepEqual(splitSqlStatements("SELECT 'a;b'; -- x; y\nSELECT 1"), ["SELECT 'a;b'", "SELECT 1"]);
  assert.deepEqual(splitSqlStatements("CREATE FUNCTION f() AS $$ BEGIN RETURN 1; END $$; SELECT 2"), [
    "CREATE FUNCTION f() AS $$ BEGIN RETURN 1; END $$",
    "SELECT 2",
  ]);
  assert.deepEqual(splitSqlStatements("SELECT 'it''s;ok' /* ; */ ; SELECT 3"), ["SELECT 'it''s;ok' ", "SELECT 3"].map((x) => x.trim()));
  const { readFile } = await import("node:fs/promises");
  const migration = await readFile(new URL("../migrations/001-db-probe.sql", import.meta.url), "utf8");
  assert.equal(splitSqlStatements(migration).length, 5, "001-db-probe.sql = 5 операторов");
});
test("applyMigrationText: требует транзакционный драйвер и идёт одним BEGIN/COMMIT", async () => {
  const driver = stubDriver();
  const db = createDb({ driver, limits: conservativeLimits });
  const r = await applyMigrationText(db, "CREATE TABLE t (id int); CREATE INDEX i ON t(id);");
  assert.equal(r.applied, 2);
  assert.deepEqual(driver.seen.map((x) => x.text), ["CREATE TABLE t (id int)", "CREATE INDEX i ON t(id)"]);
  assert.equal(driver.tx, 1, "оба оператора — внутри одной транзакции (BEGIN/COMMIT — дело адаптера)");
  await assert.rejects(
    () => applyMigrationText(createDb({ driver: { ...driver, capabilities: { ...driver.capabilities, transactions: false } }, limits: conservativeLimits }), "SELECT 1;"),
    (e) => e instanceof DbFailure && e.kind === "unsupported",
  );
});

/* ── 6. Zero-dep примитивы ≡ zod 4 ─────────────────────────────────────── */
test("примитивы совпадают с zod на корпусе значений", async () => {
  const corpus: Array<[unknown, "text" | "uuid" | "integer" | "boolean" | "date" | "timestamp" | "decimal" | "bigint"]> = [];
  const texts = ["", "a", "abc", "  x  ", "👍", "a".repeat(1000)];
  for (const v of texts) corpus.push([v, "text"]);
  for (const v of ["507f1f77-bc34-4a56-9b1e-3f0a1d2e4c5f", "507f1f77bcf86cd799439011", "nope", "", 1, null]) corpus.push([v, "uuid"]);
  for (const v of [0, 1, -1, 1.5, NaN, Infinity, 2 ** 53, "1", null, undefined]) corpus.push([v, "integer"]);
  for (const v of [true, false, "true", 0, null]) corpus.push([v, "boolean"]);
  for (const v of ["2024-02-29", "2023-02-29", "2024-13-01", "2024-1-1", "2024-01-32", "1999-12-31", "2024-00-10"]) corpus.push([v, "date"]);
  for (const v of [
    "2024-01-02T03:04:05Z", "2024-01-02T03:04:05.123456Z", "2024-01-02T03:04:05+02:00",
    "2024-01-02T03:04:05", "2024-01-02T03:04:60Z", "2024-01-02T24:00:00Z", "2024-02-30T00:00:00Z",
    "2024-01-02 03:04:05Z", "2024-01-02T03:04:05z", "2024-01-02T03:04:05.5+05:30", "x",
  ]) corpus.push([v, "timestamp"]);
  for (const v of ["0", "-1", "1.5", "1.", ".5", "1e5", "abc", 1]) corpus.push([v, "decimal"]);
  for (const v of ["0", "-1", "99999999999999999999", "1.5", "", " 1"]) corpus.push([v, "bigint"]);
  const zodOf: Record<string, z.ZodType> = {
    text: z.string(), uuid: z.uuid(), integer: z.number().int().safe(), boolean: z.boolean(),
    date: z.iso.date(), timestamp: z.iso.datetime({ offset: true }), decimal: z.string().regex(/^-?\d+(\.\d+)?$/),
    bigint: z.string().regex(/^-?\d+$/),
  };
  const mine: Record<string, any> = {
    text: s.text(), uuid: s.uuid(), integer: s.integer(), boolean: s.boolean(),
    date: s.date(), timestamp: s.timestamp(), decimal: s.decimal(), bigint: s.bigint(),
  };
  const mismatches: string[] = [];
  for (const [value, kind] of corpus) {
    const a = await zodOf[kind]["~standard"].validate(value);
    const b = await mine[kind]["~standard"].validate(value);
    if (!!a.issues !== !!b.issues) mismatches.push(`${kind}(${JSON.stringify(value)}): zod=${a.issues ? "reject" : "accept"}, s=${b.issues ? "reject" : "accept"}`);
  }
  assert.deepEqual(mismatches, [], "расхождение с zod:\n" + mismatches.join("\n"));
  // ограничения min/max работают там, где zod их делал цепочкой
  assert.ok((await s.text({ min: 3 })["~standard"].validate("ab")).issues);
  const accepted = await s.text({ min: 3 })["~standard"].validate("abc");
  assert.equal(accepted.issues, undefined);
});
test("field() принимает и zod-схему, и свою: один и тот же ресурс", async () => {
  const inserted: Row = { id: crypto.randomUUID(), title: "abcd", at: "2024-01-02T03:04:05.000000Z" };
  const driver = stubDriver((s) => (s.text.startsWith("INSERT") ? [inserted] : []));
  const db = createDb({ driver, limits: conservativeLimits });
  const withZod = defineResource({
    key: "test.zod.v1", table: "public.post", primaryKey: "id",
    fields: {
      id: f.uuid({ read: () => true, createValue: () => crypto.randomUUID(), immutable: true, orderable: true, filters: ["eq"] }),
      title: field(z.string().min(3).max(10), { read: () => true, create: () => true, required: true, orderable: true, filters: ["eq"] }),
      at: f.timestamp({ read: () => true, create: () => true, filters: ["eq"], orderable: true }),
    },
    policy: { select: policy.publicRows(), insert: () => true, update: () => false, delete: () => false },
    order: [["at", "desc"]],
  });
  await db.resource(withZod).insert({ principal: { roles: [] } }, { title: "abcd", at: "2024-01-02T03:04:05Z" });
  assert.match(driver.seen.at(-1)!.text, /INSERT INTO "public"."post"/);
  await assert.rejects(
    () => db.resource(withZod).insert({ principal: { roles: [] } }, { title: "ab", at: "2024-01-02T03:04:05Z" }),
    (e) => e instanceof DbFailure && e.kind === "validation",
  );
});
test("cursorCodecFromEnv: без секрета курсора нет, старым ключам из кольца — есть", async () => {
  assert.equal(cursorCodecFromEnv(() => undefined), undefined);
  assert.throws(() => cursorCodecFromEnv(() => "short"), /cursor key|Invalid/);
  const secret = "k".repeat(40);
  const codec = cursorCodecFromEnv((k) => (k === "DB_CURSOR_SECRET" ? secret : k === "DB_CURSOR_OLD_KEYS" ? "v0:" + "j".repeat(40) : undefined)),
    db = createDb({ driver: stubDriver(), limits: conservativeLimits, cursorCodec: codec });
  const token = await codec!.encode({ a: 1 }, ["x"]);
  assert.deepEqual(await codec!.decode(token, { a: 1 }), ["x"]);
  await assert.rejects(() => codec!.decode(token, { a: 2 }), (e) => e instanceof DbFailure && e.kind === "cursor");
  assert.equal((await db.resource(posts).cursor({ principal: { roles: [] } })).nextCursor, null);
});
/* ── pgproxy: транспорт подменён, сеть не нужна ─────────────────────────────── */
test("proxyHttpAdapter: без сессии → транзакций нет, токен одноразовый, ответ по id", async () => {
  const { proxyHttpAdapter } = await import("../adapters/proxy.ts");
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  let reply: Record<string, unknown> = { statusCode: 200, rows: [{ a: 1 }], rowCount: 1, command: "SELECT" };
  let replyHeaders = { "content-type": "application/json" };
  const fetchImpl = (async (input: unknown, init: { body?: string }) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push({ url: String(input), body });
    return new Response(JSON.stringify({ ...reply, id: body.id }), { headers: replyHeaders });
  }) as unknown as typeof globalThis.fetch;
  const driver = proxyHttpAdapter({ url: "https://proxy.test/rpc", secret: "s".repeat(40), fetch: fetchImpl });
  assert.deepEqual(driver.capabilities, {
    transactions: false, savepoints: false, sqlstate: false, isolationLevels: [],
  });
  // отказ ДО сети: иначе «транзакция» выглядела бы как попытка, а не как запрет
  await assert.rejects(() => driver.transaction(async () => 1), (e) => e instanceof DbFailure && e.kind === "unsupported");
  assert.equal(calls.length, 0, "HTTP-режим обязан отказать, не отправив ни одного запроса");
  // bigint/Date не должны ронять JSON и не должны конкатенацией в текст
  const r = await driver.query({ text: "select $1::bigint, $2::timestamptz", values: [10n, new Date("2026-01-02T03:04:05.000Z")] });
  assert.deepEqual(r.rows, [{ a: 1 }]);
  assert.deepEqual(calls[0].body.params, ["10", "2026-01-02T03:04:05.000Z"]);
  assert.equal(calls[0].body.query, "select $1::bigint, $2::timestamptz");
  // два запроса → два разных одноразовых токена, ровно 64 символа base64url
  await driver.query({ text: "select 2" });
  const tokens = calls.map((c) => new URL(c.url).searchParams.get("auth")!);
  assert.equal(new Set(tokens).size, 2, "прокси считает использованный токен переиспользованием (403)");
  for (const t of tokens) assert.match(t, /^[A-Za-z0-9_-]{64}$/);
  assert.equal(new URL(calls[0].url).pathname, "/rpc");
  // SQL-ошибка прокси (statusCode 400 + текст, кода нет) → database, а не конфликт
  reply = { statusCode: 400, error: 'duplicate key value violates unique constraint "demo_pkey"' };
  await assert.rejects(() => driver.query({ text: "insert into demo values (1)" }), (e) => {
    return e instanceof DbFailure && e.kind === "database" &&
      String(e.details?.issues?.[0]).includes("duplicate key");
  });
  // 401/403 — это «не попали в прокси»: отдельная категория + подсказка про часы
  reply = { statusCode: 403, error: "forbidden" };
  await assert.rejects(() => driver.query({ text: "select 1" }), (e) =>
    e instanceof DbFailure && e.kind === "unavailable" && String(e.details?.issues?.[0]).includes("часов"));
  // не-JSON (HTML-заглушка панели/файрвола) — тоже unavailable, а не пустой результат
  reply = { statusCode: 200, rows: [] };
  replyHeaders = { "content-type": "text/html" };
  await assert.rejects(() => driver.query({ text: "select 1" }), (e) =>
    e instanceof DbFailure && e.kind === "unavailable" && String(e.details?.issues?.[0]).includes("не JSON"));
  replyHeaders = { "content-type": "application/json" };
  // чужой id в ответе = рассинхрон канала, а не данные
  const strict = new Response(JSON.stringify({ id: "не-тот", statusCode: 200, rows: [{ x: 1 }] }), {
    headers: { "content-type": "application/json" },
  });
  const driver2 = proxyHttpAdapter({
    url: "https://proxy.test", secret: "s".repeat(40),
    fetch: (async () => strict) as unknown as typeof globalThis.fetch,
  });
  await assert.rejects(() => driver2.query({ text: "select 1" }), (e) =>
    e instanceof DbFailure && String(e.details?.issues?.[0]).includes("не совпал"));
  // fail-fast без очереди и общий close
  const slow = proxyHttpAdapter({
    url: "https://proxy.test", secret: "s".repeat(40), maxInFlight: 1,
    fetch: (() => new Promise<Response>(() => {})) as unknown as typeof globalThis.fetch,
  });
  const pending = slow.query({ text: "select 1" }).catch(() => null);
  await assert.rejects(() => slow.query({ text: "select 2" }), (e) => e instanceof DbFailure && e.kind === "unavailable");
  await slow.close!();
  await pending;
});

test("proxyWsAdapter: один сокет на транзакцию, savepoint-откат, отмена закрывает сокет", async () => {
  const { proxyWsAdapter, proxyAdapter } = await import("../adapters/proxy.ts");
  type Frame = { id?: string; query?: string };
  const opened: StubSocket[] = [];
  let failFor: (query: string) => boolean = () => false;
  class StubSocket {
    listeners: Record<string, Array<(arg?: unknown) => void>> = {};
    sent: Frame[] = [];
    closedCount = 0;
    constructor(public url: string) {
      opened.push(this);
      queueMicrotask(() => this.emit("open"));
    }
    addEventListener(type: string, cb: (arg?: unknown) => void) {
      (this.listeners[type] ??= []).push(cb);
    }
    emit(type: string, arg?: unknown) {
      for (const cb of this.listeners[type] ?? []) cb(arg);
    }
    send(raw: string) {
      const frame = JSON.parse(raw) as Frame & { params?: unknown };
      this.sent.push(frame);
      const query = String(frame.query);
      const bad = failFor(query);
      const response = bad
        ? { id: frame.id, statusCode: 400, error: " Boom " }
        : { id: frame.id, statusCode: 200, rows: [{ q: query }], rowCount: 1, command: query.split(" ")[0].toUpperCase() };
      queueMicrotask(() => this.emit("message", { data: JSON.stringify(response) }));
    }
    close() {
      this.closedCount++;
      this.emit("close");
    }
  }
  const driver = proxyWsAdapter({
    url: "https://proxy.test", secret: "s".repeat(40),
    WebSocket: StubSocket as unknown as typeof globalThis.WebSocket,
  });
  assert.equal(driver.capabilities.transactions, true, "WS-сессия = один backend: транзакции есть");
  assert.equal(driver.capabilities.sqlstate, false, "в error-фрейме прокси нет кода — врать про 409 нельзя");
  // хендшейк на wss:// (схема меняется сама), токен в query
  await driver.query({ text: "select 1" });
  assert.equal(opened.length, 1);
  assert.equal(new URL(opened[0]!.url).protocol, "wss:");
  assert.match(new URL(opened[0]!.url).searchParams.get("auth")!, /^[A-Za-z0-9_-]{64}$/);
  assert.deepEqual(opened[0]!.sent.map((f) => f.query), ["select 1"]);
  assert.equal(opened[0]!.closedCount, 1, "сокет обязан быть закрыт по окончании операции");
  // транзакция: BEGIN..COMMIT одним сокетом; ошибка в середине → ROLLBACK, а не «тихий» commit
  const tx = await driver.transaction(async (t) => {
    await t.query({ text: "insert into a values (1)" });
    await t.query({ text: "insert into a values (2)" });
    return "ok";
  });
  assert.equal(tx, "ok");
  const txSocket = opened[1]!;
  assert.deepEqual(txSocket.sent.map((f) => f.query), [
    "BEGIN", "insert into a values (1)", "insert into a values (2)", "COMMIT",
  ]);
  assert.equal(txSocket.closedCount, 1);
  failFor = (query) => query.startsWith("insert into a values (2)");
  await assert.rejects(() => driver.transaction(async (t) => {
    await t.query({ text: "insert into a values (1)" });
    await t.query({ text: "insert into a values (2)" });
    return "нет";
  }), (e) => e instanceof DbFailure && e.kind === "database");
  assert.deepEqual(opened[2]!.sent.map((f) => f.query), [
    "BEGIN", "insert into a values (1)", "insert into a values (2)", "ROLLBACK",
  ]);
  failFor = () => false;
  // savepoint (вложенный откат) идёт тем же сокетом
  await driver.transaction(async (t) => {
    await t.query({ text: "insert into a values (1)" }).catch(() => {});
    await t.transaction(async (inner) => {
      await inner.query({ text: "insert into a values (2)" });
      return 1;
    }).catch(() => {});
    return 0;
  });
  assert.ok(opened.at(-1)!.sent.some((f) => String(f.query).startsWith("SAVEPOINT")));
  // отмена сигнала закрывает сокет (иначе запрос пережил бы инвокацию)
  const ac = new AbortController();
  const cancelled = driver.query({ text: "select pg_sleep(9)", signal: ac.signal });
  ac.abort();
  await assert.rejects(() => cancelled, (e) => e instanceof DbFailure && e.kind === "unavailable");
  assert.ok(opened.at(-1)!.closedCount >= 1);
  // proxyAdapter выбирает режим, не открывая сокеты на валидации конфига
  const http = proxyAdapter("http", { url: "https://proxy.test", secret: "s".repeat(40), fetch: (async () => new Response("{}")) as never });
  assert.equal(http.capabilities.transactions, false);
});

test("proxy-адаптеры: кривой конфиг падает на старте приложения, а не на первом запросе", async () => {
  const { proxyHttpAdapter, proxyWsAdapter } = await import("../adapters/proxy.ts");
  const secret = "s".repeat(40);
  assert.throws(() => proxyHttpAdapter({ url: "https://x.test/r?a=1", secret }), /credentials, query or fragment/);
  assert.throws(() => proxyHttpAdapter({ url: "https://user:pass@x.test", secret }), /credentials, query or fragment/);
  assert.throws(() => proxyHttpAdapter({ url: "http://x.test/r", secret }), /HTTPS proxy URL required/);
  assert.throws(() => proxyHttpAdapter({ url: "http://localhost:5434", secret }), /HTTPS proxy URL required/);
  assert.doesNotThrow(() => proxyHttpAdapter({ url: "http://localhost:5434", secret, allowInsecureLocalhost: true }));
  assert.throws(() => proxyHttpAdapter({ url: "https://x.test", secret: "short" }), /secret too short/);
  for (const bad of [{ maxInFlight: 0 }, { maxInFlight: 1.5 }, { timeoutMs: 0 }, { timeoutMs: -1 }])
    assert.throws(() => proxyWsAdapter({ url: "wss://x.test", secret, ...bad }), /Invalid proxy limits/, JSON.stringify(bad));
  // WS-схему принимаем как есть, и она не должна переписываться на wss дважды
  assert.doesNotThrow(() => proxyWsAdapter({ url: "wss://x.test/r", secret }));
});

test("pgproxy носит значения текстом → адаптер разбирает по OID и сериализует params", async () => {
  const { proxyHttpAdapter } = await import("../adapters/proxy.ts");
  let sentBody: Record<string, unknown> | undefined;
  const reply = (rows: unknown[][], fields: Array<[string, number]>) =>
    (async (_url: unknown, init: { body?: string }) =>
      new Response(
        JSON.stringify({
          statusCode: 200,
          id: (JSON.parse(String(init.body)) as { id: string }).id,
          rows,
          rowCount: rows.length,
          command: "SELECT",
          fields,
        }),
        { headers: { "content-type": "application/json" } },
      )) as unknown as typeof globalThis.fetch;
  const driver = proxyHttpAdapter({
    url: "https://proxy.test", secret: "s".repeat(40),
    fetch: reply([
      ["42", "t", "9007199254740993", "12.50", '{a,"b c",NULL}', '{"k":1}', "2026-01-02 03:04:05+00", null],
    ], [
      ["n", 23], ["ok", 16], ["big", 20], ["price", 1700], ["tags", 1009],
      ["meta", 3802], ["when", 1184], ["nil", 23],
    ]),
  });
  const { rows } = await driver.query({ text: "select" });
  assert.deepEqual(rows[0], {
    n: 42,
    ok: true,
    big: "9007199254740993", // int8 остаётся строкой — ровно как в pgAdapter
    price: "12.50", // numeric тоже строка: привести должен вызывающий код, а не транспорт
    tags: ["a", "b c", null],
    meta: { k: 1 },
    when: "2026-01-02T03:04:05.000Z",
    nil: null,
  });
  const echo = proxyHttpAdapter({
    url: "https://proxy.test", secret: "s".repeat(40),
    fetch: (async (_u: unknown, init: { body?: string }) => {
      sentBody = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ statusCode: 200, id: (sentBody as { id: string }).id, rows: [], rowCount: 0, command: "SELECT" }), {
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof globalThis.fetch,
  });
  await echo.query({
    text: "insert into a values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    values: [true, false, null, undefined, 5n, 3.5, new Date("2026-01-02T03:04:05.000Z"), ['a', 'b"c'], new Uint8Array([0, 255])],
  });
  // Массив — pg-литерал с backslash-экраном (так делает postgres-array), а не «""»;
  // ниже — проверка, что тот же литерал читается обратно этим же адаптером.
  assert.deepEqual((sentBody as { params: unknown[] }).params, [
    "t", "f", null, null, "5", "3.5", "2026-01-02T03:04:05.000Z", '{a,"b\\"c"}', "\\x00ff",
  ]);
  const literal = (sentBody as { params: string[] }).params[7];
  const roundTrip = await proxyHttpAdapter({
    url: "https://proxy.test", secret: "s".repeat(40),
    fetch: (async (_u: unknown, init: { body?: string }) => new Response(
      JSON.stringify({
        statusCode: 200,
        id: (JSON.parse(String(init.body)) as { id: string }).id,
        rows: [[literal]], rowCount: 1, command: "SELECT", fields: [["tags", 1009]],
      }),
      { headers: { "content-type": "application/json" } },
    )) as unknown as typeof globalThis.fetch,
  }).query({ text: "select tags from a" });
  assert.deepEqual(roundTrip.rows[0].tags, ["a", 'b"c']);
});

test(
  "замок каталога: живой владелец — отказ, мёртвый — снятие с предупреждением",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "kit-db-lock-"));
    const lockPath = join(dir, ".kit-db.lock");
    const alive = { pid: process.pid, startedAt: new Date(Date.now() - 60_000).toISOString() };
    const open = () => openNodeDatabase(dir, dir, { memory: false });

    // Владелец жив (это мы сами) — каталог занят, и никакая «самопомощь» тут
    // неуместна: два писателя PGlite не переживает.
    await writeFile(lockPath, JSON.stringify(alive) + "\n");
    await assert.rejects(open, /locked/);
    // Содержимое непонятное → «владелец неизвестен» трактуется как «жив»:
    // отказ безопаснее, чем размойти каталог по испорченному файлу.
    await writeFile(lockPath, "не json");
    await assert.rejects(open, /locked/);

    // pid, которого нет в системе = владелец умер, не успев убрать замок
    // (SIGKILL превью, рестарт контейнера). Молча вечно отказывать — вечный 500
    // для любого, кто перезапускает демо, поэтому замок снимается вслух.
    const child = spawn(process.execPath, ["-e", ""]);
    await new Promise((res) => child.once("exit", res));
    const deadPid = child.pid;
    assert.ok(deadPid && deadPid !== process.pid);
    await writeFile(lockPath, JSON.stringify({ pid: deadPid, startedAt: new Date(Date.now() - 60_000).toISOString() }) + "\n");
    const written: string[] = [];
    const realWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    let node: Awaited<ReturnType<typeof openNodeDatabase>> | undefined;
    try {
      node = await open();
    } finally {
      process.stderr.write = realWrite;
    }
    assert.ok(node, "каталог не открылся после снятия замка");
    assert.match(written.join(""), /\.kit-db\.lock снят/);
    // Новый замок принадлежит нам, а close() возвращает каталог в свободное состояние.
    assert.equal(JSON.parse(await readFile(lockPath, "utf8")).pid, process.pid);
    await node.close();
    await assert.rejects(() => readFile(lockPath, "utf8"), /ENOENT/);
  },
);
