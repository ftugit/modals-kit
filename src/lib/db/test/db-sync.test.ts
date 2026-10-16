/**
 * Схема из моделей (`#lib/db/sync/index.js`) и цепочка удаления.
 * Каждая проверка — на своём PGlite в памяти: это настоящий PostgreSQL, поэтому
 * `pg_catalog`, `format_type`, advisory-блокировка и DDL в транзакции — те же, что на сервере.
 */
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { z } from "zod";
import { afterAll, it } from "vitest";
import { createDb, defineResource, f, field, link, make, owner, policy, s, DbFailure, conservativeLimits } from "../index";
import { pgliteAdapter } from "../adapters/pglite";
import { toKitError } from "../sveltekit/index";
import { choices, defineSchema, stepKey } from "../sync/index";
import type { SyncStep } from "../sync/index";
import type { Driver, Fields, Resource } from "../index";

const test = (name: string, fn: () => Promise<void>) => it(name, fn, 30_000);

/*
 * Один PGlite на файл: экземпляр — это ~100 МБ WASM-памяти, и пятнадцать штук подряд
 * не успевают освободиться (OOM воркера). Между проверками схема `public`
 * пересоздаётся — каждая начинает с пустой БД.
 */
let shared: PGlite | undefined;
afterAll(async () => {
  await shared?.close();
});
async function withPg(fn: (pg: PGlite, driver: Driver) => Promise<void>) {
  shared ??= new PGlite();
  await shared.exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await fn(shared, pgliteAdapter(shared));
}
const open = { read: () => true } as const;
const rules = { select: policy.publicRows(), insert: () => true, update: policy.publicRows(), delete: policy.publicRows() };
const ctx = { principal: { roles: [] } };

/** Ресурс «запись»: как демо `posts`, плюс то, что подставит проверка. */
function post(extra: Fields = {}, more: Partial<Resource> = {}) {
  return defineResource({
    key: "t.post",
    table: "public.post",
    primaryKey: "id",
    fields: {
      id: f.uuid({ ...open, orderable: true, filters: ["eq"], db: { default: "gen_random_uuid()" } }),
      title: field(s.text({ min: 3, max: 120 }), { ...open, create: () => true, required: true }),
      created_at: f.timestamp({ ...open, generated: true, orderable: true, db: { default: "clock_timestamp()" } }),
      ...extra,
    },
    policy: rules,
    order: [["created_at", "desc"]],
    ...more,
  } as Resource);
}
const columns = async (pg: PGlite, table = "post") =>
  (
    await pg.query<{ name: string; type: string; not_null: boolean; def: string | null }>(
      `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS not_null,
              pg_get_expr(d.adbin, d.adrelid) AS def
         FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`,
      [table],
    )
  ).rows;
const objects = async (pg: PGlite, table = "post") =>
  (
    await pg.query<{ name: string }>(
      `SELECT conname AS name FROM pg_constraint WHERE conrelid = $1::regclass AND contype = 'c'
       UNION ALL SELECT ic.relname FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid WHERE i.indrelid = $1::regclass`,
      [table],
    )
  ).rows.map((r) => r.name).sort();
const kinds = (steps: readonly { kind: string; column?: string }[]) => steps.map((x) => x.kind + (x.column ? ":" + x.column : ""));

test("sync: пустая БД → таблица как в модели (типы, NOT NULL, DEFAULT, CHECK, keyset-индекс)", () =>
  withPg(async (pg, driver) => {
    const report = await defineSchema({ resources: [post()] }).sync(driver);
    assert.equal(report.status, "ok");
    assert.deepEqual(kinds(report.applied), ["create_table", "create_index"]);
    assert.deepEqual(await columns(pg), [
      { name: "id", type: "uuid", not_null: true, def: "gen_random_uuid()" },
      { name: "title", type: "text", not_null: true, def: null },
      { name: "created_at", type: "timestamp with time zone", not_null: true, def: "clock_timestamp()" },
    ]);
    const objs = await objects(pg);
    assert.equal(objs.filter((n) => /^post_ck_[0-9a-f]{8}$/.test(n)).length, 1, objs.join());
    assert.equal(objs.filter((n) => /^post_ix_[0-9a-f]{8}$/.test(n)).length, 1, objs.join());
    // CHECK из s.text({ min: 3, max: 120 }) и правда в БД
    await assert.rejects(pg.query("INSERT INTO post (title) VALUES ('ab')"), /check constraint/);
    await pg.query("INSERT INTO post (title) VALUES ('abc')");
  }));

test("sync: второй запуск — быстрая проверка, ничего не применяет; gate пропускает запросы", () =>
  withPg(async (_pg, driver) => {
    const schema = defineSchema({ resources: [post()] });
    await schema.sync(driver);
    let statements = 0;
    const counting: Driver = { ...driver, query: (st) => (statements++, driver.query(st)), transaction: driver.transaction };
    const again = await schema.sync(counting);
    assert.deepEqual([again.status, again.applied.length, statements], ["ok", 0, 1]);
    const gated = await schema.gate(driver);
    const db = createDb({ driver: gated, limits: conservativeLimits });
    await db.resource(post()).insert(ctx, { title: "Первая" });
    assert.equal((await db.resource(post()).select(ctx)).length, 1);
  }));

test("sync: новая необязательная колонка и колонка с DEFAULT добавляются сами, данные целы", () =>
  withPg(async (pg, driver) => {
    await defineSchema({ resources: [post()] }).sync(driver);
    await pg.query("INSERT INTO post (title) VALUES ('Старая запись')");
    const next = post({
      subtitle: field(s.text(), { ...open, nullable: true }),
      views: f.integer({ ...open, db: { default: "0" } }),
    });
    const report = await defineSchema({ resources: [next] }).sync(driver);
    assert.equal(report.status, "ok");
    assert.deepEqual(kinds(report.applied), ["add_column:subtitle", "add_column:views"]);
    assert.deepEqual((await pg.query("SELECT title, subtitle, views FROM post")).rows, [
      { title: "Старая запись", subtitle: null, views: 0 },
    ]);
  }));

test("sync: обязательная колонка без DEFAULT — конфликт на непустой таблице, само на пустой; gate отвечает schema_pending (503)", () =>
  withPg(async (pg, driver) => {
    await defineSchema({ resources: [post()] }).sync(driver);
    const next = post({ slug: f.text({ ...open }) });
    const onEmpty = await defineSchema({ resources: [next] }).sync(driver);
    assert.deepEqual([onEmpty.status, kinds(onEmpty.applied)], ["ok", ["add_column:slug"]]);

    await pg.query("ALTER TABLE post DROP COLUMN slug");
    await pg.query("INSERT INTO post (title) VALUES ('Есть данные')");
    await pg.query("DELETE FROM kit_schema");
    const reports: string[] = [];
    const gated = await defineSchema({ resources: [next] }).gate(driver, { onReport: (r) => reports.push(r.status) });
    assert.deepEqual(reports, ["pending"]);
    const failure = await gated.query({ text: "SELECT 1" }).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(failure instanceof DbFailure && failure.kind === "schema_pending");
    assert.equal(toKitError(failure).status, 503);
    assert.equal((await columns(pg)).some((c) => c.name === "slug"), false);
  }));

test("sync: переименование (пропала и появилась колонка одного типа) — конфликт, ничего не добавлено", () =>
  withPg(async (pg, driver) => {
    await defineSchema({ resources: [post({ name: field(s.text(), { ...open, nullable: true }) })] }).sync(driver);
    const report = await defineSchema({ resources: [post({ label: field(s.text(), { ...open, nullable: true }) })] }).sync(driver);
    assert.equal(report.status, "pending");
    assert.deepEqual(kinds(report.conflicts), ["rename_or_replace:label"]);
    assert.equal(report.conflicts[0]!.from, "name");
    assert.match(report.conflicts[0]!.sql[0]!, /RENAME COLUMN "name" TO "label"/);
    assert.deepEqual((await columns(pg)).map((c) => c.name), ["id", "title", "created_at", "name"]);
  }));

test("sync: колонка, которой нет в модели — notice; NOT NULL без DEFAULT — конфликт", () =>
  withPg(async (pg, driver) => {
    await defineSchema({ resources: [post()] }).sync(driver);
    await pg.query("ALTER TABLE post ADD COLUMN legacy integer");
    await pg.query("DELETE FROM kit_schema");
    const soft = await defineSchema({ resources: [post()] }).sync(driver);
    assert.deepEqual([soft.status, kinds(soft.notices)], ["ok", ["extra_column:legacy"]]);
    await pg.query("ALTER TABLE post ADD COLUMN must integer NOT NULL");
    await pg.query("DELETE FROM kit_schema");
    const hard = await defineSchema({ resources: [post()] }).sync(driver);
    assert.deepEqual([hard.status, kinds(hard.conflicts)], ["pending", ["extra_required_column:must"]]);
  }));

test("sync: смена типа — конфликт; NOT NULL при NULL в данных — конфликт, без NULL — само", () =>
  withPg(async (pg, driver) => {
    const nullable = post({ note: field(s.text(), { ...open, nullable: true }) });
    await defineSchema({ resources: [nullable] }).sync(driver);
    await pg.query("INSERT INTO post (title, note) VALUES ('С заметкой', 'x')");
    const typed = await defineSchema({ resources: [post({ note: f.integer({ ...open, nullable: true }) })] }).sync(driver);
    assert.deepEqual(kinds(typed.conflicts), ["change_type:note"]);

    const required = post({ note: field(s.text(), { ...open }) });
    const ok = await defineSchema({ resources: [required] }).sync(driver);
    assert.deepEqual([ok.status, kinds(ok.applied)], ["ok", ["set_not_null:note"]]);
    await pg.query("ALTER TABLE post ALTER COLUMN note DROP NOT NULL");
    await pg.query("INSERT INTO post (title) VALUES ('Без заметки')");
    await pg.query("DELETE FROM kit_schema");
    const blocked = await defineSchema({ resources: [required] }).sync(driver);
    assert.deepEqual(kinds(blocked.conflicts), ["nulls_in_required:note"]);
  }));

test("sync: CHECK изменился — старый управляемый удалён, новый добавлен; чужие объекты не тронуты", () =>
  withPg(async (pg, driver) => {
    await defineSchema({ resources: [post()] }).sync(driver);
    await pg.query("ALTER TABLE post ADD CONSTRAINT hand_made CHECK (title <> 'запрещено')");
    const before = await objects(pg);
    const wider = defineResource({
      ...post(),
      fields: { ...post().fields, title: field(s.text({ min: 3, max: 200 }), { ...open, create: () => true, required: true }) },
    });
    const report = await defineSchema({ resources: [wider] }).sync(driver);
    assert.deepEqual(kinds(report.applied), ["drop_check", "add_check"]);
    const after = await objects(pg);
    assert.ok(after.includes("hand_made"));
    assert.notDeepEqual(after.filter((n) => n.includes("_ck_")), before.filter((n) => n.includes("_ck_")));
    await pg.query(`INSERT INTO post (title) VALUES ('${"я".repeat(150)}')`);
  }));

test("sync: уникальность — дубли дают конфликт, без дублей индекс создаётся (у softDelete — среди живых)", () =>
  withPg(async (pg, driver) => {
    const plain = post({ slug: field(s.text(), { ...open, nullable: true }) });
    await defineSchema({ resources: [plain] }).sync(driver);
    await pg.query("INSERT INTO post (title, slug) VALUES ('Один', 'a'), ('Два', 'a')");
    const unique = post({ slug: field(s.text(), { ...open, nullable: true, db: { unique: true } }) });
    const dup = await defineSchema({ resources: [unique] }).sync(driver);
    assert.deepEqual(kinds(dup.conflicts), ["unique_duplicates:slug"]);

    await pg.query("UPDATE post SET slug = 'b' WHERE title = 'Два'");
    const ok = await defineSchema({ resources: [unique] }).sync(driver);
    assert.deepEqual([ok.status, kinds(ok.applied)], ["ok", ["create_index"]]);
    await assert.rejects(pg.query("INSERT INTO post (title, slug) VALUES ('Три', 'a')"), /duplicate key/);
  }).then(() =>
    // мягкое удаление: тот же slug разрешён, если прежняя строка помечена удалённой
    withPg(async (pg2, driver2) => {
      const soft = post(
        {
          slug: field(s.text(), { ...open, nullable: true, db: { unique: true } }),
          deleted_at: f.timestamp({ ...open, nullable: true }),
        },
        { softDelete: { field: "deleted_at", value: () => new Date().toISOString(), readDeleted: () => true } },
      );
      await defineSchema({ resources: [soft] }).sync(driver2);
      await pg2.query("INSERT INTO post (title, slug, deleted_at) VALUES ('Старый', 'a', now())");
      await pg2.query("INSERT INTO post (title, slug) VALUES ('Новый', 'a')");
      await assert.rejects(pg2.query("INSERT INTO post (title, slug) VALUES ('Ещё', 'a')"), /duplicate key/);
    }),
  ));

test("sync onStep: этапы по порядку (проверка, таблица, скрипт, итог); быстрая проверка — сразу итог", () =>
  withPg(async (_pg, driver) => {
    const schema = defineSchema({ resources: [post()], sql: [{ id: "seed", text: "SELECT 1" }] });
    const steps: SyncStep[] = [];
    await schema.gate(driver, { onStep: (step) => steps.push(step) });
    assert.deepEqual(steps, [
      { done: 0, total: 3, step: "check" },
      { done: 1, total: 3, step: "table", name: "public.post" },
      { done: 2, total: 3, step: "sql", name: "seed" },
      { done: 3, total: 3 },
    ]);
    steps.length = 0;
    await schema.sync(driver, { onStep: (step) => steps.push(step) });
    assert.deepEqual(steps, [{ done: 0, total: 3, step: "check" }, { done: 3, total: 3 }]);
  }));

test("sync: ручной SQL выполняется один раз; изменённый текст под тем же id — конфликт", () =>
  withPg(async (pg, driver) => {
    const seed = { id: "seed", text: "INSERT INTO post (title) VALUES ('Сид 1'); INSERT INTO post (title) VALUES ('Сид 2');" };
    await defineSchema({ resources: [post()], sql: [seed] }).sync(driver);
    await defineSchema({ resources: [post()], sql: [seed] }).sync(driver);
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM post")).rows[0]!.n, 2);
    const changed = await defineSchema({ resources: [post()], sql: [{ id: "seed", text: "SELECT 1" }] }).sync(driver);
    assert.deepEqual([changed.status, kinds(changed.conflicts)], ["pending", ["sql_changed:seed"]]);
  }));

test("gate: конфликт снят (ALTER вручную + sync) — запросы идут без перезапуска", () =>
  withPg(async (pg, driver) => {
    await defineSchema({ resources: [post()] }).sync(driver);
    await pg.query("INSERT INTO post (title) VALUES ('Есть данные')");
    const schema = defineSchema({ resources: [post({ slug: f.text({ ...open }) })] });
    const gated = await schema.gate(driver);
    await assert.rejects(gated.query({ text: "SELECT 1" }), (e: unknown) => e instanceof DbFailure && e.kind === "schema_pending");
    // так поступит серверное действие «Выполнить» (шаг 4): решение + повторный sync
    await pg.query("ALTER TABLE post ADD COLUMN slug text NOT NULL DEFAULT 'x'");
    assert.equal((await schema.sync(driver)).status, "ok");
    assert.equal((await gated.query({ text: "SELECT 1 AS one" })).rows[0]!.one, 1);
  }));

test("sync: параллельные запуски не мешают друг другу (блокировка)", () =>
  withPg(async (pg, driver) => {
    const reports = await Promise.all([1, 2, 3].map(() => defineSchema({ resources: [post()] }).sync(driver)));
    assert.deepEqual(reports.map((r) => r.status), ["ok", "ok", "ok"]);
    assert.equal(reports.filter((r) => r.applied.length).length, 1);
    assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM kit_schema")).rows[0]!.n, 1);
  }));

test("sync: схема без сведений о колонке и без db.type — понятная ошибка; драйвер без транзакций — unsupported", () =>
  withPg(async (_pg, driver) => {
    const opaque = post({ tag: field(make<string>("app/tag", () => true), { ...open, nullable: true }) });
    await assert.rejects(defineSchema({ resources: [opaque] }).sync(driver), (e: unknown) =>
      e instanceof DbFailure && e.kind === "validation" && /db: \{ type/.test(String(e.details.issues)),
    );
    const typed = post({ tag: field(z.string(), { ...open, nullable: true, db: { type: "varchar(20)" } }) });
    assert.equal((await defineSchema({ resources: [typed] }).sync(driver)).status, "ok");
    assert.equal((await defineSchema({ resources: [typed] }).sync(driver)).applied.length, 0);
    const http: Driver = { ...driver, capabilities: { ...driver.capabilities, transactions: false } };
    await assert.rejects(defineSchema({ resources: [typed] }).sync(http), (e: unknown) => e instanceof DbFailure && e.kind === "unsupported");
  }));

test("sync: zod 4 реализует Standard JSON Schema — тип колонки и CHECK из неё, без db.type", () =>
  withPg(async (pg, driver) => {
    const zodPost = post({ tag: field(z.string().min(2).max(20), { ...open, nullable: true }) });
    assert.equal((await defineSchema({ resources: [zodPost] }).sync(driver)).status, "ok");
    const col = await pg.query<{ data_type: string }>(
      "SELECT data_type FROM information_schema.columns WHERE table_name = 'post' AND column_name = 'tag'",
    );
    assert.equal(col.rows[0]?.data_type, "text");
    const checks = await pg.query<{ def: string }>(
      "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'public.post'::regclass AND contype = 'c'",
    );
    assert.ok(checks.rows.some((r) => /char_length\(tag\) >= 2.*char_length\(tag\) <= 20/.test(r.def)), JSON.stringify(checks.rows));
  }));

/* ── цепочка удаления (model-automation.md §10, §11 шаг 7) ─────────────── */

/** Запись ⊃ комментарии ⊃ голоса; у всех мягкое удаление. `votesSoft: false` — голоса удаляются только навсегда. */
function family(o: { votesSoft?: boolean; commentDelete?: Resource["policy"]; commentHooks?: Resource["hooks"] } = {}) {
  const base = (key: string, table: string, fields: Fields, more: Partial<Resource> = {}) =>
    defineResource({
      key,
      table,
      primaryKey: "id",
      fields: { id: f.uuid({ ...open, orderable: true, filters: ["eq"], db: { default: "gen_random_uuid()" } }), ...fields },
      policy: rules,
      order: [],
      timestamps: { deletedAt: { field: "deleted_at", readDeleted: () => true } },
      ...more,
    } as Resource);
  const posts: Resource = base("t.fpost", "public.fpost", { title: f.text({ ...open, create: () => true }) });
  const comments: Resource = base(
    "t.comment",
    "public.comment",
    { post_id: f.uuid({ ...open, filters: ["eq"], db: { references: { resource: () => posts, chain: true } } }), author: f.text({ ...open, nullable: true }) },
    {
      relations: { post: { resource: posts, localField: "post_id", foreignField: "id" } },
      ...(o.commentDelete ? { policy: o.commentDelete } : {}),
      ...(o.commentHooks ? { hooks: o.commentHooks } : {}),
    },
  );
  const votes: Resource = base(
    "t.vote",
    "public.vote",
    { comment_id: f.uuid({ ...open, db: { references: { resource: () => comments, chain: true } } }) },
    o.votesSoft === false ? { timestamps: undefined } : {},
  );
  return { posts, comments, votes };
}
async function seedFamily(pg: PGlite, driver: Driver, rs: ReturnType<typeof family>) {
  await defineSchema({ resources: [rs.posts, rs.comments, rs.votes] }).sync(driver);
  const id = (await pg.query<{ id: string }>("INSERT INTO fpost (title) VALUES ('p') RETURNING id")).rows[0]!.id;
  const other = (await pg.query<{ id: string }>("INSERT INTO fpost (title) VALUES ('q') RETURNING id")).rows[0]!.id;
  const c = (await pg.query<{ id: string }>("INSERT INTO comment (post_id, author) VALUES ($1, 'я'), ($1, 'чужой'), ($2, 'я') RETURNING id", [id, other])).rows;
  await pg.query("INSERT INTO vote (comment_id) VALUES ($1), ($2), ($3)", [c[0]!.id, c[1]!.id, c[2]!.id]);
  return { id, comments: c.map((x) => x.id), db: createDb({ driver, limits: conservativeLimits, resources: [rs.posts, rs.comments, rs.votes] }) };
}
const count = async (pg: PGlite, table: string, where = "TRUE") =>
  (await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`)).rows[0]!.n;
const live = (pg: PGlite, table: string) => count(pg, table, "deleted_at IS NULL");

test("цепочка: chain собирает звенья и права, ничего не удаляя; мягкий корень — мягко всё; hard — навсегда, и удалённых детей", () =>
  withPg(async (pg, driver) => {
    const rs = family();
    const { id, comments, db } = await seedFamily(pg, driver, rs);
    const idx = await pg.query<{ def: string }>("SELECT indexdef AS def FROM pg_indexes WHERE tablename = 'comment'");
    assert.ok(idx.rows.some((x) => /\(post_id\)$/.test(x.def)), "полный индекс по ссылке — и для удалённых детей");
    const plan = await db.resource(rs.posts).chain(ctx, id);
    assert.deepEqual(plan.root, { model: "t.fpost", id, allowed: true, soft: true });
    assert.deepEqual(
      plan.links.map((l) => [l.model, l.path.join(">"), l.total, l.allowed, l.soft]),
      [["t.comment", "t.fpost>t.comment", 2, 2, true], ["t.vote", "t.fpost>t.comment>t.vote", 2, 2, true]],
    );
    assert.deepEqual([...plan.links[0]!.ids].sort(), comments.slice(0, 2).sort());
    assert.deepEqual([await live(pg, "fpost"), await live(pg, "comment"), await live(pg, "vote")], [2, 3, 3], "chain ничего не удалил");
    const done = await plan.delete();
    assert.deepEqual(done.links, [{ model: "t.comment", count: 2 }, { model: "t.vote", count: 2 }]);
    assert.ok(done.root.deleted_at, "корень помечен последним");
    assert.deepEqual([await live(pg, "fpost"), await live(pg, "comment"), await live(pg, "vote")], [1, 1, 1], "у второй записи всё на месте");
    // мягко удалённая запись: удалить навсегда — с её уже удалёнными детьми (без них база не даст)
    const again = await db.resource(rs.posts).chain(ctx, id);
    assert.deepEqual([again.root.soft, again.links.map((l) => l.total)], [false, [2, 2]], "удалённый корень — только навсегда");
    await again.delete({ hard: true });
    assert.deepEqual([await count(pg, "fpost"), await count(pg, "comment"), await count(pg, "vote")], [1, 1, 1], "стёрто навсегда");
  }));

test("цепочка: не хватает прав — forbidden с моделью, путём и числом; звено без мягкого удаления — unsupported; ничего не удалено", () =>
  withPg(async (pg, driver) => {
    const rs = family({ commentDelete: { ...rules, delete: () => ({ field: "author", op: "eq", value: "я" }) } });
    const { id, db } = await seedFamily(pg, driver, rs);
    const plan = await db.resource(rs.posts).chain(ctx, id);
    assert.deepEqual(plan.links.map((l) => [l.model, l.allowed, l.total]), [["t.comment", 1, 2], ["t.vote", 2, 2]]);
    const e = await plan.delete().catch((x: unknown) => x);
    assert.ok(e instanceof DbFailure && e.kind === "forbidden");
    assert.deepEqual([e.details.model, e.details.path, e.details.count], ["t.comment", ["t.fpost", "t.comment"], 1]);
    assert.deepEqual([await live(pg, "fpost"), await live(pg, "comment"), await live(pg, "vote")], [2, 3, 3]);
  }).then(() =>
    withPg(async (pg, driver) => {
      const rs = family({ votesSoft: false });
      const { id, db } = await seedFamily(pg, driver, rs);
      const plan = await db.resource(rs.posts).chain(ctx, id);
      const e = await plan.delete().catch((x: unknown) => x);
      assert.ok(e instanceof DbFailure && e.kind === "unsupported", String(e));
      assert.deepEqual([e.details.model, e.details.count], ["t.vote", 2]);
      assert.deepEqual([await live(pg, "fpost"), await live(pg, "comment"), await count(pg, "vote")], [2, 3, 3], "откат целиком");
      await plan.delete({ hard: true });
      assert.deepEqual([await count(pg, "fpost"), await count(pg, "comment"), await count(pg, "vote")], [1, 1, 1], "навсегда — можно");
    }),
  ));

test("цепочка: круг принадлежности — ошибка createDb; дерево удаляется с нижних уровней; индекс по колонке; без resources — unsupported", () =>
  withPg(async (pg, driver) => {
    const a: Resource = defineResource({
      key: "t.a", table: "public.a", primaryKey: "id",
      fields: { id: f.uuid({ ...open, orderable: true, filters: ["eq"] }), b_id: f.uuid({ ...open, nullable: true, db: { references: { resource: () => b, chain: true } } }) },
      order: [],
    });
    const b: Resource = defineResource({
      key: "t.b", table: "public.b", primaryKey: "id",
      fields: { id: f.uuid({ ...open, orderable: true, filters: ["eq"] }), a_id: f.uuid({ ...open, nullable: true, db: { references: { resource: () => a, chain: true } } }) },
      order: [],
    });
    assert.throws(() => createDb({ driver, limits: conservativeLimits, resources: [a, b] }), (e: unknown) =>
      e instanceof DbFailure && /круг принадлежности/.test(String(e.details.issues)),
    );
    const tree: Resource = defineResource({
      key: "t.tree", table: "public.tree", primaryKey: "id",
      fields: {
        id: f.uuid({ ...open, orderable: true, filters: ["eq"], db: { default: "gen_random_uuid()" } }),
        parent_id: f.uuid({ ...open, nullable: true, db: { references: { resource: () => tree, chain: true, onDelete: "restrict" } } }),
      },
      order: [],
    });
    await defineSchema({ resources: [tree] }).sync(driver);
    const idx = await pg.query<{ def: string }>("SELECT indexdef AS def FROM pg_indexes WHERE tablename = 'tree'");
    assert.ok(idx.rows.some((x) => /\(parent_id\)$/.test(x.def)), JSON.stringify(idx.rows));
    const root = (await pg.query<{ id: string }>("INSERT INTO tree DEFAULT VALUES RETURNING id")).rows[0]!.id;
    const kid = (await pg.query<{ id: string }>("INSERT INTO tree (parent_id) VALUES ($1) RETURNING id", [root])).rows[0]!.id;
    await pg.query("INSERT INTO tree (parent_id) VALUES ($1), ($1)", [kid]);
    const plain = createDb({ driver, limits: conservativeLimits });
    await assert.rejects(plain.resource(tree).chain(ctx, root), (e: unknown) => e instanceof DbFailure && e.kind === "unsupported");
    await assert.rejects(plain.resource(tree).delete(ctx, root), (e: unknown) => e instanceof DbFailure && e.kind === "conflict", "без цепочки — отказ базы");
    const db = createDb({ driver, limits: conservativeLimits, resources: [tree] });
    const plan = await db.resource(tree).chain(ctx, root);
    assert.deepEqual(plan.links.map((l) => [l.model, l.total]), [["t.tree", 3]]);
    await plan.delete();
    assert.equal(await count(pg, "tree"), 0, "restrict-ссылки удалены с нижнего уровня");
  }));

test("цепочка: у звена с хуками — удаление по одной строке через его delete (хуки видят каждую)", () =>
  withPg(async (pg, driver) => {
    const ops: string[] = [];
    const rs = family({ commentHooks: { beforeWrite: ({ operation }) => void ops.push(operation) } });
    const { id, db } = await seedFamily(pg, driver, rs);
    const done = await (await db.resource(rs.posts).chain(ctx, id)).delete();
    assert.deepEqual(done.links.map((l) => l.count), [2, 2]);
    assert.deepEqual(ops, ["delete", "delete"]);
    assert.deepEqual([await live(pg, "comment"), await live(pg, "vote")], [1, 1]);
  }));

test("delete({ chain: true }): цепочка без отдельного chain(); ответ — запись; отказ откатывает всё; без resources — unsupported", () =>
  withPg(async (pg, driver) => {
    const rs = family({ commentDelete: { ...rules, delete: () => ({ field: "author", op: "eq", value: "я" }) } });
    const { id, db } = await seedFamily(pg, driver, rs);
    await assert.rejects(db.resource(rs.posts).delete(ctx, id, { chain: true }), (e: unknown) =>
      e instanceof DbFailure && e.kind === "forbidden" && e.details.model === "t.comment" && e.details.count === 1,
    );
    assert.deepEqual([await live(pg, "fpost"), await live(pg, "comment"), await live(pg, "vote")], [2, 3, 3], "ничего не удалено");
    const other = (await pg.query<{ id: string }>("SELECT id FROM fpost WHERE id <> $1", [id])).rows[0]!.id;
    const row = await db.resource(rs.posts).delete(ctx, other, { chain: true });
    assert.equal(row.id, other);
    assert.ok(row.deleted_at, "мягко: корень помечен");
    assert.deepEqual([await live(pg, "comment"), await live(pg, "vote")], [2, 2], "дети второй записи помечены");
    await db.resource(rs.posts).without(["policy"], (p) => p.delete(ctx, other, { chain: true, hard: true }));
    assert.deepEqual([await count(pg, "fpost"), await count(pg, "comment"), await count(pg, "vote")], [1, 2, 2], "навсегда — с уже удалёнными детьми");
    await db.resource(rs.posts).raw((p) => p.delete(ctx, id, { chain: true }));
    assert.deepEqual([await count(pg, "fpost"), await count(pg, "comment"), await count(pg, "vote")], [0, 0, 0], "сырой — всё навсегда");
    const plain = createDb({ driver, limits: conservativeLimits });
    await assert.rejects(plain.resource(rs.posts).delete(ctx, id, { chain: true }), (e: unknown) => e instanceof DbFailure && e.kind === "unsupported");
    await assert.rejects(plain.resource(rs.posts).delete(ctx, id, { cascade: true } as never), (e: unknown) => e instanceof DbFailure && e.kind === "validation");
  }));

test("raw: связанные записи — тоже сырые (удалённые, все поля); estimate видит удалённые", () =>
  withPg(async (pg, driver) => {
    const rs = family();
    const { id, db } = await seedFamily(pg, driver, rs);
    await pg.query("UPDATE fpost SET deleted_at = now() WHERE id = $1", [id]);
    const filter = { field: "post_id", op: "eq", value: id } as const;
    const normal = await db.resource(rs.comments).select(ctx, { include: ["post"], filter } as never);
    assert.ok(normal.length === 2 && normal.every((x) => (x as Record<string, unknown>).post === null), "обычный: удалённая запись скрыта");
    const raw = await db.resource(rs.comments).raw((c) => c.select(ctx, { include: ["post"], filter } as never));
    assert.equal(raw.length, 2);
    for (const x of raw) {
      const post = (x as Record<string, Record<string, unknown>>).post!;
      assert.equal(post.id, id);
      assert.ok(post.deleted_at, "сырой: удалённая запись видна, с меткой");
    }
    await assert.rejects(db.resource(rs.comments).raw((c) => c.select(ctx, { include: ["nope"] } as never)), (e: unknown) => e instanceof DbFailure && e.kind === "validation");
    await pg.query("UPDATE comment SET deleted_at = now() WHERE post_id = $1", [id]);
    const some = await db.resource(rs.comments).raw((c) => c.estimate(ctx, { filter }));
    assert.ok(some.rows >= 1 && ["explain", "count"].includes(some.method), JSON.stringify(some));
    await pg.exec("ANALYZE comment");
    const whole = await db.resource(rs.comments).raw((c) => c.estimate(ctx));
    assert.deepEqual([whole.rows, whole.method], [3, "reltuples"], "вся таблица, и удалённые");
    assert.equal((await db.resource(rs.comments).estimate(ctx)).rows, 1, "обычный: удалённые скрыты");
  }));

test("цепочка: выключенное у корня (without, raw) переходит на звенья", () =>
  withPg(async (pg, driver) => {
    const rs = family({ commentDelete: { ...rules, delete: () => false } });
    const { id, db } = await seedFamily(pg, driver, rs);
    await assert.rejects((await db.resource(rs.posts).chain(ctx, id)).delete(), (e: unknown) => e instanceof DbFailure && e.kind === "forbidden");
    const done = await db.resource(rs.posts).without(["policy"], async (p) => (await p.chain(ctx, id)).delete());
    assert.deepEqual(done.links.map((l) => l.count), [2, 2], "policy выключена и у комментариев");
    const other = (await pg.query<{ id: string }>("SELECT id FROM fpost WHERE deleted_at IS NULL")).rows[0]!.id;
    await db.resource(rs.posts).raw(async (p) => (await p.chain(ctx, other)).delete());
    assert.deepEqual([await count(pg, "fpost", `id = '${other}'`), await count(pg, "comment", `post_id = '${other}'`)], [0, 0], "сырой корень — всё навсегда");
  }));

/* ── ключи доступа (model-automation.md §14, §11 шаг 8) — сценарий chain-acl-keys.sim ── */

/** Записи (видимость и кто комментирует — у самой записи) и комментарии с ключами доступа. */
function board() {
  const me = (ctx: { principal: { id?: string } }) => ctx.principal.id ?? "";
  const posts: Resource = defineResource({
    key: "t.apost",
    table: "public.apost",
    primaryKey: "id",
    fields: {
      id: f.text({ ...open, orderable: true, filters: ["eq"] }),
      author_id: f.text({ ...open }),
      visibility: f.text({ ...open }),
      comment_mode: f.text({ ...open }),
    },
    policy: {
      select: (ctx) => ({ or: [{ field: "visibility", op: "eq", value: "all" }, { field: "author_id", op: "eq", value: me(ctx) }] }),
      update: (ctx) => ({ field: "author_id", op: "eq", value: me(ctx) }),
      comment: (ctx) => ({
        or: [
          { field: "comment_mode", op: "eq", value: "all" },
          { and: [{ field: "comment_mode", op: "eq", value: "author" }, { field: "author_id", op: "eq", value: me(ctx) }] },
        ],
      }),
    },
    order: [],
    timestamps: { deletedAt: "deleted_at" },
  });
  const comments: Resource = defineResource({
    key: "t.acomment",
    table: "public.acomment",
    primaryKey: "id",
    fields: {
      id: f.uuid({ ...open, orderable: true, filters: ["eq"], db: { default: "gen_random_uuid()" } }),
      post_id: f.text({ ...open, filters: ["eq", "in"], db: { references: { resource: () => posts, chain: true } } }),
      author_id: f.text({ ...open, filters: ["eq", "in"] }),
      body: f.text({ ...open, nullable: true, orderable: true, filters: ["eq"] }),
    },
    access: { author_id: owner(), post_id: link({ select: "select", insert: "comment", delete: "update" }) },
    order: [["body", "asc"]],
    timestamps: { deletedAt: "deleted_at" },
  });
  return { posts, comments };
}
const as = (id: string) => ({ principal: { id, roles: [] } });
const denied = (field?: string) => (e: unknown) => e instanceof DbFailure && e.kind === "forbidden" && (field === undefined || e.details.field === field);

test("ключи доступа: чтение — переданные ключи проверяются, без ключей — всё; вставка — все ключи; по id — один разрешающий", () =>
  withPg(async (pg, driver) => {
    const { posts, comments } = board();
    await defineSchema({ resources: [posts, comments] }).sync(driver);
    await pg.exec(`INSERT INTO apost (id, author_id, visibility, comment_mode) VALUES ('P','B','all','all'), ('P2','B','all','author'), ('H','B','author','all');
      INSERT INTO acomment (post_id, author_id, body) VALUES ('P','C','c1'), ('P','B','c2'), ('H','C','c3');`);
    const db = createDb({ driver, limits: conservativeLimits, resources: [posts, comments] });
    const api = db.resource(comments);
    const bodies = async (ctx: object, filter?: object) => (await api.select(ctx as never, filter ? { filter: filter as never } : {})).map((x) => x.body);
    // чтение
    assert.deepEqual(await bodies(as("C")), ["c1", "c2", "c3"], "без ключей — всё (ORM, а не API)");
    assert.deepEqual(await bodies(as("C"), { field: "author_id", op: "eq", value: "C" }), ["c1", "c3"], "мои");
    await assert.rejects(bodies(as("C"), { field: "author_id", op: "eq", value: "B" }), denied("author_id"), "чужие «мои»");
    assert.deepEqual(await bodies(as("C"), { field: "post_id", op: "eq", value: "P" }), ["c1", "c2"]);
    await assert.rejects(bodies(as("C"), { field: "post_id", op: "in", value: ["P", "H"] }), denied("post_id"), "H видна только автору");
    assert.deepEqual(await bodies(as("B"), { field: "post_id", op: "eq", value: "H" }), ["c3"]);
    assert.deepEqual(
      await bodies(as("C"), { and: [{ field: "post_id", op: "eq", value: "P" }, { field: "author_id", op: "eq", value: "C" }] }),
      ["c1"],
      "оба ключа — обе проверки",
    );
    assert.deepEqual(await bodies(as("C"), { not: { field: "author_id", op: "eq", value: "B" } }), ["c1", "c3"], "отрицание — не ключ");
    assert.equal(await api.count(as("C"), { filter: { field: "post_id", op: "eq", value: "P" } } as never), 2);
    await assert.rejects(api.count(as("C"), { filter: { field: "post_id", op: "eq", value: "H" } } as never), denied("post_id"));
    // вставка
    await assert.rejects(api.insert(as("C"), { post_id: "P", body: "n1" }), denied("author_id"), "без владельца");
    await assert.rejects(api.insert(as("C"), { post_id: "P", author_id: "B", body: "n2" }), denied("author_id"), "от имени другого");
    await assert.rejects(api.insert(as("C"), { author_id: "C", body: "n0" }), denied("post_id"), "без записи");
    const n3 = await api.insert(as("C"), { post_id: "P", author_id: "C", body: "n3" });
    await assert.rejects(api.insert(as("C"), { post_id: "P2", author_id: "C", body: "n4" }), denied("post_id"), "P2 комментирует только автор");
    await api.insert(as("B"), { post_id: "P2", author_id: "B", body: "n5" });
    await assert.rejects(api.insertMany(as("C"), [{ post_id: "P", author_id: "C", body: "m1" }, { post_id: "P2", author_id: "C", body: "m2" }]), denied("post_id"));
    assert.equal((await api.insertMany(as("C"), [{ post_id: "P", author_id: "C", body: "m1" }])).length, 1);
    // изменение и удаление по id: ключи из строки, достаточно одного
    const id = async (body: string) => (await pg.query<{ id: string }>("SELECT id FROM acomment WHERE body = $1", [body])).rows[0]!.id;
    await api.update(as("C"), await id("c1"), { body: "c1!" });
    await assert.rejects(api.update(as("C"), await id("c2"), { body: "x" }), (e: unknown) => e instanceof DbFailure && e.kind === "not_found", "чужой");
    await assert.rejects(api.update(as("B"), await id("c1!"), { body: "x" }), (e: unknown) => e instanceof DbFailure && e.kind === "not_found", "у post_id нет update");
    await assert.rejects(api.update(as("C"), n3.id, { post_id: "P2" }), denied("post_id"), "перенести туда, куда нельзя писать");
    assert.deepEqual((await api.canDelete(as("B"), [await id("c1!"), await id("c2")])).allowed.length, 2, "автор записи удаляет чужое");
    assert.deepEqual((await api.canDelete(as("C"), [await id("c1!"), await id("c2")])).allowed, [await id("c1!")]);
    await api.delete(as("B"), await id("c1!"));
    // цепочка: автор записи — всё, посторонний — только своё
    const plan = (who: string) => db.resource(posts).without(["policy.update"], (p) => p.chain(as(who), "P"));
    assert.deepEqual((await plan("B")).links.map((l) => [l.allowed, l.total]), [[3, 3]]);
    assert.deepEqual((await plan("C")).links.map((l) => [l.allowed, l.total]), [[2, 3]]);
    // мягко удалённая запись: «мои» видны, комментарии записи — нет
    await pg.exec("UPDATE apost SET deleted_at = now() WHERE id = 'H'");
    assert.ok((await bodies(as("C"), { field: "author_id", op: "eq", value: "C" })).includes("c3" as never));
    await assert.rejects(bodies(as("B"), { field: "post_id", op: "eq", value: "H" }), denied("post_id"));
    // without(['access']) — без ключей доступа
    assert.equal((await api.without(["access"], (c) => c.insert(as("C"), { post_id: "P2", author_id: "B", body: "w" }))).body, "w");
  }));

test("ключи доступа: ошибки объявления; owner(ops); правило, которого у цели нет; ссылка модели на себя", () =>
  withPg(async (pg, driver) => {
    const { posts } = board();
    const bad = (access: unknown, fields: Fields = {}) => () =>
      defineResource({
        key: "t.bad", table: "public.bad", primaryKey: "id",
        fields: { id: f.uuid({ ...open, orderable: true }), post_id: f.text({ ...open, db: { references: { resource: () => posts } } }), who: f.text({ ...open }), ...fields },
        access, order: [],
      } as never);
    const says = (re: RegExp) => (e: unknown) => e instanceof DbFailure && re.test(String(e.details.issues));
    assert.throws(bad({ nope: owner() }), says(/access\.nope: нет такого поля/));
    assert.throws(bad({ id: owner() }), says(/не первичный ключ/));
    assert.throws(bad({ who: link({ select: "select" }) }), says(/нужна db\.references/));
    assert.throws(bad({ post_id: link({ read: "select" } as never) }), says(/имя правила policy цели/));
    assert.throws(bad({ who: owner(["read"] as never) }), says(/owner\(ops\)/));
    assert.throws(bad({ who: { kind: "x" } }), says(/owner\(\) или link/));
    // owner только для чтения; правило цели, которого нет, — validation при использовании
    const m = defineResource({
      key: "t.own", table: "public.own", primaryKey: "id",
      fields: { id: f.uuid({ ...open, orderable: true, filters: ["eq"], db: { default: "gen_random_uuid()" } }), who: f.text({ ...open, filters: ["eq"] }), post_id: f.text({ ...open, filters: ["eq"], db: { references: { resource: () => posts } } }) },
      access: { who: owner(["select"]), post_id: link({ select: "nope" }) }, order: [],
    });
    await defineSchema({ resources: [posts, m] }).sync(driver);
    await pg.exec(`INSERT INTO apost (id, author_id, visibility, comment_mode) VALUES ('P','B','all','all'); INSERT INTO own (who, post_id) VALUES ('C','P')`);
    const db = createDb({ driver, limits: conservativeLimits });
    assert.equal((await db.resource(m).select(as("C"), { filter: { field: "who", op: "eq", value: "C" } })).length, 1);
    await assert.rejects(db.resource(m).insert(as("C"), { who: "C", post_id: "P" }), denied("who"), "owner без insert");
    const row = (await pg.query<{ id: string }>("SELECT id FROM own")).rows[0]!.id;
    await assert.rejects(db.resource(m).delete(as("C"), row), (e: unknown) => e instanceof DbFailure && e.kind === "not_found", "ни один ключ не разрешает delete");
    await assert.rejects(db.resource(m).select(as("C"), { filter: { field: "post_id", op: "eq", value: "P" } }), says(/нет правила policy\.nope/));
    // ссылка на себя: подзапрос цели под своим именем, внешняя колонка не перекрыта
    const tree: Resource = defineResource({
      key: "t.atree", table: "public.atree", primaryKey: "id",
      fields: { id: f.text({ ...open, orderable: true, filters: ["eq"] }), parent_id: f.text({ ...open, nullable: true, db: { references: { resource: () => tree } } }), who: f.text({ ...open, filters: ["eq"] }) },
      policy: { update: (ctx) => ({ field: "who", op: "eq", value: ctx.principal.id ?? "" }) },
      access: { parent_id: link({ delete: "update" }) }, order: [],
    });
    await defineSchema({ resources: [posts, m, tree] }).sync(driver);
    await pg.exec(`INSERT INTO atree VALUES ('r', NULL, 'A'), ('k', 'r', 'C')`);
    await assert.rejects(db.resource(tree).delete(as("C"), "k"), (e: unknown) => e instanceof DbFailure && e.kind === "not_found", "решает строка-родитель, а не сама строка");
    await db.resource(tree).delete(as("A"), "k");
  }));

/* ── Ошибки полей: все сразу, с кодом и своим текстом; ограничения БД — к полю ── */
test("ошибки полей: все плохие поля сразу, коды и параметры как у правил формы, свой текст поля", async () => {
  const r = post({
    rank: field(s.integer({ min: 1, max: 5 }), { ...open, create: () => true, required: true }),
    slug: field(s.text({ max: 10 }), {
      ...open, create: () => true, required: true,
      messages: { maxLength: "Слаг — не длиннее {max}" },
    }),
  });
  const db = createDb({ driver: { query: async () => ({ rows: [] }) } as unknown as Driver, limits: conservativeLimits });
  const err = await db.resource(r).insert(ctx, { title: "ab", rank: 9, slug: "x".repeat(11) }).catch((e: unknown) => e);
  assert.ok(err instanceof DbFailure && err.kind === "validation");
  const byField = Object.fromEntries((err.details.errors ?? []).map((x) => [x.field, x]));
  assert.deepEqual(Object.keys(byField).sort(), ["rank", "slug", "title"]);
  assert.equal(byField.title!.code, "minLength");
  assert.deepEqual(byField.title!.params, { min: 3 });
  assert.equal(byField.title!.template, undefined, "без своего текста — шаблона нет, текст даст словарь");
  assert.equal(byField.rank!.code, "maxValue");
  assert.deepEqual(byField.rank!.params, { max: 5 });
  assert.equal(byField.slug!.message, "Слаг — не длиннее 10");
  assert.equal(byField.slug!.template, "Слаг — не длиннее {max}");
  // прежний вид для старого кода: поле и тексты первого поля
  assert.equal(typeof err.details.field, "string");
  // отсутствующее обязательное поле — тоже ошибка поля, а не голое «Invalid input»
  const missing = await db.resource(r).insert(ctx, { title: "abc", rank: 1 }).catch((e: unknown) => e);
  assert.ok(missing instanceof DbFailure);
  assert.deepEqual(missing.details.errors?.map((x) => [x.field, x.code]), [["slug", "required"]]);
  // Standard Schema issues для формы и публичное тело API (без template)
  const { failureIssues } = await import("../index");
  const issues = failureIssues(err)!;
  assert.ok(issues.some((i) => i.path?.[0] === "slug" && i.code === "maxLength" && i.template === "Слаг — не длиннее {max}"));
  assert.equal(failureIssues(new DbFailure("forbidden")), null);
  const body = toKitError(err).body;
  assert.equal(body.errors?.length, 3);
  assert.equal(JSON.stringify(body).includes("template"), false);
});

test("ошибки полей: уникальный индекс из модели → ошибка поля `unique` (свой текст); составной — общая; чужое поле — без поля", () =>
  withPg(async (pg, driver) => {
    const r = post(
      {
        email: field(s.text({ max: 254 }), {
          ...open, create: () => true, update: () => true, required: true,
          db: { unique: true }, messages: { unique: "Этот email уже зарегистрирован" },
        }),
        a: field(s.text(), { ...open, create: () => true, nullable: true }),
        b: field(s.text(), { ...open, create: () => true, nullable: true }),
      },
      { db: { unique: [["a", "b"]] } },
    );
    await defineSchema({ resources: [r] }).sync(driver);
    const db = createDb({ driver, limits: conservativeLimits });
    await db.resource(r).insert(ctx, { title: "first", email: "a@x.ru", a: "1", b: "2" });

    const dup = await db.resource(r).insert(ctx, { title: "second", email: "a@x.ru" }).catch((e: unknown) => e);
    assert.ok(dup instanceof DbFailure && dup.kind === "conflict");
    assert.deepEqual(dup.details.errors, [
      { field: "email", code: "unique", message: "Этот email уже зарегистрирован", template: "Этот email уже зарегистрирован" },
    ]);
    assert.equal(toKitError(dup).status, 409);

    const pair = await db.resource(r).insert(ctx, { title: "third", email: "b@x.ru", a: "1", b: "2" }).catch((e: unknown) => e);
    assert.ok(pair instanceof DbFailure && pair.kind === "conflict");
    assert.deepEqual(pair.details.errors?.map((x) => [x.field, x.code, x.params]), [[undefined, "unique", { fields: ["a", "b"] }]]);

    // insertMany: та же привязка к полю (строка пачки не называется)
    const many = await db.resource(r).insertMany(ctx, [
      { title: "fourth", email: "c@x.ru", a: null, b: null },
      { title: "fifth", email: "a@x.ru", a: null, b: null },
    ]).catch((e: unknown) => e);
    assert.ok(many instanceof DbFailure && many.kind === "conflict");
    assert.deepEqual(many.details.errors?.map((x) => [x.field, x.code]), [["email", "unique"]]);

    // поле, которое этот ctx не пишет (значение пришло не от него), — без привязки к полю
    const sealed = post({
      email: field(s.text(), { ...open, required: true, createValue: () => "a@x.ru", db: { unique: true } }),
    });
    await pg.exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await defineSchema({ resources: [sealed] }).sync(driver);
    await db.resource(sealed).insert(ctx, { title: "one" });
    const hidden = await db.resource(sealed).insert(ctx, { title: "two" }).catch((e: unknown) => e);
    assert.ok(hidden instanceof DbFailure && hidden.kind === "conflict");
    assert.equal(hidden.details.errors, undefined);
  }));

test("ошибки полей: коды zod переводятся в коды правил форм; свой текст refine — свой текст поля", async () => {
  const r = post({
    name: field(z.string().min(2).max(5), { ...open, create: () => true, required: true }),
    age: field(z.number().int().min(18), { ...open, create: () => true, required: true, db: { type: "integer" } }),
    tags: field(z.array(z.string()).min(1), { ...open, create: () => true, required: true, db: { type: "text[]" } }),
    mail: field(z.email(), { ...open, create: () => true, required: true, db: { type: "text" } }),
    kind: field(z.enum(["a", "b"]), { ...open, create: () => true, required: true, db: { type: "text" } }),
    step: field(z.number().multipleOf(5), { ...open, create: () => true, required: true, db: { type: "integer" } }),
    over: field(z.number().gt(3), { ...open, create: () => true, required: true, db: { type: "integer" } }),
    own: field(z.string().refine((v) => v === "ok", "Только ok"), { ...open, create: () => true, required: true, db: { type: "text" } }),
  });
  const db = createDb({ driver: { query: async () => ({ rows: [] }) } as unknown as Driver, limits: conservativeLimits });
  const err = await db.resource(r).insert(ctx, {
    title: "abc", name: "x", age: 17.5, tags: [], mail: "x", kind: "c", step: 3, over: 3, own: "no",
  }).catch((e: unknown) => e);
  assert.ok(err instanceof DbFailure && err.kind === "validation");
  const got = Object.fromEntries((err.details.errors ?? []).map((x) => [x.field, [x.code, x.params, x.template]]));
  assert.deepEqual(got.name, ["minLength", { min: 2 }, undefined]);
  assert.equal(got.age![0], "integer");
  assert.deepEqual(got.tags, ["minCount", { min: 1 }, undefined]);
  assert.equal(got.mail![0], "email");
  assert.equal(got.kind![0], "oneOf");
  assert.deepEqual(got.step, ["step", { step: 5 }, undefined]);
  assert.equal(got.over![0], "invalid", "строгая граница gt не выдаётся за «не меньше»");
  assert.deepEqual(got.own, ["custom", undefined, "Только ok"]);
});

/* ── Решения человека по конфликтам (шаг 4) и внешние ключи ─────────────── */

test("sync resolve: переименование сохраняет данные, gate снова пропускает запросы", () =>
  withPg(async (pg, driver) => {
    await defineSchema({ resources: [post({ name: field(s.text(), { ...open, nullable: true }) })] }).sync(driver);
    await pg.query("INSERT INTO post (title, name) VALUES ('Запись', 'Иван')");
    const next = defineSchema({ resources: [post({ label: field(s.text(), { ...open, nullable: true }) })] });
    const gated = await next.gate(driver);
    const db = createDb({ driver: gated, limits: conservativeLimits });
    await assert.rejects(db.resource(post()).select(ctx), (e: unknown) => e instanceof DbFailure && e.kind === "schema_pending");

    const pending = await next.sync(driver);
    const step = pending.conflicts[0]!;
    assert.deepEqual(choices(step), ["rename", "replace"]);
    const done = await next.sync(driver, { resolve: { [stepKey(step)]: "rename" } });
    assert.deepEqual([done.status, kinds(done.resolved)], ["ok", ["rename_or_replace:label"]]);
    assert.deepEqual((await pg.query("SELECT label FROM post")).rows, [{ label: "Иван" }]);
    assert.equal((await db.resource(post()).select(ctx)).length, 1);
  }));

test("sync resolve: «удалить и добавить» убирает старую колонку; обязательная новая на данных — снова конфликт", () =>
  withPg(async (pg, driver) => {
    await defineSchema({ resources: [post({ name: field(s.text(), { ...open, nullable: true }) })] }).sync(driver);
    await pg.query("INSERT INTO post (title, name) VALUES ('Запись', 'Иван')");
    const soft = defineSchema({ resources: [post({ label: field(s.text(), { ...open, nullable: true }) })] });
    const key = stepKey((await soft.sync(driver)).conflicts[0]!);
    const done = await soft.sync(driver, { resolve: { [key]: "replace" } });
    assert.deepEqual([done.status, kinds(done.applied)], ["ok", ["add_column:label"]]);
    assert.deepEqual((await pg.query("SELECT label FROM post")).rows, [{ label: null }]);
    assert.deepEqual((await columns(pg)).map((c) => c.name), ["id", "title", "created_at", "label"]);

    await defineSchema({ resources: [post({ name: field(s.text(), { ...open, nullable: true }) })] }).sync(driver, {
      resolve: { [stepKey({ level: "conflict", kind: "rename_or_replace", table: '"public"."post"', column: "name", sql: [] })]: "rename" },
    });
    const hard = defineSchema({ resources: [post({ label: f.text({ ...open }) })] });
    const k2 = stepKey((await hard.sync(driver)).conflicts[0]!);
    const still = await hard.sync(driver, { resolve: { [k2]: "replace" } });
    assert.deepEqual([still.status, kinds(still.conflicts)], ["pending", ["add_required_column:label"]]);
  }));

test("sync resolve: неподходящее решение и устаревший шаг — отказ, ничего не применено", () =>
  withPg(async (pg, driver) => {
    const nullable = post({ note: field(s.text(), { ...open, nullable: true }) });
    await defineSchema({ resources: [nullable] }).sync(driver);
    await pg.query("INSERT INTO post (title, note) VALUES ('С заметкой', '42')");
    const typed = defineSchema({ resources: [post({ note: f.integer({ ...open, nullable: true }) })] });
    const step = (await typed.sync(driver)).conflicts[0]!;
    await assert.rejects(typed.sync(driver, { resolve: { [stepKey(step)]: "rename" } }), (e: unknown) =>
      e instanceof DbFailure && e.kind === "validation");
    await assert.rejects(typed.sync(driver, { resolve: { "change_type:\"public\".\"post\":nope": "apply" } }), (e: unknown) =>
      e instanceof DbFailure && e.kind === "conflict");
    assert.equal((await columns(pg)).find((c) => c.name === "note")!.type, "text");
    // смена типа по решению: данные приведены
    const done = await typed.sync(driver, { resolve: { [stepKey(step)]: "apply" } });
    assert.deepEqual([done.status, kinds(done.resolved)], ["ok", ["change_type:note"]]);
    assert.deepEqual((await pg.query("SELECT note FROM post")).rows, [{ note: 42 }]);
  }));

test("sync: внешний ключ из db.references — после всех таблиц, NOT VALID для старых строк, снимается вместе с моделью", () =>
  withPg(async (pg, driver) => {
    const author = defineResource({
      key: "t.author",
      table: "public.author",
      primaryKey: "id",
      fields: {
        id: f.uuid({ ...open, orderable: true, filters: ["eq"], db: { default: "gen_random_uuid()" } }),
        name: field(s.text({ min: 1, max: 80 }), { ...open, create: () => true, required: true }),
      },
      policy: rules,
      order: [["id", "asc"]],
    } as Resource);
    const plain = post({ author_id: f.uuid({ ...open, nullable: true }) });
    await defineSchema({ resources: [plain, author] }).sync(driver);
    await pg.query("INSERT INTO post (title, author_id) VALUES ('Сирота', gen_random_uuid())");

    const linked = post({
      author_id: f.uuid({ ...open, nullable: true, db: { references: { resource: () => author, onDelete: "restrict" } } }),
    });
    // ссылающаяся таблица раньше цели — порядок ресурсов не важен
    const report = await defineSchema({ resources: [linked, author] }).sync(driver);
    assert.deepEqual([report.status, kinds(report.applied)], ["ok", ["add_foreign:author_id"]]);
    const fk = async () =>
      (await pg.query<{ name: string; def: string }>(
        "SELECT conname AS name, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'post'::regclass AND contype = 'f'",
      )).rows;
    const [made] = await fk();
    assert.match(made!.name, /^post_fk_[0-9a-f]{8}$/);
    assert.match(made!.def, /REFERENCES author\(id\) ON DELETE RESTRICT NOT VALID/);
    await assert.rejects(pg.query("INSERT INTO post (title, author_id) VALUES ('Новая', gen_random_uuid())"), /foreign key/);
    const [{ id }] = (await pg.query<{ id: string }>("INSERT INTO author (name) VALUES ('Аня') RETURNING id")).rows;
    await pg.query("INSERT INTO post (title, author_id) VALUES ('Своя', $1)", [id]);
    await assert.rejects(pg.query("DELETE FROM author"), /foreign key/, "на автора ссылаются — база отказывает");

    // на пустой БД: CREATE TABLE обеих, внешний ключ последним
    await pg.exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    const fresh = await defineSchema({ resources: [linked, author] }).sync(driver);
    assert.equal(fresh.applied.at(-1)!.kind, "add_foreign");

    const dropped = await defineSchema({ resources: [plain, author] }).sync(driver);
    assert.deepEqual(kinds(dropped.applied), ["drop_foreign"]);
    assert.deepEqual(await fk(), []);
  }));

test("ошибки полей: нарушенный внешний ключ — `reference` у поля при записи, `referenced` (общая) при удалении", () =>
  withPg(async (pg, driver) => {
    const author = defineResource({
      key: "t.author",
      table: "public.author",
      primaryKey: "id",
      fields: {
        id: f.uuid({ ...open, orderable: true, filters: ["eq"], db: { default: "gen_random_uuid()" } }),
        name: field(s.text({ min: 1, max: 80 }), { ...open, create: () => true, required: true }),
      },
      policy: rules,
      order: [["id", "asc"]],
    } as Resource);
    const linked = post({
      author_id: f.uuid({
        ...open, create: () => true, update: () => true, nullable: true,
        db: { references: { resource: () => author } }, messages: { reference: "Автор не найден" },
      }),
    });
    await defineSchema({ resources: [linked, author] }).sync(driver);
    const db = createDb({ driver, limits: conservativeLimits });

    // запись со ссылкой на несуществующего автора — ошибка поля, а не «такая запись уже есть»
    const missing = await db.resource(linked).insert(ctx, { title: "без автора", author_id: crypto.randomUUID() }).catch((e: unknown) => e);
    assert.ok(missing instanceof DbFailure && missing.kind === "conflict");
    assert.deepEqual(missing.details.errors?.map((x) => [x.field, x.code, x.message]), [["author_id", "reference", "Автор не найден"]]);
    assert.equal(toKitError(missing).status, 409);
    const a = await db.resource(author).insert(ctx, { name: "Аня" });
    const row = await db.resource(linked).insert(ctx, { title: "с автором", author_id: a.id });
    const moved = await db.resource(linked).update(ctx, String(row.id), { author_id: crypto.randomUUID() }).catch((e: unknown) => e);
    assert.deepEqual((moved as DbFailure).details.errors?.map((x) => [x.field, x.code]), [["author_id", "reference"]]);

    // удаление автора, на которого ссылаются (no action) — общая ошибка `referenced`
    const held = await db.resource(author).delete(ctx, String(a.id)).catch((e: unknown) => e);
    assert.ok(held instanceof DbFailure && held.kind === "conflict");
    assert.deepEqual(held.details.errors?.map((x) => [x.field, x.code]), [[undefined, "referenced"]]);
    assert.deepEqual((await pg.query("SELECT count(*)::int AS n FROM author")).rows, [{ n: 1 }]);
  }));

test("defineResource: db.references проверяется при объявлении", () => {
  const bad = (references: unknown, nullable = true) => () =>
    post({ x: f.uuid({ ...open, nullable, db: { references } as never }) });
  const says = (re: RegExp) => (e: unknown) =>
    e instanceof DbFailure && (e.details.issues ?? []).some((x) => re.test(x));
  assert.throws(bad({ resource: "author" }), says(/db\.references/));
  assert.throws(bad({ resource: () => post(), onDelete: "drop" }), says(/onDelete/));
  assert.throws(bad({ resource: () => post(), onDelete: "set null" }), says(/«set null» убран — связанные записи удаляет цепочка/));
  assert.throws(bad({ resource: () => post(), onDelete: "cascade" }), says(/«cascade» убран/));
  assert.throws(bad({ resource: () => post(), chain: "да" }), says(/chain: boolean/));
  return Promise.resolve();
});
