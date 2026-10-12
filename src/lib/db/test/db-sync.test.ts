/**
 * Схема из моделей (`#lib/db/sync/index.js`) и правила мягкого удаления детей.
 * Каждая проверка — на своём PGlite в памяти: это настоящий PostgreSQL, поэтому
 * `pg_catalog`, `format_type`, advisory-блокировка и DDL в транзакции — те же, что на сервере.
 */
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { z } from "zod";
import { afterAll, it } from "vitest";
import { createDb, defineResource, f, field, policy, s, DbFailure, conservativeLimits } from "../index";
import { pgliteAdapter } from "../adapters/pglite";
import { toKitError } from "../sveltekit/index";
import { defineSchema } from "../sync/index";
import type { Driver, Fields, Resource, SoftDeleteChild } from "../index";

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

test("sync: zod-поле без db.type — понятная ошибка; драйвер без транзакций — unsupported", () =>
  withPg(async (_pg, driver) => {
    const zodPost = post({ tag: field(z.string(), { ...open, nullable: true }) });
    await assert.rejects(defineSchema({ resources: [zodPost] }).sync(driver), (e: unknown) =>
      e instanceof DbFailure && e.kind === "validation" && /db: \{ type/.test(String(e.details.issues)),
    );
    const typed = post({ tag: field(z.string(), { ...open, nullable: true, db: { type: "varchar(20)" } }) });
    assert.equal((await defineSchema({ resources: [typed] }).sync(driver)).status, "ok");
    assert.equal((await defineSchema({ resources: [typed] }).sync(driver)).applied.length, 0);
    const http: Driver = { ...driver, capabilities: { ...driver.capabilities, transactions: false } };
    await assert.rejects(defineSchema({ resources: [typed] }).sync(http), (e: unknown) => e instanceof DbFailure && e.kind === "unsupported");
  }));

/* ── мягкое удаление: что модель велит делать с детьми ─────────────────── */

function family(onComments: SoftDeleteChild["onDelete"], onVotes: SoftDeleteChild["onDelete"] = "cascade") {
  const soft = (extra: Partial<Resource["softDelete"]> = {}) => ({
    field: "deleted_at",
    value: () => new Date().toISOString(),
    readDeleted: () => true,
    ...extra,
  });
  const base = (key: string, table: string, fields: Fields, children?: () => readonly SoftDeleteChild[]) =>
    defineResource({
      key,
      table,
      primaryKey: "id",
      fields: {
        id: f.uuid({ ...open, orderable: true, filters: ["eq"], db: { default: "gen_random_uuid()" } }),
        deleted_at: f.timestamp({ ...open, nullable: true }),
        ...fields,
      },
      policy: rules,
      order: [],
      softDelete: soft(children ? { children } : {}),
    } as Resource);
  const votes = base("t.vote", "public.vote", { comment_id: f.uuid({ ...open }) });
  const comments = base("t.comment", "public.comment", { post_id: f.uuid({ ...open }) }, () => [
    { resource: votes, field: "comment_id", onDelete: onVotes },
  ]);
  const posts = base("t.fpost", "public.fpost", { title: f.text({ ...open, create: () => true }) }, () => [
    { resource: comments, field: "post_id", onDelete: onComments },
  ]);
  return { posts, comments, votes };
}
async function seedFamily(pg: PGlite, driver: Driver, rs: ReturnType<typeof family>) {
  await defineSchema({ resources: [rs.posts, rs.comments, rs.votes] }).sync(driver);
  const id = (await pg.query<{ id: string }>("INSERT INTO fpost (title) VALUES ('p') RETURNING id")).rows[0]!.id;
  const other = (await pg.query<{ id: string }>("INSERT INTO fpost (title) VALUES ('q') RETURNING id")).rows[0]!.id;
  const c = (await pg.query<{ id: string }>("INSERT INTO comment (post_id) VALUES ($1), ($1), ($2) RETURNING id", [id, other])).rows;
  await pg.query("INSERT INTO vote (comment_id) VALUES ($1), ($2), ($3)", [c[0]!.id, c[1]!.id, c[2]!.id]);
  return { id, db: createDb({ driver, limits: conservativeLimits }) };
}
const live = async (pg: PGlite, table: string) =>
  (await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE deleted_at IS NULL`)).rows[0]!.n;

test("softDelete.children: cascade помечает детей и внуков, restrict откатывает удаление родителя", () =>
  withPg(async (pg, driver) => {
    const cascade = family("cascade");
    const { id, db } = await seedFamily(pg, driver, cascade);
    await db.resource(cascade.posts).delete(ctx, id);
    // у второй записи всё осталось: один комментарий и один голос
    assert.deepEqual([await live(pg, "fpost"), await live(pg, "comment"), await live(pg, "vote")], [1, 1, 1]);
  }).then(() =>
    withPg(async (pg2, driver2) => {
      const restrict = family("cascade", "restrict");
      const seeded = await seedFamily(pg2, driver2, restrict);
      await assert.rejects(seeded.db.resource(restrict.posts).delete(ctx, seeded.id), (e: unknown) =>
        e instanceof DbFailure && e.kind === "conflict" && e.details.constraint === "t.comment->t.vote",
      );
      // откат целиком: и запись, и её комментарии живы
      assert.deepEqual([await live(pg2, "fpost"), await live(pg2, "comment"), await live(pg2, "vote")], [2, 3, 3]);
      await pg2.query("UPDATE vote SET deleted_at = now()");
      await seeded.db.resource(restrict.posts).delete(ctx, seeded.id);
      assert.deepEqual([await live(pg2, "fpost"), await live(pg2, "comment")], [1, 1]);
    }),
  ));

test("softDelete.children: cascade без softDelete у ребёнка — validation; цикл — unsupported", () =>
  withPg(async (pg, driver) => {
    const hard = defineResource({
      key: "t.hard",
      table: "public.hard",
      primaryKey: "id",
      fields: { id: f.uuid({ ...open, orderable: true, filters: ["eq"] }), post_id: f.uuid({ ...open }) },
      policy: rules,
      order: [],
    } as Resource);
    const parent = post(
      { deleted_at: f.timestamp({ ...open, nullable: true }) },
      {
        softDelete: {
          field: "deleted_at",
          value: () => new Date().toISOString(),
          readDeleted: () => true,
          children: () => [{ resource: hard, field: "post_id", onDelete: "cascade" }],
        },
      },
    );
    await defineSchema({ resources: [parent, hard] }).sync(driver);
    const id = (await pg.query<{ id: string }>("INSERT INTO post (title) VALUES ('abc') RETURNING id")).rows[0]!.id;
    const db = createDb({ driver, limits: conservativeLimits });
    await assert.rejects(db.resource(parent).delete(ctx, id), (e: unknown) =>
      e instanceof DbFailure && e.kind === "validation" && /cascade требует softDelete/.test(String(e.details.issues)),
    );
    assert.equal(await live(pg, "post"), 1);

    // дерево комментариев: ребёнок того же ресурса — каскад по кругу
    const tree: Resource = defineResource({
      key: "t.tree",
      table: "public.tree",
      primaryKey: "id",
      fields: {
        id: f.uuid({ ...open, orderable: true, filters: ["eq"], db: { default: "gen_random_uuid()" } }),
        parent_id: f.uuid({ ...open, nullable: true }),
        deleted_at: f.timestamp({ ...open, nullable: true }),
      },
      policy: rules,
      order: [],
      softDelete: {
        field: "deleted_at",
        value: () => new Date().toISOString(),
        readDeleted: () => true,
        children: () => [{ resource: tree, field: "parent_id", onDelete: "cascade" }],
      },
    } as Resource);
    await defineSchema({ resources: [tree] }).sync(driver);
    const root = (await pg.query<{ id: string }>("INSERT INTO tree DEFAULT VALUES RETURNING id")).rows[0]!.id;
    await assert.rejects(db.resource(tree).delete(ctx, root), (e: unknown) => e instanceof DbFailure && e.kind === "unsupported");
    assert.equal(await live(pg, "tree"), 1);
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
