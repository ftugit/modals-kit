/**
 * Правила один раз (docs/design/db-form-validation-answers.md): `checks` в модели,
 * `validator` для форм без записи, метка проверки, тип/CHECK из Standard JSON Schema,
 * `fill` и `store` у поля. Своя схема поля здесь — заглушка со счётчиком вызовов: так
 * видно, выполнялась ли проверка второй раз. Настоящую пару «модель → форма»
 * (`formParams`, `pick`) проверяет `src/routes/(site)/(app)/db-demo/form-db.test.ts`.
 */
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, it } from "vitest";
import { createDb, defineResource, f, field, policy, s, DbFailure, conservativeLimits, failureIssues, liveCapabilities } from "../index";
import type { CheckEvent, Database, Fields, Resource, StandardSchema } from "../index";
import { pgliteAdapter } from "../adapters/pglite";
import { defineSchema } from "../sync/index";
import { tableSpec } from "../sync/model";
import { VALIDATED_PROOF, readProof, sameValue } from "../proof";
import { rule } from "../rules";

const test = (name: string, fn: () => Promise<void>) => it(name, fn, 30_000);

let shared: PGlite | undefined;
afterAll(async () => {
  await shared?.close();
});
async function withDb(resources: Resource[], fn: (db: Database, pg: PGlite) => Promise<void>) {
  shared ??= new PGlite();
  await shared.exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  const driver = pgliteAdapter(shared);
  assert.equal((await defineSchema({ resources }).sync(driver)).status, "ok");
  await fn(createDb({ driver, limits: conservativeLimits, resources }), shared);
}
const ctx = { principal: { roles: [] as string[] } };
const rules = { select: policy.publicRows(), insert: () => true, update: policy.publicRows(), delete: policy.publicRows() };
const rw = { read: () => true, create: () => true, update: () => true } as const;

/** Схема «строка 3–120» со счётчиком вызовов и JSON Schema, как у поля формы. */
function countedText() {
  const schema = {
    calls: 0,
    "~standard": {
      version: 1 as const,
      vendor: "test",
      validate(v: unknown) {
        schema.calls++;
        if (typeof v !== "string") return { issues: [{ message: "Expected string", code: "invalid" }] };
        if (v.length < 3) return { issues: [{ message: "Too short", code: "minLength", params: { min: 3 } }] };
        if (v.length > 120) return { issues: [{ message: "Too long", code: "maxLength", params: { max: 120 } }] };
        return { value: v };
      },
      jsonSchema: {
        input: () => ({ type: "string", minLength: 3, maxLength: 120 }),
        output: () => ({ type: "string", minLength: 3, maxLength: 120 }),
      },
    },
  };
  return schema;
}

function posts(title: ReturnType<typeof countedText>, more: Partial<Resource> = {}, extra: Fields = {}) {
  return defineResource({
    key: "t.rules.post",
    table: "public.rules_post",
    primaryKey: "id",
    fields: {
      id: f.uuid({ read: () => true, createValue: () => crypto.randomUUID(), immutable: true, orderable: true, filters: ["eq"] }),
      title: field(title as unknown as StandardSchema<string>, {
        ...rw,
        required: true,
        normalize: (v) => (typeof v === "string" ? v.trim() : v),
        filters: ["eq"],
      }),
      slug: f.text({ ...rw, nullable: true, filters: ["eq"] }),
      ...extra,
    },
    policy: rules,
    order: [["id", "asc"]],
    ...more,
  });
}
const stamp = <T extends object>(values: T, fields: Record<string, { schema: object; value: unknown }>): T =>
  Object.defineProperty(values, VALIDATED_PROOF, { value: { fields }, enumerable: false });

/* ── маски полей и правила строк по умолчанию (model-automation.md §9, §11 шаг 2) ── */

test("маски: нет ключа или null — всем, [] — никому; policy без ключа или null — без ограничения", () => {
  const open = defineResource({
    key: "t.rules.open",
    table: "public.rules_open",
    primaryKey: "id",
    fields: {
      id: f.uuid({ createValue: () => crypto.randomUUID(), orderable: true, filters: ["eq"] }),
      title: f.text({ required: true }),
      note: f.text({ nullable: true, read: null, create: null, update: null }),
      secret: f.text({ nullable: true, read: [], create: [], update: [] }),
      admin: f.text({ nullable: true, create: ["admin"], update: ["admin"] }),
    },
    order: [["id", "asc"]],
  });
  const nullPolicy = defineResource({
    key: "t.rules.nullpolicy",
    table: "public.rules_nullpolicy",
    primaryKey: "id",
    fields: { id: f.uuid({ createValue: () => crypto.randomUUID(), orderable: true, filters: ["eq"] }), title: f.text({}) },
    policy: null as never,
    hooks: null as never,
    order: [["id", "asc"]],
  });
  const forbidden = (e: unknown) => e instanceof DbFailure && e.kind === "forbidden";
  return withDb([open, nullPolicy], async (db) => {
    const api = db.resource(open);
    const row = await api.insert(ctx, { title: "a", note: "n" });
    assert.deepEqual(Object.keys(row).sort(), ["admin", "id", "note", "title"], "secret не читается: read: []");
    await assert.rejects(api.insert(ctx, { title: "b", secret: "x" }), forbidden);
    await assert.rejects(api.insert(ctx, { title: "b", admin: "x" }), forbidden);
    await api.insert({ principal: { roles: ["admin"] } }, { title: "b", admin: "x" });
    await assert.rejects(api.update(ctx, row.id, { secret: "x" }), forbidden);
    await assert.rejects(api.insert(ctx, { id: crypto.randomUUID(), title: "c" }), forbidden, "системное поле — не по маске");
    assert.equal((await api.update(ctx, row.id, { note: "m" })).note, "m");
    assert.equal((await api.select(ctx)).length, 2, "нет policy — видны все");
    await api.delete(ctx, row.id);
    const other = db.resource(nullPolicy);
    const x = await other.insert(ctx, { title: "z" });
    assert.equal((await other.update(ctx, x.id, { title: "y" })).title, "y");
    await other.delete(ctx, x.id);
    assert.equal(await other.count(ctx), 0);
  });
});

test("policy: правило без ключа — без ограничения только для этой операции; restore без своего — как delete, без обоих — всем", async () => {
  const half = defineResource({
    key: "t.rules.half",
    table: "public.rules_half",
    primaryKey: "id",
    fields: { id: f.uuid({ createValue: () => crypto.randomUUID(), orderable: true, filters: ["eq"] }), title: f.text({}) },
    policy: { insert: () => false, delete: () => ({ field: "title", op: "eq", value: "можно" }) },
    order: [["id", "asc"]],
    timestamps: { deletedAt: { field: "deleted_at", readDeleted: [] as string[] } },
  });
  const forbidden = (e: unknown) => e instanceof DbFailure && e.kind === "forbidden";
  await withDb([half], async (db, pg) => {
    const api = db.resource(half);
    await assert.rejects(api.insert(ctx, { title: "можно" }), forbidden);
    await pg.exec("INSERT INTO public.rules_half (id, title) VALUES (gen_random_uuid(), 'можно'), (gen_random_uuid(), 'нельзя')");
    const rows = await api.select(ctx, { order: [["id", "asc"]] });
    assert.equal(rows.length, 2, "select без правила — все");
    const no = rows.find((r) => r.title === "нельзя")!;
    await assert.rejects(api.delete(ctx, no.id), (e: unknown) => e instanceof DbFailure && e.kind === "not_found");
    assert.equal((await api.update(ctx, no.id, { title: "x" })).title, "x", "update без правила — можно");
  });
  assert.deepEqual(rule(half, "restore", ctx), { field: "title", op: "eq", value: "можно" }, "restore — как delete");
  assert.equal(rule({ ...half, policy: {} } as Resource, "restore", ctx), true);
  assert.equal(rule({ ...half, policy: { restore: () => false } } as Resource, "restore", ctx), false);
});

/* ── договорённость о метке (копия типа в lib/form: src/lib/form/proof.test.ts) ── */

test("метка: ключ Symbol.for('modals-kit.validated-proof.v1'), форма { fields: { поле: { schema, value } } }", async () => {
  assert.equal(VALIDATED_PROOF, Symbol.for("modals-kit.validated-proof.v1"));
  const schema = {};
  const values = stamp({ title: "abc" }, { title: { schema, value: "abc" } });
  assert.equal(readProof(values)?.fields.title?.schema, schema);
  assert.deepEqual(Object.keys(values), ["title"]);
  assert.equal(readProof({ ...values }), undefined, "копия метку не несёт");
  assert.equal(readProof(JSON.parse(JSON.stringify(values))), undefined);
  assert.equal(readProof(Object.defineProperty({}, VALIDATED_PROOF, { value: "мусор" })), undefined);
});

test("метка: значения сравниваются по содержимому только для строк, чисел, булевых и их массивов", async () => {
  assert.ok(sameValue("a", "a"));
  assert.ok(sameValue(null, null));
  assert.ok(!sameValue(0, -0));
  assert.ok(sameValue(["a", 1, true], ["a", 1, true]));
  assert.ok(!sameValue(["a"], ["a", "b"]));
  assert.ok(!sameValue([{}], [{}]), "объект внутри — не сравниваем, проверка заново");
  const o = { a: 1 };
  assert.ok(!sameValue(o, o));
});

/* ── метка в записи ──────────────────────────────────────────────────── */

test("метка: та же схема и то же значение — правила схемы не выполняются второй раз", () => {
  const title = countedText();
  const r = posts(title);
  return withDb([r], async (db) => {
    const api = db.resource(r);
    await api.insert(ctx, stamp({ title: "Заметка" }, { title: { schema: title, value: "Заметка" } }));
    assert.equal(title.calls, 0);
    // без метки — проверка
    await api.insert(ctx, { title: "Вторая" });
    assert.equal(title.calls, 1);
    // normalize изменил значение (обрезал пробелы) — метка не совпала, проверка заново
    await api.insert(ctx, stamp({ title: "  Третья " }, { title: { schema: title, value: "  Третья " } }));
    assert.equal(title.calls, 2);
    // метка другой схемы — проверка
    await api.insert(ctx, stamp({ title: "Четвёртая" }, { title: { schema: countedText(), value: "Четвёртая" } }));
    assert.equal(title.calls, 3);
    // метка с другим значением — проверка и честный отказ
    await assert.rejects(
      api.insert(ctx, stamp({ title: "ab" }, { title: { schema: title, value: "abc" } })),
      (e: unknown) => e instanceof DbFailure && e.kind === "validation" && failureIssues(e)?.[0]?.code === "minLength",
    );
    assert.equal(title.calls, 4);
  });
});

test("метка не обходит CHECK: подделанное значение отклоняет PostgreSQL", () => {
  const title = countedText();
  const r = posts(title);
  return withDb([r], async (db) => {
    await assert.rejects(
      db.resource(r).insert(ctx, stamp({ title: "ab" }, { title: { schema: title, value: "ab" } })),
      (e: unknown) => e instanceof DbFailure && e.kind === "validation" && failureIssues(e)?.[0]?.code === "check",
    );
    assert.equal(title.calls, 0, "проверку схемы пропустили по метке — остановил CHECK из JSON Schema");
  });
});

/* ── тип и CHECK из Standard JSON Schema ─────────────────────────────── */

test("JSON Schema поля даёт тот же тип и тот же CHECK (то же имя), что s.text({ min, max })", async () => {
  const fromJson = await tableSpec(posts(countedText()));
  const viaS = posts(countedText());
  const fromS = await tableSpec(
    defineResource({ ...viaS, fields: { ...viaS.fields, title: field(s.text({ min: 3, max: 120 }), { ...rw, required: true }) } }),
  );
  assert.equal(fromJson.columns.find((c) => c.field === "title")?.type, "text");
  const check = (spec: typeof fromJson) => spec.objects.find((o) => o.kind === "check");
  assert.equal(check(fromJson)?.sql, `char_length("title") BETWEEN 3 AND 120`);
  assert.deepEqual(check(fromJson), check(fromS), "развёрнутая БД не увидит изменения схемы");
});

test("JSON Schema: числа, набор значений, массив строк, отказ схемы описать себя", async () => {
  const js = (j: Record<string, unknown> | (() => never)) =>
    ({
      "~standard": {
        version: 1,
        vendor: "test",
        validate: (v: unknown) => ({ value: v }),
        jsonSchema: { input: typeof j === "function" ? j : () => j, output: typeof j === "function" ? j : () => j },
      },
    }) as unknown as StandardSchema<unknown>;
  const r = defineResource({
    key: "t.rules.kinds",
    table: "public.rules_kinds",
    primaryKey: "id",
    fields: {
      id: f.uuid({ read: () => true, orderable: true }),
      age: field(js({ type: ["integer", "null"], minimum: 18, maximum: 120 }), { read: () => true, nullable: true }),
      score: field(js({ type: "number", maximum: 5 }), { read: () => true }),
      kind: field(js({ type: "string", enum: ["a", "b"] }), { read: () => true }),
      tags: field(js({ type: "array", items: { type: "string" } }), { read: () => true }),
      day: field(js({ type: "string", format: "date" }), { read: () => true }),
      odd: field(js(() => { throw new Error("нельзя"); }), { read: () => true, db: { type: "jsonb" } }),
    },
    policy: rules,
    order: [["id", "asc"]],
  });
  const spec = await tableSpec(r);
  const type = (k: string) => spec.columns.find((c) => c.field === k)?.type;
  assert.deepEqual(
    ["age", "score", "kind", "tags", "day", "odd"].map(type),
    ["integer", "double precision", "text", "text[]", "date", "jsonb"],
  );
  const checks = spec.objects.filter((o) => o.kind === "check").map((o) => o.sql).sort();
  assert.deepEqual(checks, [`"age" BETWEEN 18 AND 120`, `"kind" IN ('a', 'b')`, `"score" <= 5`]);
});

/* ── checks: правила данных при записи ───────────────────────────────── */

test("checks: выполняются в транзакции записи, после полей и beforeWrite; нарушение — ошибка поля", () => {
  const seen: CheckEvent[] = [];
  const title = countedText();
  const r = posts(title, {
    hooks: {
      beforeWrite: ({ draft }) => {
        if (draft && typeof draft.title === "string" && draft.slug === undefined)
          draft.slug = draft.title.toLowerCase();
      },
    },
    checks: async ({ db, values, operation, before, ctx: c }) => {
      seen.push({ db, values, operation, before, ctx: c });
      assert.equal(db.driver.inTransaction, true, "checks — внутри транзакции записи");
      const taken = await db.query({ text: "SELECT 1 FROM public.rules_post WHERE slug = $1", values: [values.slug] });
      return taken.rows.length ? [{ field: "slug", code: "unique" }] : [];
    },
  });
  return withDb([r], async (db) => {
    const api = db.resource(r);
    const row = await api.insert(ctx, { title: "Заметка" });
    assert.equal(seen[0]?.operation, "insert");
    assert.equal(seen[0]?.values.slug, "заметка", "checks видят черновик после beforeWrite");
    assert.ok(Object.isFrozen(seen[0]?.values), "снимок только для чтения");
    await assert.rejects(api.insert(ctx, { title: "Заметка" }), (e: unknown) => {
      const issues = failureIssues(e);
      return e instanceof DbFailure && e.kind === "validation" && issues?.[0]?.code === "unique" && issues[0].path?.[0] === "slug";
    });
    await api.update(ctx, row.id, { title: "Другая" });
    assert.equal(seen.at(-1)?.operation, "update");
    assert.equal(seen.at(-1)?.before?.title, "Заметка", "у update правило видит строку до изменения");
    assert.equal((await api.select(ctx)).length, 1, "отказ правила ничего не записал");
  });
});

test("checks: свой текст, messages поля, ошибка всей записи; insertMany отказывает; не функция — ошибка описания", () => {
  const r = posts(
    countedText(),
    {
      checks: ({ values }) =>
        values.title === "Свой текст"
          ? [{ field: "title", code: "custom", message: "Заголовок {what} занят", params: { what: "этот" } }]
          : values.title === "Текст поля"
            ? [{ field: "slug", code: "unique" }]
            : values.title === "Целиком"
              ? [{ code: "duplicate" }]
              : undefined,
    },
    { slug: f.text({ ...rw, nullable: true, messages: { unique: "Адрес уже занят" } }) },
  );
  return withDb([r], async (db) => {
    const api = db.resource(r);
    const issues = async (title: string) => {
      try {
        await api.insert(ctx, { title });
      } catch (e) {
        return failureIssues(e);
      }
      return null;
    };
    assert.deepEqual(await issues("Свой текст"), [
      { message: "Заголовок этот занят", code: "custom", path: ["title"], params: { what: "этот" }, template: "Заголовок {what} занят" },
    ]);
    assert.deepEqual(await issues("Текст поля"), [
      { message: "Адрес уже занят", code: "unique", path: ["slug"], template: "Адрес уже занят" },
    ]);
    assert.deepEqual(await issues("Целиком"), [{ message: "duplicate", code: "duplicate" }]);
    await assert.rejects(api.insertMany(ctx, [{ title: "Пакет" }]), (e: unknown) => e instanceof DbFailure && e.kind === "unsupported");
  }).then(() =>
    assert.throws(
      () => posts(countedText(), { checks: "нет" as never }),
      (e: unknown) => e instanceof DbFailure && /checks: обязан быть функцией/.test(String(e.details.issues)),
    ),
  );
});

/* ── validator: проверка без записи для форм, которые ничего не пишут ── */

test("validator('check'): только значения из входа и checks; чужие ключи формы пропускаются; ничего не пишет", () => {
  const title = countedText();
  const r = posts(title, {
    checks: async ({ db, values, operation }) => {
      if (operation !== "check") return [];
      const found = await db.query({ text: "SELECT 1 FROM public.rules_post WHERE title = $1", values: [values.title] });
      return found.rows.length ? [] : [{ field: "title", code: "not_found", message: "Нет такой записи" }];
    },
  });
  return withDb([r], async (db) => {
    const api = db.resource(r);
    await api.insert(ctx, { title: "Есть" });
    const schema = api.validator(ctx, "check");
    assert.deepEqual(await schema["~standard"].validate({ title: "Есть", remember: "on" }), { value: { title: "Есть" } });
    assert.deepEqual(await schema["~standard"].validate({ title: "Нету" }), {
      issues: [{ message: "Нет такой записи", code: "not_found", path: ["title"], template: "Нет такой записи" }],
    });
    const short = await schema["~standard"].validate({ title: "ab" });
    assert.equal(short.issues?.[0]?.path?.[0], "title");
    assert.equal((short.issues?.[0] as { code?: string }).code, "minLength", "сначала поля, checks — поверх годных значений");
    assert.deepEqual(await schema["~standard"].validate("строка"), { issues: [{ message: "Invalid input", code: "invalid" }] });
    assert.equal((await api.select(ctx)).length, 1, "validator ничего не пишет");
  });
});

test("validator('insert'): обязательные поля и права как у записи; метка тоже понимается", () => {
  const title = countedText();
  const r = posts(title);
  return withDb([r], async (db) => {
    const api = db.resource(r);
    const insert = api.validator(ctx, "insert");
    const missing = await insert["~standard"].validate({ slug: "x" });
    assert.deepEqual(missing.issues?.map((i) => [(i as { code?: string }).code, i.path?.[0]]), [["required", "title"]]);
    await assert.rejects(Promise.resolve(insert["~standard"].validate({ title: "Заметка", id: "x" })), (e: unknown) =>
      e instanceof DbFailure && e.kind === "forbidden",
    );
    const calls = title.calls;
    await insert["~standard"].validate(stamp({ title: "Заметка" }, { title: { schema: title, value: "Заметка" } }));
    assert.equal(title.calls, calls);
    assert.throws(() => api.validator(ctx, "delete" as never), (e: unknown) => e instanceof DbFailure && e.kind === "validation");
  });
});

test("fill: заполняет непереданное из проверенных значений; переданное побеждает; результат проходит правила", () => {
  const calls: { values: unknown; operation: string }[] = [];
  const slug = (max: number) =>
    field(s.text({ max }), {
      create: [],
      nullable: true,
      filters: ["eq"],
      fill: (values, _c, operation) => {
        calls.push({ values, operation });
        if (operation === "update") return values.title === undefined ? undefined : `u-${String(values.title).toLowerCase()}`;
        return String(values.title).toLowerCase().replace(/\s+/g, "-");
      },
    });
  const r = posts(countedText(), {}, { slug: slug(80) });
  return withDb([r], async (db) => {
    const api = db.resource(r);
    const row = await api.insert(ctx, { title: "  Первая Заметка " });
    assert.equal(row.slug, "первая-заметка", "fill видит значение после normalize и правил");
    assert.ok(Object.isFrozen(calls[0]?.values), "fill получает снимок только для чтения");
    // маска create: [] — передать нельзя никому: заполняет только fill
    await assert.rejects(api.insert(ctx, { title: "Вторая", slug: "своё" }), (e: unknown) => e instanceof DbFailure && e.kind === "forbidden");
    const n = calls.length;
    await assert.rejects(api.insert(ctx, { title: "ab" }), (e: unknown) => failureIssues(e)?.map((i) => i.path?.[0]).join() === "title");
    assert.equal(calls.length, n, "при ошибке переданных полей fill не вызывается");
    await api.update(ctx, row.id, { title: "Новая" });
    assert.equal((await api.select(ctx)).find((x) => x.id === row.id)?.slug, "u-новая");
    assert.equal(calls.at(-1)?.operation, "update", "при update fill узнаёт операцию и видит только переданное");
  });
});

test("fill: переданное значение побеждает; ошибка результата — ошибка поля; хук не меняет заполненное", () => {
  const r = posts(
    countedText(),
    { hooks: { beforeWrite: ({ draft }) => { if (draft && draft.title === "Хук") draft.slug = "подмена"; } } },
    { slug: field(s.text({ max: 5 }), { ...rw, nullable: true, filters: ["eq"], fill: (v) => String(v.title).toLowerCase() }) },
  );
  return withDb([r], async (db) => {
    const api = db.resource(r);
    assert.equal((await api.insert(ctx, { title: "Длинный заголовок", slug: "own" })).slug, "own", "переданное — как есть, fill не трогает");
    await assert.rejects(api.insert(ctx, { title: "Длинный заголовок" }), (e: unknown) => {
      const i = failureIssues(e)?.[0];
      return i?.path?.[0] === "slug" && (i as { code?: string }).code === "maxLength";
    });
    await assert.rejects(api.insert(ctx, { title: "Хук" }), (e: unknown) => e instanceof DbFailure && e.kind === "forbidden");
    const required = posts(countedText(), {}, { slug: f.text({ ...rw, required: true, filters: ["eq"], fill: () => "auto" }) });
    const v = await db.resource(required).validator(ctx, "insert")["~standard"].validate({ title: "Заметка" });
    assert.equal(v.issues, undefined, "validator: обязательное поле с fill не требуется во входе");
  });
});

test("store: после правил (правила видят вход), результат в колонке; null не трогает; метка не мешает", () => {
  const secret = countedText();
  const r = posts(countedText(), {}, {
    secret: field(secret as unknown as StandardSchema<string>, {
      read: () => true,
      create: () => true,
      update: () => true,
      nullable: true,
      store: async (v) => "h:" + [...String(v)].reverse().join(""),
      db: { type: "text" },
    }),
  });
  return withDb([r], async (db, pg) => {
    const api = db.resource(r);
    const row = await api.insert(ctx, { title: "Заметка", secret: "пароль12" });
    assert.equal(row.secret, "h:21ьлорап");
    await assert.rejects(api.insert(ctx, { title: "Заметка", secret: "ab" }), (e: unknown) => failureIssues(e)?.[0]?.path?.[0] === "secret");
    assert.equal((await api.insert(ctx, { title: "Заметка", secret: null })).secret, null);
    const calls = secret.calls;
    const proven = await api.insert(ctx, stamp({ title: "Заметка", secret: "пароль12" }, { secret: { schema: secret, value: "пароль12" } }));
    assert.equal(secret.calls, calls, "метка снимает повтор правил");
    assert.equal(proven.secret, "h:21ьлорап", "store выполняется и с меткой");
    await api.update(ctx, row.id, { secret: "новый123" });
    const stored = await pg.query<{ secret: string }>("SELECT secret FROM public.rules_post WHERE id = $1", [row.id]);
    assert.equal(stored.rows[0]?.secret, "h:321йывон");
  });
});

test("store: описание требует db.type, CHECK из правил не строится; fill + createValue — ошибка описания", async () => {
  const shape = (extra: Fields) => () => posts(countedText(), {}, extra);
  const has = (re: RegExp) => (e: unknown) => e instanceof DbFailure && (e.details.issues ?? []).some((x) => re.test(String(x)));
  assert.throws(shape({ pin: field(s.text({ min: 4 }), { ...rw, store: (v) => v }) }), has(/store без db\.type/));
  assert.throws(shape({ pin: f.text({ ...rw, fill: () => "x", createValue: () => "y" }) }), has(/fill \+ createValue/));
  assert.throws(shape({ pin: f.text({ ...rw, fill: "x" as never }) }), has(/fill: обязан быть функцией/));
  const r = posts(countedText(), {}, { pin: field(s.text({ min: 4, max: 6 }), { ...rw, nullable: true, store: (v) => v, db: { type: "text" } }) });
  const spec = await tableSpec(r);
  assert.equal(spec.objects.filter((o) => o.kind === "check" && o.columns.includes("pin")).length, 0);
});

/* ── системные поля времени (`timestamps`) ─────────────────────────────── */

function stamped(more: Partial<Resource> & { timestamps?: unknown } = {}) {
  return defineResource({
    key: "t.rules.stamped",
    table: "public.rules_stamped",
    primaryKey: "id",
    fields: {
      id: f.uuid({ read: () => true, createValue: () => crypto.randomUUID(), immutable: true, orderable: true, filters: ["eq"] }),
      title: f.text({ ...rw, required: true }),
    },
    policy: rules,
    order: [["created_at", "desc"]],
    timestamps: { createdAt: "created_at", updatedAt: "updated_at", deletedAt: "deleted_at" },
    ...(more as object),
  } as Parameters<typeof defineResource>[0]);
}
const tsIssues = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return ((e as DbFailure).details.issues as string[] | undefined)?.join(" | ") ?? String(e);
  }
  return "";
};

test("timestamps: поля, DEFAULT базы и индексы под опрос создаются из модели", () => {
  const r = stamped();
  assert.deepEqual(Object.keys(r.fields), ["id", "title", "created_at", "updated_at", "deleted_at"]);
  for (const k of ["created_at", "updated_at", "deleted_at"]) {
    const fl = r.fields[k as keyof typeof r.fields] as import("../index").Field;
    assert.ok(fl.generated && fl.immutable && fl.orderable, k);
    assert.deepEqual(fl.filters, ["gt", "gte", "lt", "lte"]);
  }
  assert.equal(r.softDelete?.field, "deleted_at");
  assert.deepEqual(r.db?.indexes, [["updated_at", "id"]]);
  return withDb([r], async (_db, pg) => {
    const cols = await pg.query<{ column_name: string; column_default: string | null; is_nullable: string }>(
      "SELECT column_name, column_default, is_nullable FROM information_schema.columns WHERE table_name = 'rules_stamped' ORDER BY column_name",
    );
    const by = Object.fromEntries(cols.rows.map((c) => [c.column_name, c]));
    assert.equal(by.created_at.column_default, "clock_timestamp()");
    assert.equal(by.updated_at.column_default, "clock_timestamp()");
    assert.equal(by.deleted_at.column_default, null);
    assert.equal(by.deleted_at.is_nullable, "YES");
    const idx = await pg.query<{ indexdef: string }>("SELECT indexdef FROM pg_indexes WHERE tablename = 'rules_stamped'");
    const defs = idx.rows.map((x) => x.indexdef).join("\n");
    // изменённые — среди живых строк; удалённые — среди удалённых (частичный по живым был бы пуст)
    assert.match(defs, /\(updated_at, id\) WHERE \(deleted_at IS NULL\)/);
    assert.match(defs, /\(deleted_at, id\) WHERE \(deleted_at IS NOT NULL\)/);
  });
});

test("timestamps: время ставит база; клиент его не пишет; update двигает updated_at", () => {
  const r = stamped();
  return withDb([r], async (db) => {
    const api = db.resource(r);
    const row = (await api.insert(ctx, { title: "Первая" })) as Record<string, string | null>;
    assert.ok(row.created_at && row.updated_at, "обе метки из базы");
    assert.equal(row.deleted_at, null);
    await assert.rejects(api.insert(ctx, { title: "x", created_at: "2000-01-01T00:00:00Z" }), (e: unknown) => e instanceof DbFailure && e.kind === "forbidden");
    await assert.rejects(api.update(ctx, row.id, { updated_at: "2000-01-01T00:00:00Z" }), (e: unknown) => e instanceof DbFailure && e.kind === "forbidden");
    const next = (await api.update(ctx, row.id, { title: "Правка" })) as Record<string, string>;
    assert.ok(Date.parse(next.updated_at) > Date.parse(row.updated_at), `${next.updated_at} > ${row.updated_at}`);
    assert.equal(next.created_at, row.created_at, "created_at не меняется");
  });
});

test("timestamps: мягкое удаление скрывает строку; удалённые не видит и не восстанавливает никто по умолчанию", () => {
  const r = stamped();
  return withDb([r], async (db) => {
    const api = db.resource(r);
    const row = (await api.insert(ctx, { title: "Удаляемая" })) as Record<string, string>;
    const gone = (await api.delete(ctx, row.id)) as Record<string, string | null>;
    assert.ok(gone.deleted_at, "метку поставила база");
    assert.equal((await api.select(ctx)).length, 0);
    assert.equal(await api.count(ctx), 0);
    await assert.rejects(api.get(ctx, row.id), (e: unknown) => e instanceof DbFailure && e.kind === "not_found");
    await assert.rejects(api.select(ctx, { includeDeleted: true }), (e: unknown) => e instanceof DbFailure && e.kind === "forbidden");
    await assert.rejects(api.restore(ctx, row.id), (e: unknown) => e instanceof DbFailure && e.kind === "forbidden");
    await assert.rejects(api.delete(ctx, row.id), (e: unknown) => e instanceof DbFailure && e.kind === "not_found", "второй раз не удаляется");
  });
});

test("timestamps: readDeleted открывает удалённые и restore; restore снимает метку и двигает updated_at", () => {
  const r = stamped({
    timestamps: { createdAt: "created_at", updatedAt: "updated_at", deletedAt: { field: "deleted_at", readDeleted: ["admin"] } },
  });
  const admin = { principal: { roles: ["admin"] } };
  return withDb([r], async (db) => {
    const api = db.resource(r);
    const row = (await api.insert(ctx, { title: "Вернётся" })) as Record<string, string>;
    const live = (await api.insert(ctx, { title: "Живая" })) as Record<string, string>;
    const gone = (await api.delete(ctx, row.id)) as Record<string, string>;
    assert.equal((await api.select(admin, { includeDeleted: true })).length, 2);
    await assert.rejects(api.restore(ctx, row.id), (e: unknown) => e instanceof DbFailure && e.kind === "forbidden");
    await assert.rejects(api.restore(admin, live.id), (e: unknown) => e instanceof DbFailure && e.kind === "not_found", "не удалена — нечего восстанавливать");
    const back = (await api.restore(admin, row.id)) as Record<string, string | null>;
    assert.equal(back.deleted_at, null);
    assert.ok(Date.parse(back.updated_at!) > Date.parse(gone.updated_at), "восстановление — изменение для опроса");
    assert.equal((await api.select(ctx)).length, 2);
  });
});

test("timestamps: политика restore сужает восстановление; без мягкого удаления restore — unsupported", () => {
  const r = stamped({
    timestamps: { createdAt: "created_at", deletedAt: { field: "deleted_at", readDeleted: ["admin"] } },
    policy: { ...rules, restore: () => ({ field: "title", op: "eq", value: "можно" }) },
  });
  const plain = defineResource({
    key: "t.rules.plain",
    table: "public.rules_plain",
    primaryKey: "id",
    fields: { id: f.uuid({ read: () => true, createValue: () => crypto.randomUUID(), immutable: true, orderable: true, filters: ["eq"] }) },
    policy: rules,
    order: [["id", "asc"]],
  });
  const admin = { principal: { roles: ["admin"] } };
  return withDb([r, plain], async (db) => {
    const api = db.resource(r);
    const yes = (await api.insert(ctx, { title: "можно" })) as Record<string, string>;
    const no = (await api.insert(ctx, { title: "нельзя" })) as Record<string, string>;
    await api.delete(ctx, yes.id);
    await api.delete(ctx, no.id);
    await assert.rejects(api.restore(admin, no.id), (e: unknown) => e instanceof DbFailure && e.kind === "not_found");
    assert.equal(((await api.restore(admin, yes.id)) as Record<string, unknown>).deleted_at, null);
    await assert.rejects(db.resource(plain).restore(admin, "00000000-0000-4000-8000-000000000000"), (e: unknown) => e instanceof DbFailure && e.kind === "unsupported");
  });
});

test("timestamps: ошибки объявления — поле и в fields, вместе с softDelete, неизвестный ключ", async () => {
  const dup = tsIssues(() =>
    stamped({
      fields: {
        id: f.uuid({ read: () => true, orderable: true, filters: ["eq"] }),
        created_at: f.timestamp({ read: () => true, orderable: true }),
      },
    }),
  );
  assert.match(dup, /поле «created_at» объявлено и в fields/);
  const both = tsIssues(() =>
    stamped({ softDelete: { field: "title", value: () => "x", readDeleted: [] } }),
  );
  assert.match(both, /timestamps\.deletedAt и softDelete вместе/);
  assert.match(tsIssues(() => stamped({ timestamps: { createdOn: "x" } as never })), /timestamps\.createdOn: неизвестный ключ/);
  assert.match(tsIssues(() => stamped({ timestamps: { createdAt: "same", updatedAt: "same" } })), /уже занято/);
});

test("timestamps: null, '' и отсутствие ключа — метка выключена", async () => {
  const keys = (r: Resource) => Object.keys(r.fields).filter((k) => k.endsWith("_at"));
  const t = (timestamps: unknown) => stamped({ order: [["id", "asc"]], timestamps } as never) as unknown as Resource;
  assert.deepEqual(keys(t({ createdAt: "created_at", updatedAt: null, deletedAt: "" })), ["created_at"]);
  assert.deepEqual(keys(t({ createdAt: "", updatedAt: undefined, deletedAt: { field: "" } })), []);
  assert.deepEqual(keys(t({ deletedAt: { field: null, readDeleted: ["admin"] } })), []);
  for (const v of [null, {}, { createdAt: null }]) {
    const r = t(v);
    assert.equal(r.timestamps, undefined, JSON.stringify(v));
    assert.equal(r.softDelete, undefined);
    assert.deepEqual(liveCapabilities(r), { inserted: true, updated: false, deleted: false });
  }
  const del = t({ deletedAt: null, updatedAt: "updated_at" });
  assert.equal(del.softDelete, undefined, "без deletedAt удаление — настоящее");
  assert.deepEqual(del.timestamps, { updatedAt: "updated_at" });
  assert.match(tsIssues(() => t({ createdAt: 5 })), /timestamps\.createdAt: имя поля/);
});

test("timestamps: liveCapabilities выводит, что опрашивать", async () => {
  assert.deepEqual(liveCapabilities(stamped()), { inserted: true, updated: true, deleted: true });
  assert.deepEqual(liveCapabilities(stamped({ timestamps: { createdAt: "created_at" } })), { inserted: true, updated: false, deleted: false });
  assert.deepEqual(liveCapabilities(stamped({ timestamps: { createdAt: "created_at", updatedAt: "updated_at" } })), { inserted: true, updated: true, deleted: false });
});

test("timestamps: цепочка ставит детям время базы; children — заменено цепочкой (ошибка объявления)", () => {
  const parent = stamped({ timestamps: { createdAt: "created_at", deletedAt: "deleted_at" } });
  const child: Resource = defineResource({
    key: "t.rules.child",
    table: "public.rules_child",
    primaryKey: "id",
    fields: {
      id: f.uuid({ read: () => true, createValue: () => crypto.randomUUID(), immutable: true, orderable: true, filters: ["eq"] }),
      parent_id: f.uuid({ ...rw, required: true, filters: ["eq"], db: { references: { resource: () => parent, chain: true } } }),
    },
    policy: rules,
    order: [["id", "asc"]],
    timestamps: { deletedAt: "deleted_at" },
  });
  assert.match(tsIssues(() => stamped({ timestamps: { deletedAt: { field: "deleted_at", children: () => [] } } as never })), /children: заменено цепочкой/);
  return withDb([parent, child], async (db, pg) => {
    const p = (await db.resource(parent).insert(ctx, { title: "Родитель" })) as Record<string, string>;
    await db.resource(child).insert(ctx, { parent_id: p.id });
    await (await db.resource(parent).chain(ctx, p.id)).delete();
    const rows = await pg.query<{ deleted_at: Date | null }>("SELECT deleted_at FROM public.rules_child");
    assert.ok(rows.rows[0].deleted_at instanceof Date, "ребёнок помечен");
  });
});

/* ── without и behavior (model-automation.md §5, §8, §11 шаг 3) ───────── */

function hidden(more: Record<string, unknown> = {}) {
  return defineResource({
    key: "t.rules.hidden",
    table: "public.rules_hidden",
    primaryKey: "id",
    fields: {
      id: f.uuid({ createValue: () => crypto.randomUUID(), orderable: true, filters: ["eq"] }),
      title: f.text({ required: true, filters: ["eq"] }),
      secret: f.text({ nullable: true, read: [], db: { type: "text" }, store: (v) => `hash:${String(v)}` }),
    },
    policy: { select: () => ({ field: "title", op: "eq", value: "видно" }) },
    order: [["created_at", "asc"]],
    timestamps: { createdAt: "created_at", updatedAt: "updated_at", deletedAt: "deleted_at" },
    ...more,
  } as Parameters<typeof defineResource>[0]) as unknown as Resource;
}

test("without: клон без updatedAt не двигает метку и её не знает; исходная модель двигает", () => {
  const r = hidden();
  return withDb([r], async (db, pg) => {
    const api = db.resource(r);
    const row = (await api.insert(ctx, { title: "видно" })) as Record<string, string>;
    const quiet = await api.without(["timestamps.updatedAt"], async (m) => {
      assert.deepEqual(m.behavior().off, ["timestamps.updatedAt"]);
      assert.deepEqual(m.behavior().live, { inserted: true, updated: false, deleted: true });
      return (await m.update(ctx, row.id, { title: "видно" })) as Record<string, unknown>;
    });
    assert.equal(quiet.updated_at, undefined, "клон поля не знает");
    const db1 = await pg.query<{ u: string }>("SELECT updated_at::text AS u FROM public.rules_hidden");
    assert.equal(Date.parse(db1.rows[0].u.replace(" ", "T").replace(/\+00$/, "Z")), Date.parse(row.updated_at));
    const loud = (await api.update(ctx, row.id, { title: "видно" })) as Record<string, string>;
    assert.ok(Date.parse(loud.updated_at) > Date.parse(row.updated_at));
    assert.deepEqual(api.behavior().off, []);
    assert.deepEqual(api.behavior().timestamps, { createdAt: "created_at", updatedAt: "updated_at", deletedAt: "deleted_at" });
  });
});

test("without: policy и grants — только в колбэке; параллельный код права не теряет; вложенный складывает", () => {
  const r = hidden();
  return withDb([r], async (db) => {
    const api = db.resource(r);
    await api.insert(ctx, { title: "видно", secret: "s" });
    await api.insert(ctx, { title: "скрыто" });
    const [inside, outside] = await Promise.all([
      api.without(["policy"], (m) => m.select(ctx)),
      api.select(ctx),
    ]);
    assert.equal(inside.length, 2);
    assert.equal(outside.length, 1, "соседний запрос видит правила");
    await api.without(["policy"], async (m) => {
      assert.equal((await m.select(ctx))[0]!.secret, undefined, "маски полей на месте");
      await m.without(["grants"], async (m2) => {
        assert.deepEqual(m2.behavior().off, ["policy", "grants"]);
        const rows = await m2.select(ctx, { filter: { field: "title", op: "eq", value: "видно" } });
        assert.equal(rows[0]!.secret, "hash:s");
      });
    });
  });
});

test("without: deletedAt — удаление навсегда и видны удалённые; store и hooks выключаются; в транзакции", () => {
  const seen: string[] = [];
  const r = hidden({ policy: undefined, hooks: { beforeWrite: () => void seen.push("before") } });
  return withDb([r], async (db, pg) => {
    const api = db.resource(r);
    const a = (await api.insert(ctx, { title: "a", secret: "x" })) as Record<string, string>;
    const b = (await api.insert(ctx, { title: "b" })) as Record<string, string>;
    assert.deepEqual(seen, ["before", "before"]);
    await api.delete(ctx, a.id);
    await api.without(["timestamps.deletedAt"], async (m) => {
      assert.equal((await m.select(ctx)).length, 2, "удалённая видна: поля метки у клона нет");
      await m.delete(ctx, b.id);
    });
    assert.equal((await pg.query("SELECT 1 FROM public.rules_hidden")).rows.length, 1, "b стёрта навсегда");
    const calls = seen.length;
    await api.without(["fields.*.store", "hooks"], (m) => m.insert(ctx, { title: "c", secret: "готовый-хэш" }));
    assert.equal(seen.length, calls, "хуки клона выключены");
    const raw = await pg.query<{ secret: string }>("SELECT secret FROM public.rules_hidden WHERE title = 'c'");
    assert.equal(raw.rows[0].secret, "готовый-хэш");
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.resource(r).without(["hooks"], (m) => m.insert(ctx, { title: "d" }));
        throw new Error("откат");
      }),
    );
    assert.equal((await pg.query("SELECT 1 FROM public.rules_hidden WHERE title = 'd'")).rows.length, 0, "клон пишет в ту же транзакцию");
  });
});

test("without: путь, которого нет у модели, неизвестный путь и пустой список — validation", async () => {
  const r = hidden({ policy: undefined });
  await withDb([r], async (db) => {
    const api = db.resource(r);
    const issues = async (paths: string[]) => {
      const e = await api.without(paths, () => 1).catch((x: unknown) => x);
      assert.ok(e instanceof DbFailure && e.kind === "validation", String(e));
      return ((e as DbFailure).details.issues as string[]).join(" | ");
    };
    assert.match(await issues(["policy"]), /нет policy/);
    assert.match(await issues(["softDelete"]), /нет softDelete/);
    assert.match(await issues(["fields.*.fill"]), /нет полей с fill/);
    assert.match(await issues(["fields.title.color"]), /неизвестный путь/);
    assert.match(await issues(["timestamps.deletedAt.children"]), /неизвестный путь/);
    assert.match(await issues([]), /непустой список/);
    assert.equal(await api.without(["protect", "fields.secret.store"], (m) => m.behavior().off.join()), "protect,fields.secret.store");
  });
});

test("protect: системные поля можно передать, остальная автоматика работает; без protect — forbidden", () => {
  const r = hidden({ policy: undefined });
  const forbidden = (e: unknown) => e instanceof DbFailure && e.kind === "forbidden";
  return withDb([r], async (db) => {
    const api = db.resource(r);
    const id = "00000000-0000-4000-8000-000000000001";
    await assert.rejects(api.insert(ctx, { id, title: "x" }), forbidden);
    const row = (await api.without(["protect"], (m) =>
      m.insert(ctx, { id, title: "перенос", created_at: "2020-01-01T00:00:00.000000Z", secret: "p" }),
    )) as Record<string, string>;
    assert.equal(row.id, id, "свой id");
    assert.equal(row.created_at, "2020-01-01T00:00:00.000000Z", "своя дата");
    assert.ok(Date.parse(row.updated_at) > Date.parse("2024-01-01"), "непереданное — DEFAULT базы");
    const fresh = (await api.without(["protect"], (m) => m.insert(ctx, { title: "без id" }))) as Record<string, string>;
    assert.match(fresh.id, /^[0-9a-f-]{36}$/, "не передали — createValue");
    const moved = (await api.without(["protect"], (m) => m.update(ctx, id, { created_at: "2019-01-01T00:00:00.000000Z" }))) as Record<string, string>;
    assert.equal(moved.created_at, "2019-01-01T00:00:00.000000Z");
    assert.ok(Date.parse(moved.updated_at) > Date.parse(row.updated_at), "updated_at двигается, если его не передали");
    const fixed = (await api.without(["protect"], (m) => m.update(ctx, id, { title: "т", updated_at: "2021-01-01T00:00:00.000000Z" }))) as Record<string, string>;
    assert.equal(fixed.updated_at, "2021-01-01T00:00:00.000000Z", "передали updated_at — сдвига нет");
    await assert.rejects(api.without(["protect"], (m) => m.insert(ctx, { title: "x", created_at: "не дата" })), (e: unknown) => e instanceof DbFailure && e.kind === "validation");
    await assert.rejects(api.update(ctx, id, { created_at: "2018-01-01T00:00:00Z" }), forbidden, "исходная модель защищена");
  });
});

test("raw: запись как есть (свой id, даты, хэш), без хуков и updated_at; чтение — все строки и поля", () => {
  const seen: string[] = [];
  const r = hidden({ hooks: { beforeWrite: () => void seen.push("w"), afterRead: () => void seen.push("r") } });
  return withDb([r], async (db, pg) => {
    const api = db.resource(r);
    const id = "00000000-0000-4000-8000-000000000002";
    const row = (await api.raw((m) => m.insert(ctx, { id, title: "x", created_at: "2020-01-01T00:00:00Z", updated_at: "2020-01-02T00:00:00Z", deleted_at: "2020-01-03T00:00:00Z", secret: "готовый" }))) as Record<string, string>;
    assert.equal(row.id, id);
    assert.equal(row.secret, "готовый", "store не вызывается, маска read не действует");
    assert.equal(row.deleted_at, "2020-01-03T00:00:00.000000Z");
    await api.raw(async (m) => {
      assert.equal(m.behavior().raw, true);
      assert.equal((await m.select(ctx)).length, 1, "удалённая и скрытая политикой — видна");
      assert.equal(await m.count(ctx, { filter: { field: "secret", op: "eq", value: "готовый" } }), 1, "фильтр по любому полю");
      const up = (await m.update(ctx, id, { title: "y" })) as Record<string, string>;
      assert.equal(up.updated_at, "2020-01-02T00:00:00.000000Z", "updated_at не двигается");
      await assert.rejects(m.insert(ctx, { nope: 1 }), (e: unknown) => e instanceof DbFailure && e.kind === "validation");
      await assert.rejects(m.cursor(ctx), (e: unknown) => e instanceof DbFailure && e.kind === "unsupported");
      await assert.rejects(m.without(["policy"], () => 1), (e: unknown) => e instanceof DbFailure && e.kind === "validation");
      await m.delete(ctx, id);
    });
    assert.deepEqual(seen, [], "хуков нет ни при записи, ни при чтении");
    assert.equal((await pg.query("SELECT 1 FROM public.rules_hidden")).rows.length, 0, "delete — настоящий DELETE");
    await assert.rejects(api.raw((m) => m.insert(ctx, { id: "не uuid", title: "z" })), (e: unknown) => e instanceof DbFailure, "проверяет сам Postgres");
  });
});

test("delete({ hard }): навсегда при мягком удалении; удалённую достаёт только readDeleted; canDelete — без удаления", () => {
  const r = hidden({
    policy: { delete: () => ({ field: "title", op: "ne", value: "чужая" }) },
    timestamps: { createdAt: "created_at", deletedAt: { field: "deleted_at", readDeleted: ["admin"] } },
  });
  const admin = { principal: { roles: ["admin"] } };
  return withDb([r], async (db, pg) => {
    const api = db.resource(r);
    const a = (await api.insert(ctx, { title: "a" })) as Record<string, string>;
    const b = (await api.insert(ctx, { title: "b" })) as Record<string, string>;
    const other = (await api.insert(ctx, { title: "чужая" })) as Record<string, string>;
    const missing = "00000000-0000-4000-8000-0000000000ff";
    assert.deepEqual(await api.canDelete(ctx, [a.id, other.id, missing, a.id]), { allowed: [a.id], soft: true });
    assert.equal((await pg.query("SELECT 1 FROM public.rules_hidden")).rows.length, 3, "canDelete ничего не удалил");
    await api.delete(ctx, a.id, { hard: true });
    assert.equal((await pg.query(`SELECT 1 FROM public.rules_hidden WHERE id = '${a.id}'`)).rows.length, 0, "стёрта");
    await api.delete(ctx, b.id);
    await assert.rejects(api.delete(ctx, b.id, { hard: true }), (e: unknown) => e instanceof DbFailure && e.kind === "not_found", "удалённую не видит");
    await api.delete(admin, b.id, { hard: true });
    assert.equal((await pg.query(`SELECT 1 FROM public.rules_hidden WHERE id = '${b.id}'`)).rows.length, 0, "readDeleted стёр удалённую");
    await assert.rejects(api.delete(ctx, other.id, { hard: true }), (e: unknown) => e instanceof DbFailure && e.kind === "not_found", "правило delete действует");
    await assert.rejects(api.delete(ctx, other.id, { force: true } as never), (e: unknown) => e instanceof DbFailure && e.kind === "validation", "прежнее имя");
    await assert.rejects(api.delete(ctx, other.id, { hard: "да" } as never), (e: unknown) => e instanceof DbFailure && e.kind === "validation");
    await assert.rejects(api.canDelete(ctx, []), (e: unknown) => e instanceof DbFailure && e.kind === "validation");
  });
});
