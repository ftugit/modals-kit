/**
 * Кейс «коллекция как Шикимори» на РЕАЛЬНОМ PostgreSQL 17 через публикуемое ядро.
 *
 * Модель заказчика: теги закреплены за категорией, категории — за юзером, аниме — за
 * категорией; конечная коллекция = SQL, соединяющий таблицы, отдающий «список аниме за
 * юзером». Отвечает на три вопроса:
 *   A) можно ли этой же коллекцией фильтровать (теги/студии/…) — или это «просто список»;
 *   B) поддерживает ли составная коллекция insert/update/delete;
 *   C) что делает политика полей, если часть полей связанной сущности юзеру запрещена:
 *      конечная коллекция отдаст запретительное или соберёт явный список вместо `*`.
 *
 * Запуск:  node probe/shikimori-view.probe.mjs
 * Нужен PostgreSQL: см. CHECKLIST-2.md §0 (createdb shikidb).
 */
import assert from "node:assert/strict";
import { Pool } from "pg";
import { createDb, defineResource, conservativeLimits, f, field, make, policy, s } from "../index";
import { pgAdapter } from "../adapters/pg";
import { createCursorCodec } from "../cursor/codec";
import { toKitError } from "../sveltekit/index";

const URL_ = process.env.SHIKI_PROBE_PG_URL ?? "postgres://postgres@127.0.0.1:5433/shikidb";
const sqlLog = [];
const logged = (driver, depth = 0) => ({
  capabilities: driver.capabilities,
  get inTransaction() {
    return driver.inTransaction;
  },
  query: (st) => {
    sqlLog.push({ text: st.text.replace(/\s+/g, " "), values: st.values ? JSON.stringify(st.values) : "" });
    return driver.query(st);
  },
  transaction: (fn, options) => driver.transaction((tx) => fn(logged(tx, depth + 1)), options),
  close: () => driver.close?.(),
});
const lastSql = (re) => [...sqlLog].reverse().find((e) => re.test(e.text));

const pool = new Pool({ connectionString: URL_, max: 4 });
const db = createDb({
  driver: logged(pgAdapter(pool)),
  limits: conservativeLimits,
  cursorCodec: createCursorCodec({ keys: { v1: "0".repeat(32) }, activeKey: "v1", ttlSeconds: 600 }),
});

/* ── 1. Схема: теги↔категория, категории↔юзер, аниме↔категория, аниме↔студии ───── */
await pool.query(`
  DROP SCHEMA IF EXISTS shiki CASCADE;
  CREATE SCHEMA shiki;
  CREATE TABLE shiki.users (id uuid PRIMARY KEY, email text NOT NULL);
  CREATE TABLE shiki.tags (id uuid PRIMARY KEY, name text NOT NULL, slug text NOT NULL,
                           visibility text NOT NULL DEFAULT 'public');
  CREATE TABLE shiki.studios (id uuid PRIMARY KEY, name text NOT NULL);
  CREATE TABLE shiki.categories (
    id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES shiki.users(id),
    name text NOT NULL, slug text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp());
  CREATE TABLE shiki.category_tags (
    category_id uuid NOT NULL REFERENCES shiki.categories(id),
    tag_id uuid NOT NULL REFERENCES shiki.tags(id),
    PRIMARY KEY (category_id, tag_id));
  CREATE TABLE shiki.animes (
    id uuid PRIMARY KEY, title text NOT NULL, kind text NOT NULL DEFAULT 'tv',
    rating numeric(3,1), episodes int, created_at timestamptz NOT NULL DEFAULT clock_timestamp());
  CREATE TABLE shiki.anime_studios (anime_id uuid REFERENCES shiki.animes(id),
                                    studio_id uuid REFERENCES shiki.studios(id),
                                    PRIMARY KEY (anime_id, studio_id));
  -- у связи СВОЙ суррогатный ключ: иначе «аниме в категории» нельзя адресовать одной id
  CREATE TABLE shiki.anime_categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    anime_id uuid NOT NULL REFERENCES shiki.animes(id),
    category_id uuid NOT NULL REFERENCES shiki.categories(id),
    user_id uuid NOT NULL REFERENCES shiki.users(id),
    note text, added_at timestamptz NOT NULL DEFAULT clock_timestamp(), removed_at timestamptz,
    UNIQUE (anime_id, category_id));
  CREATE INDEX anime_categories_scope ON shiki.anime_categories (user_id, removed_at, added_at DESC, id);
  CREATE INDEX category_tags_tag ON shiki.category_tags (tag_id, category_id);

  CREATE OR REPLACE VIEW shiki.v_user_anime AS
  SELECT ac.id, ac.user_id, ac.category_id, ac.note, ac.added_at, ac.removed_at,
         c.name AS category, c.slug AS category_slug, c.user_id AS category_owner,
         a.id AS anime_id, a.title, a.kind, a.rating, a.episodes,
         COALESCE((SELECT jsonb_agg(t.name ORDER BY t.name)
                     FROM shiki.category_tags ct JOIN shiki.tags t ON t.id = ct.tag_id
                    WHERE ct.category_id = ac.category_id), '[]'::jsonb) AS tags,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('name', st.name) ORDER BY st.name)
                     FROM shiki.anime_studios asx JOIN shiki.studios st ON st.id = asx.studio_id
                    WHERE asx.anime_id = a.id), '[]'::jsonb) AS studios
    FROM shiki.anime_categories ac
    JOIN shiki.categories c ON c.id = ac.category_id
    JOIN shiki.animes a ON a.id = ac.anime_id
   WHERE ac.removed_at IS NULL;

  -- кто пишет — из контекста транзакции, а не из тела запроса
  CREATE OR REPLACE FUNCTION shiki.v_claim() RETURNS uuid AS $fn$
    SELECT nullif(current_setting('kit.user_id', true), '')::uuid $fn$ LANGUAGE sql STABLE;

  CREATE OR REPLACE FUNCTION shiki.v_ins() RETURNS trigger AS $fn$
  DECLARE uid uuid := shiki.v_claim(); aid uuid;
  BEGIN
    IF uid IS NULL THEN RAISE EXCEPTION 'kit.user_id is not set' USING ERRCODE = '42501'; END IF;
    IF NEW.category_id IS NULL OR NOT EXISTS
       (SELECT 1 FROM shiki.categories c WHERE c.id = NEW.category_id AND c.user_id = uid)
      THEN RAISE EXCEPTION 'category is not owned by principal' USING ERRCODE = '42501'; END IF;
    INSERT INTO shiki.animes (id, title, kind, rating, episodes)
      VALUES (coalesce(NEW.anime_id, gen_random_uuid()), NEW.title, NEW.kind, NEW.rating, NEW.episodes)
      ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, rating = EXCLUDED.rating
      RETURNING id INTO aid;
    NEW.id := coalesce(NEW.id, gen_random_uuid());
    NEW.anime_id := aid;
    INSERT INTO shiki.anime_categories (id, anime_id, category_id, user_id, note)
      VALUES (NEW.id, aid, NEW.category_id, uid, NEW.note);
    RETURN NEW;
  END $fn$ LANGUAGE plpgsql;

  CREATE OR REPLACE FUNCTION shiki.v_upd() RETURNS trigger AS $fn$
  DECLARE uid uuid := shiki.v_claim();
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM shiki.anime_categories k
                    WHERE k.id = OLD.id AND k.user_id = uid)
      THEN RAISE EXCEPTION 'link is not owned by principal' USING ERRCODE = '42501'; END IF;
    UPDATE shiki.animes SET title = NEW.title, kind = NEW.kind, rating = NEW.rating,
                            episodes = NEW.episodes
      WHERE id = OLD.anime_id;
    UPDATE shiki.anime_categories SET category_id = NEW.category_id, note = NEW.note
      WHERE id = OLD.id;
    RETURN NEW;
  END $fn$ LANGUAGE plpgsql;

  CREATE OR REPLACE FUNCTION shiki.v_del() RETURNS trigger AS $fn$
  DECLARE uid uuid := shiki.v_claim();
  BEGIN
    UPDATE shiki.anime_categories SET removed_at = clock_timestamp()
     WHERE id = OLD.id AND user_id = uid;
    RETURN OLD;
  END $fn$ LANGUAGE plpgsql;

  CREATE TRIGGER v_ins INSTEAD OF INSERT ON shiki.v_user_anime FOR EACH ROW EXECUTE FUNCTION shiki.v_ins();
  CREATE TRIGGER v_upd INSTEAD OF UPDATE ON shiki.v_user_anime FOR EACH ROW EXECUTE FUNCTION shiki.v_upd();
  CREATE TRIGGER v_del INSTEAD OF DELETE ON shiki.v_user_anime FOR EACH ROW EXECUTE FUNCTION shiki.v_del();

  -- «связка как коллекция»: вьюха над ОДНОЙ таблицей. Это важно: PostgreSQL сам
  -- обновляет простые вьюхи, поэтому softDelete/restore (UPDATE метки) работают без
  -- триггеров. Добавишь сюда join за title — и ядро упадёт на error_view_not_updatable.
  CREATE OR REPLACE VIEW shiki.v_user_anime_all AS
  SELECT ac.id, ac.user_id, ac.category_id, ac.anime_id, ac.note, ac.added_at, ac.removed_at
    FROM shiki.anime_categories ac;
`);

const u1 = "11111111-1111-4111-8111-111111111111";
const u2 = "22222222-2222-4222-8222-222222222222";
const staff = "33333333-3333-4333-8333-333333333333";
const catMine = "aaaaaaaa-0000-4000-8000-000000000001";
const catOther = "aaaaaaaa-0000-4000-8000-000000000002";
const tagShonen = "bbbbbbbb-0000-4000-8000-000000000001";
const tagIsekai = "bbbbbbbb-0000-4000-8000-000000000002";
const tagHidden = "bbbbbbbb-0000-4000-8000-000000000003";
const studioKyoto = "dddddddd-0000-4000-8000-000000000001";
const an1 = "cccccccc-0000-4000-8000-000000000001";
const an2 = "cccccccc-0000-4000-8000-000000000002";
const an3 = "cccccccc-0000-4000-8000-000000000003";
const link1 = "eeeeeeee-0000-4000-8000-000000000001";
const link2 = "eeeeeeee-0000-4000-8000-000000000002";
const link3 = "eeeeeeee-0000-4000-8000-000000000003";

for (const [text, values] of [
  [`INSERT INTO shiki.users (id, email) VALUES ($1,'me@ex'), ($2,'other@ex'), ($3,'srv@ex')`, [u1, u2, staff]],
  [
    `INSERT INTO shiki.tags (id, name, slug, visibility)
     VALUES ($1,'сёнэн','shonen','public'), ($2,'исэкай','isekai','public'), ($3,'взрослый','adult','private')`,
    [tagShonen, tagIsekai, tagHidden],
  ],
  [`INSERT INTO shiki.studios (id, name) VALUES ($1,'Kyoto Animation')`, [studioKyoto]],
  [
    `INSERT INTO shiki.categories (id, user_id, name, slug) VALUES ($1,$2,'Избранное','fav'), ($3,$4,'Чужое','other')`,
    [catMine, u1, catOther, u2],
  ],
  [
    `INSERT INTO shiki.category_tags (category_id, tag_id) VALUES ($1,$2), ($1,$3), ($1,$4)`,
    [catMine, tagShonen, tagIsekai, tagHidden],
  ],
  [
    `INSERT INTO shiki.animes (id, title, kind, rating, episodes)
     VALUES ($1,'Сталь 1','tv',8.4,27), ($2,'Сталь 2','movie',7.9,1), ($3,'Фрирен','tv',9.2,28)`,
    [an1, an2, an3],
  ],
  [`INSERT INTO shiki.anime_studios (anime_id, studio_id) VALUES ($1,$2), ($3,$2)`, [an1, studioKyoto, an3]],
  [
    `INSERT INTO shiki.anime_categories (id, anime_id, category_id, user_id, note)
     VALUES ($1,$2,$3,$4,'первое'), ($5,$6,$3,$4,'второе'), ($7,$8,$3,$4, NULL)`,
    [link1, an1, catMine, u1, link2, an2, link3, an3],
  ],
])
  await pool.query(text, values);

/* ── 2. Ресурсы: составная коллекция + связанные «как они есть» ────────────────── */
const ownScope = (ctx) => ({ field: "user_id", op: "eq", value: ctx.principal.id });
const txt = (o = {}) => field(s.text({ min: 1, max: 120 }), o);

// тег: name открыт всем, slug/visibility — только персоналу и владельцу категории
const tags = defineResource({
  key: "shiki.tags.v1",
  table: "shiki.tags",
  primaryKey: "id",
  fields: {
    id: f.uuid({ read: () => true, orderable: true, filters: ["eq", "in"] }),
    name: f.text({ read: () => true, filters: ["eq", "contains"], orderable: true }),
    slug: f.text({ read: ["staff"], filters: [] }),
    visibility: f.text({ read: ["staff"], filters: ["eq"] }),
  },
  policy: { select: () => true, insert: policy.deny(), update: policy.deny(), delete: policy.deny() },
  order: [["name", "asc"]],
});

const categories = defineResource({
  key: "shiki.categories.v1",
  table: "shiki.categories",
  primaryKey: "id",
  fields: {
    id: f.uuid({ read: () => true, orderable: true, filters: ["eq", "in"] }),
    user_id: f.uuid({ read: () => true, filters: ["eq"] }),
    name: f.text({ read: () => true, filters: ["eq", "contains"], orderable: true }),
    slug: f.text({ read: ["staff"], filters: ["eq"] }),
    created_at: f.timestamp({ read: () => true, generated: true }),
  },
  policy: { select: () => true, insert: policy.deny(), update: policy.deny(), delete: policy.deny() },
  order: [["name", "asc"]],
});

const userAnime = defineResource({
  key: "shiki.userAnime.v1",
  table: "shiki.v_user_anime",
  primaryKey: "id",
  fields: {
    id: f.uuid({ read: () => true, immutable: true, orderable: true, filters: ["eq", "in"] }),
    user_id: f.uuid({ read: () => true, immutable: true, filters: [] }),
    anime_id: f.uuid({ read: () => true, immutable: true, filters: ["eq", "in"] }),
    category_id: f.uuid({ read: () => true, create: () => true, update: () => true, filters: ["eq", "in"], orderable: true }),
    category: txt({ read: () => true, filters: ["eq", "contains", "in"], orderable: true }),
    category_slug: f.text({ read: () => true, filters: ["eq"] }),
    category_owner: f.uuid({ read: ["staff"], filters: [] }),
    title: txt({ read: () => true, create: () => true, update: () => true, required: true, normalize: (v) => (typeof v === "string" ? v.trim() : v), filters: ["eq", "contains", "startsWith"], orderable: true }),
    kind: f.text({ read: () => true, create: () => true, update: () => true, filters: ["eq"], orderable: true }),
    rating: f.decimal({ read: () => true, create: () => true, update: () => true, nullable: true, orderable: true, filters: ["gt", "gte", "lt", "lte"] }),
    episodes: f.integer({ read: () => true, create: () => true, update: () => true, nullable: true, orderable: true, filters: ["gte", "lte"] }),
    note: txt({ read: () => true, create: () => true, update: () => true, nullable: true, filters: ["contains"] }),
    tags: f.json({ read: () => true, filters: [] }),
    studios: f.json({ read: () => true, filters: [] }),
    added_at: f.timestamp({ read: () => true, generated: true, orderable: true, filters: ["gt", "lt"] }),
  },
  policy: { select: ownScope, insert: (ctx) => !!ctx.principal.id, update: ownScope, delete: ownScope },
  order: [["added_at", "desc"]],
  relations: { categoryRef: { resource: categories, localField: "category_id", foreignField: "id" } },
});

// «связка как коллекция» — то, где живёт мягкое удаление/восстановление
const userAnimeLinks = defineResource({
  key: "shiki.userAnimeLinks.v1",
  table: "shiki.v_user_anime_all",
  primaryKey: "id",
  fields: {
    id: f.uuid({ read: () => true, orderable: true, filters: ["eq", "in"] }),
    user_id: f.uuid({ read: () => true, filters: [] }),
    category_id: f.uuid({ read: () => true, filters: ["eq", "in"] }),
    anime_id: f.uuid({ read: () => true, filters: ["eq", "in"] }),
    note: txt({ read: () => true, nullable: true, filters: ["contains"] }),
    added_at: f.timestamp({ read: () => true, generated: true, orderable: true }),
    removed_at: f.timestamp({ read: () => true, generated: true, nullable: true, filters: ["isNotNull", "isNull"] }),
  },
  policy: { select: ownScope, insert: policy.deny(), update: policy.deny(), delete: ownScope },
  softDelete: {
    field: "removed_at",
    value: () => new Date().toISOString(),
    readDeleted: () => true,
  },
  order: [["added_at", "desc"]],
});

const me = { principal: { id: u1, roles: ["user"] } };
const other = { principal: { id: u2, roles: ["user"] } };
// «владелец + персонал»: тот же юзер, но с ролью staff — чтобы проверить,
// что маски полей применяются к гранту, а не к списку строк
const root = { principal: { id: u1, roles: ["user", "staff"] } };
const api = db.resource(userAnime);
const links = db.resource(userAnimeLinks);
const apiIn = (tx) => tx.resource(userAnime);
const withUser = (uid, fn) =>
  db.transaction(async (tx) => {
    await tx.query({ text: "SELECT set_config('kit.user_id', $1, true)", values: [uid] });
    return fn(tx);
  });

/* ── 3. (A) Это НЕ «просто список»: фильтры работают по всем колонкам вьюхи ────── */
assert.equal(
  (await api.select(me, { filter: { field: "title", op: "contains", value: "Сталь" } })).length,
  2,
  "contains по колонке JOIN (LIKE, регистр учитывается — ILIKE в ядре нет)",
);
assert.equal(
  (await api.select(me, { filter: { field: "title", op: "contains", value: "сталь" } })).length,
  0,
  "и честно: другой регистр = другой результат",
);
const steel = await api.select(me, { filter: { field: "title", op: "startsWith", value: "Сталь" } });
assert.equal(steel.length, 2, "startsWith по колонке из JOIN");
assert.equal((await api.select(me, { filter: { field: "rating", op: "gte", value: "9.0" } })).length, 1, "numeric-колонка фильтруется");
assert.equal((await api.select(me, { filter: { field: "episodes", op: "lte", value: 1 } })).length, 1, "integer-колонка фильтруется");
assert.equal(
  (await api.select(me, { filter: { field: "note", op: "contains", value: "первое" } })).length,
  1,
  "фильтр по колонке самой связи",
);
const nested = await api.select(me, {
  filter: { and: [{ field: "kind", op: "eq", value: "tv" }, { field: "rating", op: "gt", value: "9.0" }] },
});
assert.deepEqual(nested.map((r) => r.title), ["Фрирен"], "вложенный and компилируется в один WHERE");
assert.equal(await api.count(me, { filter: { field: "kind", op: "eq", value: "tv" } }), 2, "count под тем же WHERE");
assert.equal((await api.select(me, { order: [["rating", "desc"]], limit: 2 })).map((r) => r.rating)[0], "9.2", "сортировка по колонке JOIN");
const page2 = await api.select(me, { order: [["title", "asc"]], page: 2, limit: 2 });
assert.equal(page2.length, 1, "страница 2 из 3");
const key = await api.cursor(me, { order: [["title", "asc"]], limit: 2 });
assert.equal(key.items.length, 2, "первая курсорная страница");
assert.ok(typeof key.nextCursor === "string" && key.nextCursor.length > 10, "курсор выдан (HMAC-кодек)");
const next = await api.cursor(me, { order: [["title", "asc"]], limit: 2, after: key.nextCursor });
assert.deepEqual(next.items.map((r) => r.title), ["Фрирен"], "keyset по вьюхе без offset");
assert.ok(!lastSql(/v_user_anime/)?.text.includes("SELECT *"), "никакого SELECT *: проектруется явный список");

// фильтры «по связи»: тег и студия — это m:m, их в одном WHERE нет ни у ядра, ни у вьюхи
const tagLinks = await pool.query(
  `SELECT ct.category_id::text AS id FROM shiki.category_tags ct WHERE ct.tag_id = $1 AND $1::text IS NOT NULL`,
  [tagIsekai],
);
assert.equal(tagLinks.rows.length, 1, "категорий с тегом «исэкай» — одна");
const byTag = await api.select(me, {
  filter: { field: "category_id", op: "in", value: tagLinks.rows.map((r) => r.id) },
});
assert.equal(byTag.length, 3, "3 аниме в категориях с этим тегом");
const byStudio = await pool.query(
  `SELECT ax.anime_id AS id FROM shiki.anime_studios ax WHERE ax.studio_id = $1`,
  [studioKyoto],
);
assert.equal(
  (await api.select(me, { filter: { field: "anime_id", op: "in", value: byStudio.rows.map((r) => r.id) } })).length,
  2,
  "студии — так же: отдельный шаг (или links.exists в ACL-ярусе)",
);

/* ── 4. (A2) агрегат-колонки доступны клиенту, но НЕ фильтруемы (пока) ────────── */
assert.deepEqual([...(await api.select(me, {}))[0].tags].sort(), ["взрослый", "исэкай", "сёнэн"], "теги доехали массивом");
assert.equal((await api.select(me, {}))[0].studios[0].name, "Kyoto Animation", "студии доехали объектами");
await assert.rejects(
  () => api.select(me, { filter: { field: "tags", op: "contains", value: "сёнэн" } }),
  (e) => e.kind === "forbidden",
  "фильтр по jsonb-агрегату запрещён декларацией (нет оператора) — см. links.exists/overlaps",
);

/* ── 5. (B) insert / update / delete составной коллекции ───────────────────────── */
let created;
await withUser(u1, async (tx) => {
  created = await apiIn(tx).insert(me, {
    title: "Вия",
    category_id: catMine,
    kind: "tv",
    rating: "8.7",
    episodes: 20,
    note: "из прогона",
  });
});
assert.equal(created.title, "Вия", "insert через вьюху возвращает спроецированную строку");
assert.ok(created.id && created.anime_id, "триггер обязан вернуть NEW с заполненными id — иначе API отдаст null");
assert.equal(created.tags, null, "вычисляемые колонки вьюхи в ответе insert = null (без ре-SELECT)");
assert.equal(await api.count(me, {}), 4, "строка видна владельцу");
assert.equal(await api.count(other, {}), 0, "и не видна чужому");

const updated = await withUser(u1, (tx) => apiIn(tx).update(me, created.id, { title: "Вия!", note: "обновлено" }));
assert.equal(updated.title, "Вия!", "update через вьюху = два UPDATE на таблице (триггер)");
assert.equal((await pool.query(`SELECT note FROM shiki.anime_categories WHERE id = $1`, [created.id])).rows[0].note, "обновлено");
assert.equal(
  (await pool.query(`SELECT count(*)::int AS n FROM shiki.animes`)).rows[0].n,
  4,
  "update не породил дубль в каталоге: аниме по-прежнему 4 (3 seeded + 1 вставленное)",
);
assert.equal(
  (await pool.query(`SELECT count(*)::int AS n FROM shiki.animes WHERE title = 'Вия'`)).rows[0].n,
  0,
  "старого заголовка нет — обновлена одна строка каталога, а не «копия на связь»",
);

await withUser(u1, (tx) => apiIn(tx).delete(me, created.id));
assert.equal(await api.count(me, {}), 3, "delete = мягкое открепление (вьюха фильтрует removed_at)");
assert.equal(
  (await pool.query(`SELECT removed_at IS NOT NULL AS marked FROM shiki.anime_categories WHERE id = $1`, [created.id])).rows[0].marked,
  true,
  "INSTEAD OF DELETE триггера достаточно: DELETE с вьюхи = UPDATE метки",
);
assert.equal(
  (await pool.query(`SELECT count(*)::int AS n FROM shiki.animes WHERE title = 'Вия!'`)).rows[0].n,
  1,
  "аниме осталось в каталоге",
);
// счётчики мягкого удаления разбираются в §9 (там же и «корзина»)

/* ── 6. (B2) чужие данные и mass assignment ───────────────────────────────────── */
let massAssign;
try {
  await withUser(u1, (tx) => apiIn(tx).insert(me, { title: "Подстава", category_id: catMine, user_id: u2 }));
} catch (e) {
  massAssign = e;
}
assert.ok(massAssign, "чужой user_id в теле отвергнут field-маской");
let foreign, foreignErr;
try {
  await withUser(u1, (tx) => apiIn(tx).insert(me, { title: "Через чужую категорию", category_id: catOther }));
} catch (e) {
  foreign = true;
  foreignErr = toKitError(e, false);
}
assert.ok(foreign, "в чужую категорию не пускает");
assert.equal(foreignErr.status, 403, "отказ прав на стороне БД = 403 (SQLSTATE 42501), не 500");
assert.ok(!/INSERT|UPDATE|set_config|shiki\.|trigger/i.test(JSON.stringify(foreignErr.body)), "SQL/триггер не протекают в ответ");
assert.equal(await api.count(me, {}), 3, "и строка не создалась");
// без установленного контекста (вне транзакции) — отказ, а не «анонимная запись»
await assert.rejects(() => api.insert(me, { title: "Без контекста", category_id: catMine }), (e) => e.kind === "forbidden");
// update чужой связи: политика ownScope + проверка триггера
await assert.rejects(
  () => withUser(u2, (tx) => apiIn(tx).update(other, link1, { title: "Хак" })),
  (e) => e.kind === "forbidden" || e.kind === "not_found",
  "чужую связь не обновить",
);

/* ── 7. (C) политика полей на связанной сущности: * или явный список? ──────────── */
const lateralOf = async (ctx) => {
  const before = sqlLog.length;
  const rows = await api.select(ctx, { include: ["categoryRef"] });
  const entry = sqlLog.slice(before).find((e) => /LATERAL/.test(e.text));
  const text = entry?.text ?? "";
  return { row: rows[0], lat: text.slice(text.indexOf("LATERAL")) };
};
const asUser = await lateralOf(me);
const asStaff = await lateralOf(root);
assert.ok(asUser.row.categoryRef, "m:1 include работает и над вьюхой");
console.log("  · LATERAL пользователя:\n    " + asUser.lat.slice(0, 400));
assert.deepEqual(
  Object.keys(asUser.row.categoryRef).sort(),
  ["created_at", "id", "name", "user_id"],
  "из связи берётся ровно то, что разрешено РАЗРЕШАЮЩЕЙ коллекцией (slug = staff-only → нет)",
);
assert.ok("slug" in asStaff.row.categoryRef, "персоналу slug отдаётся тем же запросом");
assert.ok(/jsonb_build_object\(/.test(asUser.lat), "связь = jsonb_build_object по явному списку полей");
assert.ok(/\."name"/.test(asUser.lat) && !/\."slug"/.test(asUser.lat), "в списке есть name и НЕТ slug");
assert.ok(/\."slug"/.test(asStaff.lat), "у персонала список шире — ровно на одно поле");
assert.ok(!/\*|SELECT \*/.test(asUser.lat + asStaff.lat), "звёздочки в join нет ни у кого");
// сузить поля связи сверху нельзя: include принимает только имена, список строит readable()
await assert.rejects(
  // @ts-expect-error: include не принимает объект с fields — это не API
  () => api.select(me, { include: { categoryRef: { fields: ["name"] } } }),
  (e) => e.kind === "validation",
  "переопределить поля связи запросом нельзя",
);
// запрещённое поле: проекция сужается молча (readable() фильтрует по grants), фильтр по
// такому полю — 403, потому что фильтром можно проверять значение вслепую
const sneak = await db.resource(tags).select(me, { fields: ["slug"], filter: { field: "name", op: "eq", value: "сёнэн" } });
assert.ok(sneak.length > 0 && sneak.every((r) => !("slug" in r) && !("visibility" in r)), "запрещённого поля в проекции не будет никогда");
await assert.rejects(
  () => db.resource(tags).select(me, { filter: { field: "slug", op: "eq", value: "adult" } }),
  (e) => e.kind === "forbidden" || e.kind === "validation",
  "фильтр по staff-only полю (slug не объявлен в filters) недоступен",
);
const staffTags = await db.resource(tags).select(root, { fields: ["slug", "visibility"] });
assert.ok(staffTags.every((r) => "slug" in r && "visibility" in r), "персоналу те же поля доступны");
// и главное про агрегат: маска действует на КОЛОНКУ целиком
assert.ok("category_owner" in (await api.select(root, {}))[0], "staff видит служебную колонку");
assert.ok(!("category_owner" in asUser.row), "у пользователя её нет вообще (read: ['staff'])");
assert.deepEqual(
  [...asUser.row.tags].sort(),
  ["взрослый", "исэкай", "сёнэн"],
  "ВАЖНО: приватный тег виден внутри tags — вьюха собрала jsonb_agg ДО маски, поэтому поля в агрегат класть нельзя",
);

/* ── 8. (B2) что ломает запись в составную коллекцию ───────────────────────────── */
await assert.rejects(
  () => api.insert(me, { title: "Без контекста", category_id: catMine }),
  (e) => e.kind === "forbidden" || e.kind === "validation",
  "вне транзакции GUC не установлен → триггер отказывает, анонимной записи нет",
);
// validateFinal/hooks заставляют ядро сделать пред-чтение SELECT … FOR UPDATE. На вьюхе
// с JOIN PostgreSQL это разрешает (блокируются строки базовых таблиц) — проверено здесь.
const hookCalls = [];
const withFinal = defineResource({
  ...userAnime,
  key: "shiki.userAnime.final.v1",
  validateFinal: make("probe", (row) => (row && typeof row === "object" ? true : "row expected")),
  hooks: { beforeWrite: async (e) => hookCalls.push([e.operation, e.before ? "before" : "нет before"]) },
});
const locked = await withUser(u1, (tx) => tx.resource(withFinal).update(me, link1, { note: "через validateFinal" }));
assert.equal(locked.note, "через validateFinal", "update с валидной validateFinal + hook проходит через вьюху");
assert.deepEqual(hookCalls, [["update", "before"]], "hook получил before-строку (FOR UPDATE пред-чтение работает)");
assert.throws(
  () => defineResource({ ...userAnime, key: "shiki.userAnime.bad.v1", validateFinal: true }),
  (e) => e.kind === "validation" && /validateFinal/.test(e.details.issues.join(";")),
  "validateFinal:true (не схема) отклоняется на определении, а не на записи",
);

/* ── 9. (B3) мягкое удаление и «корзина» живут на связи, а не на вьюхе-join ───── */
assert.equal(await api.count(me, {}), 3, "составная коллекция скрыла откреплённое");
assert.equal(await links.count(me, {}), 3, "живых связей 3");
assert.equal(await links.count(me, { includeDeleted: true }), 4, "includeDeleted = не скрывать (4)");
const basket = await links.select(me, { includeDeleted: true, filter: { field: "removed_at", op: "isNotNull" } });
assert.deepEqual(basket.map((r) => r.anime_id), [created.anime_id], "«только откреплённые» = includeDeleted + isNotNull");
assert.deepEqual(
  await links.select(me, { filter: { field: "removed_at", op: "isNotNull" } }),
  [],
  "без includeDeleted удалённые не видны ни при каком фильтре (иначе restore был бы обходом)",
);
assert.deepEqual(
  await links.select(other, { includeDeleted: true, filter: { field: "removed_at", op: "isNotNull" } }),
  [],
  "чужая корзина = пустой список, а не ошибка: политика применяется до фильтра",
);
// restore = UPDATE метки; на одно-табличной вьюхе он auto-updatable (триггер не нужен),
// на вьюхе-join ушёл бы в INSTEAD OF UPDATE — поэтому softDelete вешается на связь
await withUser(u1, async (tx) => {
  await tx.query({
    text: "UPDATE shiki.v_user_anime_all SET removed_at = NULL WHERE id = $1 AND user_id = $2",
    values: [basket[0].id, u1],
  });
});
assert.equal(await api.count(me, {}), 4, "restore: аниме вернулось в список");
await withUser(u1, (tx) => tx.resource(userAnimeLinks).delete(me, basket[0].id));
assert.equal(await api.count(me, {}), 3, "delete на одно-табличной вьюхе = UPDATE метки ядром (без триггера)");
await withUser(u1, async (tx) => {
  await tx.query({ text: "UPDATE shiki.v_user_anime_all SET removed_at = NULL WHERE id = $1 AND user_id = $2", values: [basket[0].id, u1] });
});
assert.equal(await links.count(me, { includeDeleted: true }), 4, "связь не удалялась — только снята метка");

console.log(`
A) Составная коллекция — не «просто список»: contains/startsWith по title, gte по numeric,
   lte по int, isNotNull, вложенный and, count, ORDER BY по колонке JOIN, page и keyset —
   всё зелёное (один WHERE, политика внутри). m:m (теги, студии) = отдельный шаг либо
   links.exists в ACL-ярусе; операторов для jsonb-массивов в ядре нет намеренно.
B) insert/update/delete работают через вьюху (INSTEAD OF + set_config в транзакции);
   суррогатный id связи обязателен; delete = мягкий (аниме остаётся в каталоге);
   mass assignment = 422, чужая категория = 403 без утечки SQL; FOR UPDATE-пред-чтение
   (validateFinal/hooks) на вьюхе разрешён PG; корзина/restore — на коллекции связи,
   потому что ядро пишет метку UPDATE'ом, а join-вьюха не auto-updatable.
C) join = jsonb_build_object по явному списку полей из readable(связанной коллекции)
   под того же ctx: name есть, slug (staff-only) — нет; сузить/include-переопределить
   нельзя; звёздочка в SQL не появляется никогда. Агрегатная колонка (tags) маскируется только
   целиком → приватные поля в неё класть нельзя, только id/name, отфильтрованные вьюхой.`);
console.log("PROBE_OK");
await pool.end();
