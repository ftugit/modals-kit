/**
 * Узел `exists` в грамматике Filter (docs/plan-exists-filter.md): политика
 * модели смотрит в другую модель одним SQL. Узел серверный (только
 * доверенные фильтры политик), внутри по умолчанию действует
 * select-политика цели, мягко удалённые цели существованием не считаются.
 */
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, it } from "vitest";
import { createDb, defineResource, f, DbFailure, conservativeLimits } from "../index";
import type { DataContext, Database, Filter, Resource } from "../index";
import { pgliteAdapter } from "../adapters/pglite";
import { defineSchema } from "../sync/index";
import { filterSQL, Sql } from "../query/sql";

const test = (name: string, fn: () => Promise<void>) => it(name, fn, 30_000);
let shared: PGlite | undefined;
afterAll(async () => {
  await shared?.close();
});
async function withDb(resources: Resource[], fn: (db: Database) => Promise<void>) {
  shared ??= new PGlite();
  await shared.exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  const driver = pgliteAdapter(shared);
  assert.equal((await defineSchema({ resources }).sync(driver)).status, "ok");
  await fn(createDb({ driver, limits: conservativeLimits, resources }));
}
const ctx = { principal: { roles: [] as string[] } };
const rw = { read: () => true, create: () => true, update: () => true } as const;
const idField = () =>
  f.uuid({ read: () => true, createValue: () => crypto.randomUUID(), immutable: true, orderable: true, filters: ["eq"] as const });
const pub = { insert: () => true, update: () => true as Filter, delete: () => true as Filter };

const profiles = defineResource({
  key: "t.exists.profile",
  table: "public.ex_profile",
  primaryKey: "id",
  fields: {
    id: idField(),
    member_id: f.uuid({ ...rw, required: true, filters: ["eq"] }),
    grp: f.text({ ...rw, required: true, filters: ["eq"] }),
    nickname: f.text({ ...rw, required: true, filters: ["eq"] }),
    deleted_at: f.timestamp({ read: () => true, generated: true, nullable: true }),
  },
  policy: { select: () => true, insert: () => true, update: () => true, delete: () => true },
  order: [["id", "asc"]],
  softDelete: { field: "deleted_at", value: () => new Date().toISOString(), readDeleted: ["admin"] },
});
const keys = defineResource({
  key: "t.exists.key",
  table: "public.ex_key",
  primaryKey: "id",
  fields: {
    id: idField(),
    member_id: f.uuid({ ...rw, required: true, filters: ["eq"] }),
    k: f.text({ ...rw, required: true, filters: ["eq"] }),
    v: f.text({ ...rw, nullable: true, filters: ["eq"] }),
  },
  policy: { select: () => true, insert: () => true, update: () => true, delete: () => true },
  order: [["id", "asc"]],
});
/** Та же таблица ключей, но select закрыт: цель, которую никто не читает. */
const keysClosed = defineResource({
  key: "t.exists.key.closed",
  table: "public.ex_key",
  primaryKey: "id",
  fields: keys.fields,
  policy: { select: () => false, insert: () => true, update: () => true, delete: () => true },
  order: [["id", "asc"]],
});
const sessions = defineResource({
  key: "t.exists.session",
  table: "public.ex_session",
  primaryKey: "id",
  fields: {
    id: idField(),
    member_id: f.uuid({ ...rw, required: true, filters: ["eq"] }),
    state: f.text({ ...rw, required: true, filters: ["eq"] }),
  },
  policy: { select: () => true, insert: () => true, update: () => true, delete: () => true },
  order: [["id", "asc"]],
});
function members(select: (ctx: DataContext) => Filter, extra: Partial<Resource["policy"]> = {}) {
  return defineResource({
    key: "t.exists.member",
    table: "public.ex_member",
    primaryKey: "id",
    fields: {
      id: idField(),
      name: f.text({ ...rw, required: true, filters: ["eq"], orderable: true }),
      grp: f.text({ ...rw, required: true, filters: ["eq"] }),
      mentor_id: f.uuid({ ...rw, nullable: true, filters: ["eq"] }),
    },
    policy: { select, insert: () => true, update: () => true as Filter, delete: () => true as Filter, ...extra },
    order: [["name", "asc"]],
  });
}
const hasProfile: Filter = { exists: { from: profiles, on: [["id", "member_id"]] } };

async function seed(db: Database, memberRes: Resource) {
  const m = db.resource(memberRes);
  const a = await m.insert(ctx, { name: "a", grp: "g1" });
  const b = await m.insert(ctx, { name: "b", grp: "g1" });
  const c = await m.insert(ctx, { name: "c", grp: "g2" });
  await db.resource(profiles).insert(ctx, { member_id: a.id, grp: "g1", nickname: "ann" });
  await db.resource(keys).insert(ctx, { member_id: b.id, k: "x", v: "1" });
  await db.resource(sessions).insert(ctx, { member_id: c.id, state: "live" });
  return { a, b, c };
}
const names = (rows: readonly { name?: unknown }[]) => rows.map((r) => r.name);

test("exists в select-политике: видна только строка со связанной записью", async () => {
  const res = members(() => hasProfile);
  await withDb([res, profiles, keys, sessions], async (db) => {
    const { a } = await seed(db, res);
    assert.deepEqual(names(await db.resource(res).select(ctx)), ["a"]);
    assert.equal((await db.resource(res).get(ctx, a.id)).name, "a");
    assert.equal(await db.resource(res).count(ctx), 1);
  });
});

test("not exists: строки без связанной записи", async () => {
  const res = members(() => ({ not: hasProfile }));
  await withDb([res, profiles, keys, sessions], async (db) => {
    await seed(db, res);
    assert.deepEqual(names(await db.resource(res).select(ctx)), ["b", "c"]);
  });
});

test("несколько exists: and — оба условия, or — любое", async () => {
  const both = members(() => ({
    and: [hasProfile, { exists: { from: keys, on: [["id", "member_id"]] } }],
  }));
  await withDb([both, profiles, keys, sessions], async (db) => {
    await seed(db, both);
    assert.deepEqual(names(await db.resource(both).select(ctx)), []);
  });
  const any = members(() => ({
    or: [hasProfile, { exists: { from: sessions, on: [["id", "member_id"]] } }],
  }));
  await withDb([any, profiles, keys, sessions], async (db) => {
    await seed(db, any);
    assert.deepEqual(names(await db.resource(any).select(ctx)), ["a", "c"]);
  });
});

test("вложенный exists и составной on из двух пар", async () => {
  const nested = members(() => ({
    exists: {
      from: keys,
      on: [
        ["id", "member_id"],
        ["grp", "grp"],
      ],
      where: { exists: { from: sessions, on: [["member_id", "member_id"]] } },
    },
  }));
  // У ключей нет поля grp — составной on по профилям отдельной проверкой ниже.
  void nested;
  const res = members(() => ({
    exists: {
      from: profiles,
      on: [
        ["id", "member_id"],
        ["grp", "grp"],
      ],
      where: { field: "nickname", op: "eq", value: "ann" },
    },
  }));
  await withDb([res, profiles, keys, sessions], async (db) => {
    await seed(db, res);
    assert.deepEqual(names(await db.resource(res).select(ctx)), ["a"]);
  });
  const deep = members(() => ({
    exists: {
      from: keys,
      on: [["id", "member_id"]],
      where: {
        exists: { from: sessions, on: [["member_id", "member_id"]], where: { field: "state", op: "eq", value: "live" } },
      },
    },
  }));
  await withDb([deep, profiles, keys, sessions], async (db) => {
    const { b, c } = await seed(db, deep);
    // Ключ есть у b, живая сессия — у c: совпадения по цепочке нет.
    assert.deepEqual(names(await db.resource(deep).select(ctx)), []);
    await db.resource(sessions).insert(ctx, { member_id: b.id, state: "live" });
    assert.deepEqual(names(await db.resource(deep).select(ctx)), ["b"]);
    void c;
  });
});

test("ссылка модели на себя: у кого есть подопечный", async () => {
  let self!: Resource;
  // Ссылка на себя — с policy: false: иначе select-политика цели применила бы саму себя рекурсивно.
  self = members(() => ({ exists: { from: self, on: [["id", "mentor_id"]], policy: false } }));
  await withDb([self, profiles, keys, sessions], async (db) => {
    const m = db.resource(self);
    const mentor = await m.insert(ctx, { name: "mentor", grp: "g" });
    await m.insert(ctx, { name: "pupil", grp: "g", mentor_id: mentor.id });
    assert.deepEqual(names(await m.select(ctx)), ["mentor"]);
  });
});

test("policy цели: true прячет недоступное, false — явное исключение", async () => {
  const strict = members(() => ({ exists: { from: keysClosed, on: [["id", "member_id"]] } }));
  await withDb([strict, profiles, keysClosed, sessions], async (db) => {
    await seed(db, strict);
    assert.deepEqual(names(await db.resource(strict).select(ctx)), []);
  });
  const open = members(() => ({ exists: { from: keysClosed, on: [["id", "member_id"]], policy: false } }));
  await withDb([open, profiles, keysClosed, sessions], async (db) => {
    await seed(db, open);
    assert.deepEqual(names(await db.resource(open).select(ctx)), ["b"]);
  });
});

test("мягко удалённая связанная строка существованием не считается", async () => {
  const res = members(() => hasProfile);
  await withDb([res, profiles, keys, sessions], async (db) => {
    const { a } = await seed(db, res);
    assert.deepEqual(names(await db.resource(res).select(ctx)), ["a"]);
    const p = (await db.resource(profiles).select(ctx))[0]!;
    await db.resource(profiles).delete(ctx, p.id);
    assert.deepEqual(names(await db.resource(res).select(ctx)), []);
  });
});

test("недоверенный фильтр: exists с policy: false запрещён, с политикой цели — работает", async () => {
  const res = members(() => true, { update: () => ({ not: hasProfile }) });
  await withDb([res, profiles, keys, sessions], async (db) => {
    const { a, b } = await seed(db, res);
    await assert.rejects(
      db.resource(res).select(ctx, { filter: { exists: { from: profiles, on: [["id", "member_id"]], policy: false } } }),
      (e: unknown) => e instanceof DbFailure && e.kind === "forbidden",
    );
    assert.deepEqual(names(await db.resource(res).select(ctx, { filter: hasProfile })), ["a"]);
    // update-политика «только без профиля»: b правится, a — нет.
    assert.equal((await db.resource(res).update(ctx, b.id, { name: "b2" })).name, "b2");
    await assert.rejects(db.resource(res).update(ctx, a.id, { name: "a2" }), DbFailure);
  });
});

test("SQL: один запрос, у каждого exists свой алиас", async () => {
  const res = members(() => true);
  const s = new Sql();
  const text = await filterSQL(
    res,
    ctx,
    { and: [hasProfile, { exists: { from: keys, on: [["id", "member_id"]] } }] },
    s,
    conservativeLimits,
    true,
  );
  assert.match(text, /EXISTS \(SELECT 1 FROM "public"\."ex_profile" AS "kit_exists_1"/);
  assert.match(text, /EXISTS \(SELECT 1 FROM "public"\."ex_key" AS "kit_exists_2"/);
});

test("вложенность сверх filterDepth — validation", async () => {
  let f: Filter = true;
  for (let i = 0; i < 12; i++) f = { exists: { from: keys, on: [["id", "member_id"]], where: f } };
  const res = members(() => f);
  await withDb([res, profiles, keys, sessions], async (db) => {
    await assert.rejects(
      db.resource(res).select(ctx),
      (e: unknown) => e instanceof DbFailure && e.kind === "validation",
    );
  });
});
