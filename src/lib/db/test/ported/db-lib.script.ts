import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import { afterAll, it } from 'vitest';
const F = await import("./fixtures/index.ts");
const native = process.env.DB_LIB_TEST_PG_URL;
const pg = native
  ? new Pool({ connectionString: native, max: 4 })
  : new PGlite();
if (native) {
  const existing = await pg.query(
    "SELECT to_regnamespace('db_probe') AS found",
  );
  assert.equal(
    existing.rows[0].found,
    null,
    "Native test requires fresh database/schema",
  );
}
await (native
  ? pg.query(await readFile(new URL("../../migrations/001-db-probe.sql", import.meta.url), "utf8"))
  : pg.exec(await readFile(new URL("../../migrations/001-db-probe.sql", import.meta.url), "utf8")));
let errors = 0,
  queries = 0;
const driver = native ? F.pgAdapter(pg) : F.pgliteAdapter(pg),
  query = driver.query.bind(driver);
driver.query = (...args) => {
  queries++;
  return query(...args);
};
const codec = F.createCursorCodec({
  keys: { test: "test-only-key-012345678901234567890123456789" },
  activeKey: "test",
  ttlSeconds: 60,
});
const db = F.createDb({
    driver,
    limits: F.conservativeLimits,
    cursorCodec: codec,
    onError: () => {
      errors++;
    },
  }),
  api = F.createProbeApi(db);
const a = {
    principal: {
      id: "10000000-0000-4000-8000-000000000001",
      roles: ["author"],
    },
  },
  b = {
    principal: {
      id: "20000000-0000-4000-8000-000000000002",
      roles: ["author"],
    },
  },
  editor = { principal: { id: a.principal.id, roles: ["editor"] } },
  guest = { principal: { roles: [] } };
const test = (name: string, fn: () => Promise<void> | void) => it(name, fn, 30_000)
let row: any;
const rejects = (fn, kind) =>
  assert.rejects(fn, (e) => e instanceof F.DbFailure && e.kind === kind);
await test("author setup and canonical decimal/bigint/date/array/json", async () => {
    await api.author.insert(a, { name: " Alice " });
    await api.author.insert(b, { name: "Bob" });
    const row = await api.blog.insert(a, {
      title: " precision ",
      score: "123456789012345678901.12345678",
      sequence: "9007199254740993",
      tags: ["x", "y"],
      meta: { nested: [1, true, null] },
      published_at: "2026-09-25T12:34:56.123456Z",
    });
    assert.equal(row.title, "precision");
    assert.equal(row.score, "123456789012345678901.12345678");
    assert.equal(row.sequence, "9007199254740993");
    assert.equal(row.published_at, "2026-09-25T12:34:56.123456Z");
    assert.deepEqual(row.tags, ["x", "y"]);
    assert.deepEqual(row.meta, { nested: [1, true, null] });
    // `row` нужен следующим группам: берём его здесь, а не на уровне модуля — иначе
    // выборка случилась бы до вставок (vitest регистрирует тесты, а не выполняет их)
    row = (await api.blog.select(a))[0];
  });
  await test("field projection omitted; mandatory id/owner; writes/filter/order forbidden", async () => {
    const got = await api.blog.get(a, row.id, {
      fields: ["title", "private_note", "unknown"],
    });
    assert.deepEqual(Object.keys(got).sort(), ["id", "owner_id", "title"]);
    for (const input of [
      { owner_id: b.principal.id },
      { id: crypto.randomUUID() },
      { created_at: new Date().toISOString() },
      { private_note: "x" },
      { unknown: "x" },
    ])
      await rejects(() => api.blog.update(a, row.id, input), "forbidden");
    await rejects(
      () =>
        api.blog.select(a, {
          filter: { field: "private_note", op: "eq", value: "x" },
        }),
      "forbidden",
    );
    await rejects(
      () => api.blog.select(a, { order: [["private_note", "asc"]] }),
      "forbidden",
    );
  });
  await test("row ACL, missing == denied, policy AND filter, no admin magic", async () => {
    await rejects(
      () => api.blog.update(b, row.id, { title: "stolen" }),
      "not_found",
    );
    await rejects(() => api.blog.delete(b, row.id), "not_found");
    await rejects(
      () =>
        api.blog.update(
          { principal: { ...b.principal, roles: ["admin"] } },
          row.id,
          { title: "stolen" },
        ),
      "forbidden",
    );
    const privateApi = db.resource(
      F.defineResource({
        ...F.blogs,
        policy: {
          ...F.blogs.policy,
          select: F.policy.ownerOrRoles("owner_id", []),
        },
      }),
    );
    assert.equal(
      (
        await privateApi.select(b, {
          filter: {
            or: [true, { field: "owner_id", op: "eq", value: a.principal.id }],
          },
        })
      ).length,
      0,
    );
    await rejects(() => privateApi.get(b, row.id), "not_found");
    await rejects(() => privateApi.get(b, crypto.randomUUID()), "not_found");
  });
  await test("input null/undefined/NaN, operators/injection/limits", async () => {
    for (const patch of [
      { title: null },
      { title: undefined },
      { score: 1.2 },
      { sequence: 9007199254740993 },
      { active: NaN },
      {},
    ])
      await rejects(() => api.blog.update(a, row.id, patch), "validation");
    await rejects(
      () =>
        api.blog.update(a, row.id, JSON.parse('{"__proto__":{"polluted":1}}')),
      "validation",
    );
    await rejects(
      () =>
        api.blog.select(a, {
          order: [["title;DROP TABLE db_probe.blog", "asc"]],
        }),
      "forbidden",
    );
    const injection = "x' OR TRUE --";
    assert.equal(
      (
        await api.blog.select(a, {
          filter: { field: "title", op: "eq", value: injection },
        })
      ).length,
      0,
    );
    await rejects(
      () =>
        api.blog.select(a, {
          filter: { field: "id", op: "in", value: Array(101).fill(row.id) },
        }),
      "validation",
    );
    await rejects(() => api.blog.select(a, { limit: 101 }), "validation");
    await rejects(() => api.blog.select(a, { page: 0 }), "validation");
    let nested = true;
    for (let i = 0; i < 10; i++) nested = { not: nested };
    await rejects(() => api.blog.select(a, { filter: nested }), "validation");
  });
  await test("singular include uses one SQL and target field/row ACL", async () => {
    queries = 0;
    const result = await api.blog.select(a, { include: ["author"] });
    assert.equal(queries, 1);
    assert.equal(result[0].author.name, "Alice");
    assert.ok(!("private_note" in result[0].author));
    const hiddenAuthors = F.defineResource({
      ...F.authors,
      policy: { ...F.authors.policy, select: () => false },
    });
    const hidden = db.resource(
      F.defineResource({
        ...F.blogs,
        relations: {
          author: {
            resource: hiddenAuthors,
            localField: "owner_id",
            foreignField: "id",
          },
        },
      }),
    );
    assert.equal(
      (await hidden.select(a, { include: ["author"] }))[0].author,
      null,
    );
  });
  await test("cursor ties, NULLS LAST, timestamp precision, tamper and scope binding", async () => {
    for (let i = 0; i < 5; i++)
      await api.blog.insert(a, {
        title: "same title",
        published_at: i < 3 ? "2026-09-25T12:34:56.123457Z" : null,
      });
    for (const order of [
      [["title", "asc"]],
      [["published_at", "asc"]],
      [["published_at", "desc"]],
      [["created_at", "desc"]],
    ]) {
      const ids = [];
      let after;
      do {
        const p = await api.blog.cursor(a, { limit: 2, order, after });
        ids.push(...p.items.map((x) => x.id));
        after = p.nextCursor;
      } while (after);
      assert.equal(ids.length, 6);
      assert.equal(new Set(ids).size, 6);
    }
    const p = await api.blog.cursor(a, { limit: 2 });
    await rejects(() => api.blog.cursor(b, { after: p.nextCursor }), "cursor");
    await rejects(
      () => api.blog.cursor(a, { after: p.nextCursor.slice(0, -3) + "ABC" }),
      "cursor",
    );
    await rejects(
      () => api.blog.cursor(a, { after: p.nextCursor, fields: ["title"] }),
      "cursor",
    );
    await rejects(
      () => api.blog.select(a, { after: p.nextCursor }),
      "validation",
    );
    let now = 100000;
    const clock = F.createCursorCodec({
      keys: { k: "12345678901234567890123456789012" },
      activeKey: "k",
      ttlSeconds: 1,
      now: () => now,
    });
    const t = await clock.encode("s", [1]);
    now += 1000;
    await rejects(() => clock.decode(t, "s"), "cursor");
  });
  await test("soft-delete, explicit deleted permission, stable count", async () => {
    const n = await api.blog.count(a);
    await api.blog.delete(a, row.id);
    assert.equal(await api.blog.count(a), n - 1);
    await rejects(() => api.blog.get(a, row.id), "not_found");
    await rejects(
      () => api.blog.select(a, { includeDeleted: true }),
      "forbidden",
    );
    assert.equal(
      (await api.blog.get(editor, row.id, { includeDeleted: true })).id,
      row.id,
    );
  });
  await test("rollback/savepoint and escaped transaction handle", async () => {
    const before = await api.blog.count(a);
    let escaped;
    await assert.rejects(() =>
      db.transaction(async (tx) => {
        escaped = tx;
        await tx.resource(F.blogs).insert(a, { title: "rolled back" });
        throw Error("rollback");
      }),
    );
    assert.equal(await api.blog.count(a), before);
    await rejects(() => escaped.query({ text: "SELECT 1" }), "transaction");
    await db.transaction(async (tx) => {
      await tx.resource(F.blogs).insert(a, { title: "outer committed" });
      await assert.rejects(() =>
        tx.transaction(async (inner) => {
          await inner.resource(F.blogs).insert(a, { title: "inner rollback" });
          throw Error("rollback");
        }),
      );
      await tx.resource(F.blogs).insert(a, { title: "outer continued" });
    });
    assert.equal(await api.blog.count(a), before + 2);
  });
  await test("caught SQL error cannot silently commit; unawaited query drained", async () => {
    await assert.rejects(() =>
      db.transaction(async (tx) => {
        try {
          await tx.query({ text: "SELECT 1/0" });
        } catch {}
      }),
    );
    await db.transaction(async (tx) => {
      void tx.query({ text: "SELECT pg_sleep(0.01)" });
    });
  });
  await test("atomic hooks/final validation and after-commit semantics", async () => {
    let notices = 0;
    const hookResource = F.defineResource({
      ...F.blogs,
      hooks: {
        beforeWrite: ({ draft }) => {
          draft.title = "hook normalized";
        },
        afterWrite: async ({ db }) => {
          await db.query({ text: "SELECT 1" });
        },
        afterCommit: () => {
          notices++;
        },
      },
    });
    const hooked = db.resource(hookResource);
    const created = await hooked.insert(a, { title: "input" });
    assert.equal(created.title, "hook normalized");
    assert.equal(notices, 1);
    await assert.rejects(() =>
      db.transaction(async (tx) => {
        await tx
          .resource(hookResource)
          .insert(a, { title: "rollback notices" });
        throw Error("rollback");
      }),
    );
    assert.equal(notices, 1);
    const broken = db.resource(
      F.defineResource({
        ...F.blogs,
        hooks: {
          afterWrite: () => {
            throw Error("hook");
          },
        },
      }),
    );
    const n = await api.blog.count(a);
    await rejects(
      () => broken.insert(a, { title: "must rollback" }),
      "database",
    );
    assert.equal(await api.blog.count(a), n);
    const tamper = db.resource(
      F.defineResource({
        ...F.blogs,
        hooks: {
          beforeWrite: ({ draft }) => {
            draft.owner_id = b.principal.id;
          },
        },
      }),
    );
    await rejects(() => tamper.insert(a, { title: "tamper" }), "forbidden");
    const cross = db.resource(
      F.defineResource({
        ...F.blogs,
        validateFinal: F.z
          .object({ title: F.z.string(), body: F.z.string().optional() })
          .refine((x) => x.title !== x.body),
      }),
    );
    await rejects(
      () => cross.update(a, created.id, { body: "hook normalized" }),
      "validation",
    );
    const committed = db.resource(
      F.defineResource({
        ...F.blogs,
        hooks: {
          afterCommit: () => {
            throw Error("notify");
          },
        },
      }),
    );
    await assert.rejects(
      () => committed.insert(a, { title: "committed notification failure" }),
      (e) => e.kind === "post_commit" && e.details.committed === true,
    );
    assert.equal(await api.blog.count(a), n + 1);
  });
  await test("HTTP rejects transaction/hook resource before first SQL", async () => {
    let calls = 0;
    const http = {
      capabilities: {
        transactions: false,
        savepoints: false,
        sqlstate: false,
        isolationLevels: [],
      },
      query: async () => {
        calls++;
        throw Error("must not run");
      },
      transaction: async () => {
        throw Error("must not run");
      },
    };
    const h = F.createDb({ driver: http, limits: F.conservativeLimits });
    await rejects(() => h.transaction(async () => {}), "unsupported");
    await rejects(
      () =>
        h
          .resource(
            F.defineResource({ ...F.blogs, hooks: { beforeWrite: () => {} } }),
          )
          .insert(a, { title: "x" }),
      "unsupported",
    );
    assert.equal(calls, 0);
  });
  await test("SQLSTATE normalization/presenter has no SQL/cause/private details", async () => {
    const before = errors;
    await assert.rejects(
      () => api.author.insert(a, { name: "duplicate" }),
      (e) => e.kind === "conflict" && e.details.sqlstate === "23505",
    );
    assert.equal(errors, before + 1);
    const failure = F.normalizeFailure({
      message: "23505 duplicate SECRET",
      query: "SECRET",
    });
    assert.equal(failure.details.sqlstate, undefined);
    assert.ok(
      !JSON.stringify(F.presentFailure(failure, true)).includes("SECRET"),
    );
  });
  await test("REST uses same API, strict DTO, field omission and body cap", async () => {
    const app = F.createProbeRest(api, () => a);
    let response = await app.request("/blog?fields=title,private_note");
    assert.equal(response.status, 200);
    assert.ok(!("private_note" in (await response.json()).items[0]));
    response = await app.request("/blog?sort=title");
    assert.equal(response.status, 422);
    response = await app.request("/blog/cursor?page=2");
    assert.equal(response.status, 422);
    response = await app.request("/blog?limit=1&limit=2");
    assert.equal(response.status, 422);
    response = await app.request("/blog", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    assert.equal(response.status, 422);
    response = await app.request("/blog", {
      method: "POST",
      body: "x".repeat(65537),
    });
    assert.equal(response.status, 413);
    response = await app.request("/blog/" + crypto.randomUUID(), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: '{"title":"not found"}',
    });
    assert.equal(response.status, 404);
  });
  await test("real constraints, named public mapping and falsy hook errors", async () => {
    for (const [sql, code] of [
      [
        "INSERT INTO db_probe.author(id,name) VALUES(gen_random_uuid(),NULL)",
        "23502",
      ],
      [
        "INSERT INTO db_probe.author(id,name) VALUES(gen_random_uuid(),'')",
        "23514",
      ],
      [
        "INSERT INTO db_probe.blog(id,owner_id,title) VALUES(gen_random_uuid(),gen_random_uuid(),'fk')",
        "23503",
      ],
    ])
      await assert.rejects(
        () => db.query({ text: sql }),
        (e) => e.details.sqlstate === code,
      );
    await assert.rejects(
      () => api.author.insert(editor, { name: "duplicate" }),
      (e) =>
        e.details.publicFields?.[0] === "id" &&
        F.presentFailure(e).body.error.fields?.[0] === "id",
    );
    await assert.rejects(
      () => api.author.insert(a, { name: "duplicate" }),
      (e) => e.details.publicFields === undefined,
    );
    const notify = db.resource(
      F.defineResource({
        ...F.blogs,
        hooks: {
          afterCommit: () => {
            throw undefined;
          },
        },
      }),
    );
    await assert.rejects(
      () => notify.insert(a, { title: "falsy observer" }),
      (e) =>
        e instanceof F.DbFailure &&
        e.kind === "post_commit" &&
        e.details.committed,
    );
  });
  await test("concurrent lock/read/validate/write loses no increments", async () => {
    const record = await api.blog.insert(a, {
      title: "concurrent counter",
      sequence: "0",
    });
    const counted = db.resource(
      F.defineResource({
        ...F.blogs,
        hooks: {
          beforeWrite: ({ before, draft }) => {
            draft.sequence = (BigInt(before.sequence) + 1n).toString();
          },
        },
      }),
    );
    await Promise.all(
      Array.from({ length: 12 }, () =>
        counted.update(a, record.id, { body: "increment" }),
      ),
    );
    assert.equal((await api.blog.get(a, record.id)).sequence, "12");
    if (native)
      assert.ok(
        pg.totalCount > 1,
        "Native concurrency must use multiple sessions",
      );
  });
  await test("schema transformations run once; nested server-owned defaults are protected", async () => {
    const transformed = db.resource(
      F.defineResource({
        ...F.blogs,
        fields: {
          ...F.blogs.fields,
          title: F.field(
            F.z.string().transform((v) => v + "!"),
            { ...F.blogs.fields.title, schema: undefined },
          ),
        },
        hooks: { beforeWrite: () => {} },
      }),
    );
    const record = await transformed.insert(a, { title: "once" });
    assert.equal(record.title, "once!");
    const protectedJson = db.resource(
      F.defineResource({
        ...F.blogs,
        fields: {
          ...F.blogs.fields,
          meta: F.f.json({
            read: () => true,
            createValue: () => ({ nested: { safe: true } }),
          }),
        },
        hooks: {
          beforeWrite: ({ draft }) => {
            draft.meta.nested.safe = false;
          },
        },
      }),
    );
    await rejects(
      () => protectedJson.insert(a, { title: "must reject" }),
      "forbidden",
    );
  });
afterAll(async () => {
  if (native) await pg.end();
  else await pg.close();
})
