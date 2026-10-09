/** Регрессии оставшихся audit findings. PGlite RAM или явно заданный LOCAL PostgreSQL. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import { afterAll, it } from 'vitest';
const F = await import("./fixtures/index.ts");
const url = process.env.DB_HARDENING_PG_URL;
if (url) {
  const parsed = new URL(url);
  assert.ok(["127.0.0.1", "localhost", ""].includes(parsed.hostname));
  assert.equal(parsed.searchParams.get("host"), "/tmp");
}
const engine = url
  ? new Pool({ connectionString: url, max: 4, connectionTimeoutMillis: 2000 })
  : new PGlite();
const sql = (text, values) => engine.query(text, values);
const exec = (text) => (url ? engine.query(text) : engine.exec(text));
if (url)
  assert.equal(
    (
      await sql(
        "SELECT 1 FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') LIMIT 1",
      )
    ).rows.length,
    0,
    "Use a new empty LOCAL test database",
  );
const migration = await readFile(new URL("../../migrations/001-db-probe.sql", import.meta.url), "utf8");
await exec(migration);
const driver = url ? F.pgAdapter(engine) : F.pgliteAdapter(engine),
  db = F.createDb({ driver, limits: F.conservativeLimits });
const ctx = { principal: { id: crypto.randomUUID(), roles: ["author"] } },
  api = F.createProbeApi(db);
const test = (name: string, fn: () => Promise<void> | void) => it(name, fn, 30_000)
await api.author.insert(ctx, { name: "followup" });
  await test("A03 JSON roots retain types on insert/update/filter; SQL arrays unchanged", async () => {
    const jsonResource = db.resource(
      F.defineResource({
        ...F.blogs,
        fields: {
          ...F.blogs.fields,
          meta: {
            ...F.blogs.fields.meta,
            filters: ["eq", "in"],
            orderable: true,
          },
        },
      }),
    );
    for (const value of [
      "plain",
      "123",
      "true",
      "null",
      '{"x":1}',
      [1, 2],
      true,
      42,
      { nested: [null, "x"] },
    ]) {
      const row = await jsonResource.insert(ctx, {
        title: "JSON roots",
        meta: value,
        tags: ["x", "y"],
      });
      assert.deepEqual(row.meta, value);
      assert.deepEqual(row.tags, ["x", "y"]);
      assert.deepEqual(
        (await jsonResource.update(ctx, row.id, { meta: value })).meta,
        value,
      );
      assert.ok(
        (
          await jsonResource.select(ctx, {
            filter: { field: "meta", op: "eq", value },
          })
        ).some((x) => x.id === row.id),
      );
      assert.ok(
        (
          await jsonResource.select(ctx, {
            filter: { field: "meta", op: "in", value: [value] },
          })
        ).some((x) => x.id === row.id),
      );
    }
  });
  await test("A05 matching migration eliminates Sort; explicit upgrade is repeatable", async () => {
    await sql("SET enable_seqscan=off");
    const query =
      "EXPLAIN (COSTS OFF) SELECT id,created_at FROM db_probe.blog WHERE deleted_at IS NULL ORDER BY created_at DESC NULLS LAST,id ASC NULLS LAST LIMIT 20";
    assert.ok(
      !(await sql(query)).rows.some((r) => /Sort/.test(r["QUERY PLAN"])),
    );
    await exec(
      await readFile(new URL("../../migrations/002-db-probe-page-index.sql", import.meta.url), "utf8"),
    );
    await exec(
      await readFile(new URL("../../migrations/002-db-probe-page-index.sql", import.meta.url), "utf8"),
    );
    assert.ok(
      !(await sql(query)).rows.some((r) => /Sort/.test(r["QUERY PLAN"])),
    );
    await sql("RESET enable_seqscan");
  });
  await test("A06 OS codes are not SQLSTATE; custom structured server errors remain supported", async () => {
    assert.equal(
      F.normalizeFailure(Object.assign(Error("pipe"), { code: "EPIPE" }))
        .details.sqlstate,
      undefined,
    );
    assert.equal(
      F.normalizeFailure({
        code: "Z9999",
        severity: "ERROR",
        routine: "exec_stmt_raise",
      }).details.sqlstate,
      "Z9999",
    );
  });
  await test("A07 final validator sees DB defaults/generated row; invalid row rolls back", async () => {
    const r = db.resource(
      F.defineResource({
        ...F.blogs,
        validateFinal: F.z.object({
          active: F.z.literal(true),
          id: F.z.uuid(),
          created_at: F.z.string(),
        }),
      }),
    );
    const row = await r.insert(ctx, { title: "Defaults validated" });
    assert.equal(row.active, true);
    const before = await api.blog.count(ctx);
    await assert.rejects(
      () => r.insert(ctx, { title: "Must rollback", active: false }),
      (e) => e.kind === "validation",
    );
    assert.equal(await api.blog.count(ctx), before);
    await assert.rejects(
      () => r.update(ctx, row.id, { active: false }),
      (e) => e.kind === "validation",
    );
    assert.equal((await r.get(ctx, row.id)).active, true);
  });
  await test("A10 PK normalizer runs once", async () => {
    await exec(
      "CREATE TABLE audit_key (id text PRIMARY KEY,title text NOT NULL); INSERT INTO audit_key VALUES ('prefix-key','value')",
    );
    let calls = 0;
    const r = F.defineResource({
      key: "audit-key",
      table: "audit_key",
      primaryKey: "id",
      fields: {
        id: F.f.text({
          read: () => true,
          filters: ["eq"],
          orderable: true,
          normalize: (x) => {
            calls++;
            return "prefix-" + x;
          },
        }),
        title: F.f.text({ read: () => true }),
      },
      policy: {
        select: () => true,
        insert: () => false,
        update: () => false,
        delete: () => false,
      },
      order: [["id", "asc"]],
    });
    assert.equal((await db.resource(r).get(ctx, "key")).title, "value");
    assert.equal(calls, 1);
  });
  await test("A12 no-store; A13 one policy evaluation", async () => {
    assert.equal(
      (await F.createProbeRest(api, () => ctx).request("/blog")).headers.get(
        "cache-control",
      ),
      "no-store",
    );
    let calls = 0;
    const r = F.defineResource({
      ...F.blogs,
      policy: {
        ...F.blogs.policy,
        select: () => {
          calls++;
          return true;
        },
      },
    });
    await db.resource(r).select(ctx);
    assert.equal(calls, 1);
  });
  await test("A09 pending observer cannot hold original error indefinitely", async () => {
    for (const value of [0, -1, NaN, 2 ** 31])
      assert.throws(() =>
        F.createDb({
          driver,
          limits: F.conservativeLimits,
          observerTimeoutMs: value,
        }),
      );
    let release;
    const pending = new Promise((r) => {
      release = r;
    });
    const original = Error("SQL failure");
    const guarded = F.createDb({
      driver: {
        ...driver,
        query: async () => {
          throw original;
        },
      },
      limits: F.conservativeLimits,
      observerTimeoutMs: 10,
      onError: () => pending,
    });
    try {
      await assert.rejects(
        () => guarded.query({ text: "unused" }),
        (e) => e.cause === original,
      );
    } finally {
      release();
    }
  });
  await test("A17 native adapter bounds admissions and expires idle transaction callbacks", async () => {
    let released;
    const c = {
      query: async (text) => ({
        rows: [],
        rowCount: 0,
        command: text.split(" ")[0],
      }),
      release: (v) => {
        released = v;
      },
    };
    for (const value of [0, -1, NaN, 2 ** 31])
      assert.throws(() => F.pgAdapter({ connect: async () => c }, 1, value));
    const d = F.pgAdapter({ connect: async () => c }, 1, 15);
    const first = assert.rejects(
      () => d.transaction(async () => new Promise(() => {})),
      (e) => e.kind === "transaction",
    );
    await assert.rejects(
      () => d.transaction(async () => {}),
      (e) => e.kind === "unavailable",
    );
    await first;
    assert.equal(released, true);
  });
  if (url)
    await test("A11 real PostgreSQL failed control statement rolls back; actual COMMIT tag is checked", async () => {
      const pool = engine;
      let notices = 0;
      const wrapped = {
        query: pool.query.bind(pool),
        async connect() {
          const c = await pool.connect();
          return {
            release: c.release.bind(c),
            query: (text, values) =>
              c.query(
                text.startsWith("SAVEPOINT ") ? "SELECT 1/0" : text,
                values,
              ),
          };
        },
      };
      const guarded = F.createDb({
        driver: F.pgAdapter(wrapped),
        limits: F.conservativeLimits,
      });
      const before = await api.blog.count(ctx);
      await assert.rejects(() =>
        guarded.transaction(async (tx) => {
          await tx.resource(F.blogs).insert(ctx, { title: "Should rollback" });
          await tx.afterCommit(() => {
            notices++;
          });
          try {
            await tx.transaction(async () => {});
          } catch {}
        }),
      );
      assert.equal(notices, 0);
      assert.equal(await api.blog.count(ctx), before);
      // Настоящее закрытие backend connection, пока callback простаивает.
      await assert.rejects(() =>
        db.transaction(async (tx) => {
          const pid = (
            await tx.query({ text: "SELECT pg_backend_pid() AS pid" })
          ).rows[0].pid;
          await tx
            .resource(F.blogs)
            .insert(ctx, { title: "Terminated backend" });
          await tx.afterCommit(() => {
            notices++;
          });
          await engine.query("SELECT pg_terminate_backend($1)", [pid]);
          await new Promise(() => {});
        }),
      );
      assert.equal(notices, 0);
      assert.equal(await api.blog.count(ctx), before);
      // Настоящий backend отвечает ROLLBACK на COMMIT в aborted transaction.
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        try {
          await c.query("SELECT 1/0");
        } catch {}
        assert.equal((await c.query("COMMIT")).command, "ROLLBACK");
      } finally {
        c.release();
      }
    });
afterAll(async () => {
  if (url) await engine.end();
  else await engine.close();
})
