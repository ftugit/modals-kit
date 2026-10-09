/**
 * Проверка энкодинговой ловушки `icontains`/`istartsWith` на реальном PostgreSQL.
 *
 * Замер (не догадка): в БД с `server_encoding = SQL_ASCII` (дефолт `initdb` при
 * `LANG=C`/`POSIX`) PostgreSQL складывает регистр только по ASCII. Значит
 * `title ILIKE '%СТаль%'` против `Сталь` = false, а не «данные кончились»: запрос
 * валиден, ответ пуст, тест зелёный. Хелпер `withTestDb` это ловит — зонд
 * подтверждает и ловушку, и лечение.
 *
 * Запуск:  node probe/testdb-encoding.probe.mjs
 * Нужны:   поднятый PG17 (CHECKLIST-2 §0) и две БД:
 *   createdb -T template0 --encoding=UTF8    --locale=C.UTF-8 kitdb_utf
 *   createdb -T template0 --encoding=SQL_ASCII                 kitdb_ascii
 * Переменные: KIT_TEST_PG_URL (UTF8-база), KIT_TEST_PG_URL_ASCII, PROBE_PG_UTF, PROBE_PG_ASCII.
 */
import assert from "node:assert/strict";
import { withTestDb } from "../testing/index.ts";
import { createDb } from "../index";
import { defineResource, f, conservativeLimits } from "../index";
import { DbFailure } from "../errors";
import { pgAdapter } from "../adapters/pg";

const UTF_URL = process.env.PROBE_PG_UTF ?? process.env.KIT_TEST_PG_URL;
const ASCII_URL = process.env.PROBE_PG_ASCII ?? "postgres://postgres@127.0.0.1:5433/kitdb_ascii";
if (!UTF_URL) {
  console.error("нужен PROBE_PG_UTF или KIT_TEST_PG_URL (UTF8-база)");
  process.exit(2);
}

const MIG = [
  "CREATE TABLE demo_post (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL);",
];
const def = defineResource({
  key: "probe.encoding.v1",
  table: "demo_post",
  primaryKey: "id",
  fields: {
    id: f.uuid({ read: () => true, orderable: true, filters: ["eq"] }),
    title: f.text({ read: () => true, create: () => true, required: true, filters: ["eq", "contains", "icontains"] }),
  },
  policy: { select: () => true, insert: () => true, update: () => true, delete: () => true },
  order: [["id", "asc"]],
});
const ctx = { principal: { roles: [] } };

/** Что реально отвечает `icontains` в этой базе (сидируем напрямую, минуя хелпер). */
async function ciIn(url) {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: url, max: 1 });
  const db = createDb({ driver: pgAdapter(pool), limits: conservativeLimits });
  await db.query({ text: "DROP TABLE IF EXISTS demo_post" });
  await db.query({ text: "CREATE TABLE demo_post (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL)" });
  const api = db.resource(def);
  await api.insertMany(ctx, [{ title: "Сталь 0" }, { title: "Атака" }]);
  const ci = (await api.select(ctx, { filter: { field: "title", op: "icontains", value: "СТаль" } })).length;
  const like = (await api.select(ctx, { filter: { field: "title", op: "contains", value: "Сталь" } })).length;
  const fold = (await db.query({ text: "SELECT current_setting('server_encoding') AS enc, (lower('А') = 'а') AS ci" })).rows[0];
  await db.query({ text: "DROP TABLE demo_post" });
  await pool.end();
  return { ci, like, enc: String(fold.enc), caseFolds: fold.ci === true };
}

/* 1. UTF8: хелпер пропускает, `icontains` находит без учёта регистра */
await withTestDb(
  async ({ db, encoding }) => {
    assert.equal(encoding.encoding, "UTF8", "база UTF8");
    assert.equal(encoding.caseFolds, true, "lower('А') = 'а'");
    const api = db.resource(def);
    await api.insertMany(ctx, [{ title: "Сталь 0" }]);
    assert.equal(
      (await api.select(ctx, { filter: { field: "title", op: "icontains", value: "СТаль" } })).length,
      1,
      "в UTF8 регистронезависимый поиск по-русски работает",
    );
  },
  { url: UTF_URL, migrations: MIG },
);
const good = await ciIn(UTF_URL);
assert.equal(good.ci, 1, "UTF8: icontains нашёл");

/* 2. SQL_ASCII: та же пара запросов возвращает пустоту — вот что ловит хелпер */
const bad = await ciIn(ASCII_URL);
assert.equal(bad.ci, 0, "SQL_ASCII: icontains НЕ нашёл (ложный пустой результат)");
assert.equal(bad.like, 1, "SQL_ASCII: contains (LIKE) не пострадал — байтовый поиск жив");
await assert.rejects(
  () => withTestDb(async () => "ok", { url: ASCII_URL, migrations: MIG }),
  (e) => {
    assert.ok(e instanceof DbFailure, "ожидался DbFailure");
    assert.equal(e.kind, "unsupported");
    assert.match((e.details.issues ?? []).join(" "), /SQL_ASCII/);
    return true;
  },
    "хелпер обязан отказать, а не дать зелёные тесты над сломанным ci-поиском",
);
// явное согласие на «любой энкодинг» — проверка выключается
const lenient = await withTestDb(async ({ encoding }) => encoding.caseFolds, {
  url: ASCII_URL,
  migrations: MIG,
  encoding: "any",
});
assert.equal(lenient, false, "encoding: 'any' — прогон разрешён, но caseFolds честно сообщает false");

console.log(
  `\nUTF8:      enc=${good.enc} icontains=${good.ci} contains=${good.like}\n` +
    `SQL_ASCII: enc=${bad.enc} icontains=${bad.ci} (ложная пустота) contains=${bad.like} (LIKE не трогает)\n` +
    `withTestDb: на SQL_ASCII = unsupported/{encoding:'any'} = прогон\n\nENCODING_PROBE_OK`,
);
