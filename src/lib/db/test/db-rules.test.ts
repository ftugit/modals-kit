/**
 * Правила один раз (docs/design/db-form-validation-answers.md, шаги 2–4):
 * `checks` в модели, `validator` для форм без записи, метка проверки и тип/CHECK из
 * Standard JSON Schema. Своя схема поля здесь — заглушка со счётчиком вызовов: так
 * видно, выполнялась ли проверка второй раз. Поле `lib/form` с той же ролью проверяет
 * `src/lib/server/form-db.test.ts`.
 */
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, it } from "vitest";
import { createDb, defineResource, f, field, policy, s, DbFailure, conservativeLimits, failureIssues } from "../index";
import type { CheckEvent, Database, Fields, Resource, StandardSchema } from "../index";
import { pgliteAdapter } from "../adapters/pglite";
import { defineSchema } from "../sync/index";
import { tableSpec } from "../sync/model";
import { VALIDATED_PROOF, readProof, sameValue } from "../proof";

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
  await fn(createDb({ driver, limits: conservativeLimits }), shared);
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
