import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { PGlite } from '@electric-sql/pglite'
import { resetPublicTables } from './db-reset-lib.mjs'

test('сброс public: таблицы и FK удалены, схема и права сохранены; ошибка откатывает сброс', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      CREATE TABLE public."parent""quote" (id integer PRIMARY KEY);
      CREATE TABLE public.child (id integer REFERENCES public."parent""quote"(id));
      INSERT INTO public."parent""quote" VALUES (1);
      INSERT INTO public.child VALUES (1);
      CREATE TABLE public.kit_schema (name text);
      CREATE TABLE public.parted (id int) PARTITION BY RANGE (id);
      CREATE TABLE public.parted_1 PARTITION OF public.parted FOR VALUES FROM (0) TO (100);
      CREATE TABLE public.serial_table (id serial);
      CREATE SCHEMA other;
      CREATE TABLE other.untouched (id integer);
      INSERT INTO other.untouched VALUES (42);
    `)
    const before = await db.query("SELECT nspowner, nspacl FROM pg_namespace WHERE nspname = 'public'")
    assert.equal(await resetPublicTables(db), 6)
    assert.deepEqual((await db.query("SELECT nspowner, nspacl FROM pg_namespace WHERE nspname = 'public'")).rows, before.rows)
    assert.equal((await db.query('SELECT id FROM other.untouched')).rows[0].id, 42)
    assert.equal(await resetPublicTables(db), 0)

    await db.exec('CREATE TABLE public.keep_me (id int); INSERT INTO public.keep_me VALUES (7); CREATE VIEW other.dependency AS SELECT * FROM public.keep_me;')
    await assert.rejects(resetPublicTables(db), /depend/i)
    assert.equal((await db.query('SELECT id FROM public.keep_me')).rows[0].id, 7)
    assert.equal((await db.query('SELECT id FROM other.dependency')).rows[0].id, 7)
    await db.exec('DROP VIEW other.dependency; DROP TABLE public.keep_me; DROP SCHEMA public;')
    await assert.rejects(resetPublicTables(db), /схема public отсутствует/)
  } finally {
    await db.close()
  }
})

test('межсхемные секции не уничтожают данные в обоих направлениях', async () => {
  const db = new PGlite()
  try {
    await db.exec('CREATE SCHEMA other; CREATE TABLE public.parent (id int) PARTITION BY RANGE (id); CREATE TABLE other.child PARTITION OF public.parent FOR VALUES FROM (0) TO (100); INSERT INTO public.parent VALUES (1)')
    await assert.rejects(resetPublicTables(db), /другой схемой/)
    assert.equal((await db.query('SELECT id FROM other.child')).rows[0].id, 1)
    await db.exec('DROP TABLE public.parent; CREATE TABLE other.parent (id int) PARTITION BY RANGE (id); CREATE TABLE public.child PARTITION OF other.parent FOR VALUES FROM (0) TO (100); INSERT INTO other.parent VALUES (2)')
    await assert.rejects(resetPublicTables(db), /другой схемой/)
    assert.equal((await db.query('SELECT id FROM other.parent')).rows[0].id, 2)
    assert.equal((await db.query('SELECT id FROM public.child')).rows[0].id, 2)
  } finally { await db.close() }
})

test('роль без CREATE на базе сбрасывает принадлежащие ей таблицы, не пересоздавая public', async () => {
  const db = new PGlite()
  try {
    await db.exec('CREATE ROLE app LOGIN; GRANT USAGE, CREATE ON SCHEMA public TO app; SET ROLE app; CREATE TABLE public.app_table (id int); INSERT INTO public.app_table VALUES (1)')
    const privilege = await db.query("SELECT has_database_privilege(current_user, current_database(), 'CREATE') AS can_create")
    assert.equal(privilege.rows[0].can_create, false)
    assert.equal(await resetPublicTables(db), 1)
    await db.exec('CREATE TABLE public.app_table (id int)')
  } finally {
    await db.close()
  }
})

test('скрипт без флага не подключается; включённый сброс без URL или с другим Hyperdrive запрещён', () => {
  const env = { ...process.env, DATABASE_URL: '', DATABASE_RESET: '', HYPERDRIVE_CONNECTION_STRING: '' }
  const run = (extra) => spawnSync(process.execPath, ['tooling/db-reset.mjs'], { env: { ...env, ...extra }, encoding: 'utf8' })
  assert.equal(run({}).status, 0)
  const missing = run({ DATABASE_RESET: 'yes' })
  assert.equal(missing.status, 1)
  assert.match(missing.stderr, /DATABASE_URL пуст/)
  const wrong = run({ DATABASE_RESET: '1', DATABASE_URL: 'postgres://a/one', HYPERDRIVE_CONNECTION_STRING: 'postgres://b/two' })
  assert.equal(wrong.status, 1)
  assert.match(wrong.stderr, /перекрывает DATABASE_URL/)
})

test('неподдерживаемые таблицы не удаляются; ошибка операции инициирует rollback', async () => {
  const seen = []
  const client = { async query(sql) {
    seen.push(sql)
    if (sql.includes('to_regnamespace')) return { rows: [{ exists: true }] }
    if (sql.includes('pg_catalog.pg_class c')) return { rows: [{ name: 'external', kind: 'f', extension_owned: false }] }
    return { rows: [] }
  } }
  await assert.rejects(resetPublicTables(client), /внешние/)
  assert.equal(seen.at(-1), 'ROLLBACK')
  assert.ok(!seen.some((s) => s.startsWith('DROP')))
})
