import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { spawn, spawnSync } from 'node:child_process'
import { resetPublicTables, resetPublicObjects } from './db-reset-lib.mjs'
import { exclusiveReset } from './db-exclusive-lib.mjs'

// Только по явному opt-in и только локальный тестовый кластер. Создаётся и
// удаляется новая БД со случайным именем; существующие БД не модифицируются.
const url = process.env.KIT_TEST_PG_ADMIN_URL

test('реальная PostgreSQL: межсхемная секция, конкурентный attach и rollback', { skip: !url, timeout: 30000 }, async () => {
  const config = new URL(url)
  assert.ok(['postgres:', 'postgresql:'].includes(config.protocol))
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(config.hostname), 'только loopback-кластер')
  assert.equal(config.search, '', 'параметры URL недопустимы: они могут переопределить адрес')
  const name = `kit_test_${randomBytes(12).toString('hex')}`
  const admin = new pg.Client({ connectionString: url })
  await admin.connect()
  let a, b, created = false
  try {
    await admin.query(`CREATE DATABASE "${name}"`)
    created = true
    config.pathname = `/${name}`
    a = new pg.Client({ connectionString: config.toString() })
    b = new pg.Client({ connectionString: config.toString() })
    await a.connect(); await b.connect()
    await a.query('CREATE SCHEMA other; CREATE TABLE public.parent(id int) PARTITION BY RANGE(id)')
    await b.query('BEGIN')
    await b.query('CREATE TABLE other.child PARTITION OF public.parent FOR VALUES FROM (0) TO (100); INSERT INTO public.parent VALUES (9)')
    const pending = resetPublicTables(a)
    const pid = a.processID
    let waiting = false
    for (let i = 0; i < 100; i++) {
      const state = await admin.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [pid])
      if (state.rows[0]?.wait_event_type === 'Lock') { waiting = true; break }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.ok(waiting, 'reset ожидает конкурентную блокировку родителя')
    await b.query('COMMIT')
    await assert.rejects(pending, /другой схемой/)
    assert.equal((await a.query('SELECT count(*)::int AS n FROM other.child')).rows[0].n, 1)
    await a.query('DROP TABLE public.parent; CREATE TABLE other.parent(id int) PARTITION BY RANGE(id); CREATE TABLE public.child PARTITION OF other.parent FOR VALUES FROM (0) TO (100); INSERT INTO other.parent VALUES (7)')
    await assert.rejects(resetPublicTables(a), /другой схемой/)
    assert.equal((await a.query('SELECT id FROM other.parent')).rows[0].id, 7)
    assert.equal((await a.query('SELECT id FROM public.child')).rows[0].id, 7)
  } finally {
    await b?.end().catch(() => {})
    await a?.end().catch(() => {})
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`)
    await admin.end()
  }
})


test('реальная PostgreSQL: полный сброс поддерживаемых объектов и rollback неизвестных', { skip: !url, timeout: 30000 }, async () => {
  const config = new URL(url)
  assert.ok(['postgres:', 'postgresql:'].includes(config.protocol))
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(config.hostname))
  assert.equal(config.search, '')
  const name = `kit_test_${randomBytes(12).toString('hex')}`
  const admin = new pg.Client({ connectionString: url }); await admin.connect()
  let db, created = false
  try {
    await admin.query(`CREATE DATABASE "${name}"`); created = true
    config.pathname = `/${name}`; db = new pg.Client({ connectionString: config.toString() }); await db.connect()
    await db.query(`CREATE TABLE public.t(id serial PRIMARY KEY); INSERT INTO public.t VALUES(1);
      CREATE VIEW public.v AS SELECT id FROM public.t;
      CREATE MATERIALIZED VIEW public.mv AS SELECT id FROM public.t;
      CREATE SEQUENCE public.independent; CREATE TYPE public.mood AS ENUM ('a','b');
      CREATE DOMAIN public.positive AS integer CHECK (VALUE > 0);
      CREATE FUNCTION public.addone(x integer) RETURNS integer LANGUAGE sql AS 'SELECT x+1';
      CREATE PROCEDURE public.testproc() LANGUAGE sql AS 'SELECT 1';
      CREATE COLLATION public.sample_coll (provider=libc, locale='C');
      CREATE SCHEMA other; CREATE TABLE other.keep(id int); INSERT INTO other.keep VALUES(7)`)
    const before = await db.query("SELECT oid, nspowner, nspacl FROM pg_namespace WHERE nspname='public'")
    const result = await resetPublicObjects(db)
    assert.equal(result.tables, 1); assert.equal(result.views, 2); assert.equal(result.routines, 2)
    assert.deepEqual((await db.query("SELECT oid, nspowner, nspacl FROM pg_namespace WHERE nspname='public'")).rows, before.rows)
    assert.equal((await db.query('SELECT id FROM other.keep')).rows[0].id, 7)
    await db.query(`CREATE TABLE public.must_remain(id int); INSERT INTO public.must_remain VALUES(8);
      CREATE TEXT SEARCH CONFIGURATION public.unsupported (COPY = pg_catalog.simple)`)
    await assert.rejects(resetPublicObjects(db), /неподдерживаемые объекты/)
    assert.equal((await db.query('SELECT id FROM public.must_remain')).rows[0].id, 8)
    await db.query('DROP TEXT SEARCH CONFIGURATION public.unsupported; CREATE VIEW other.external_ref AS SELECT id FROM public.must_remain')
    await assert.rejects(resetPublicObjects(db))
    assert.equal((await db.query('SELECT id FROM other.external_ref')).rows[0].id, 8)
  } finally {
    await db?.end().catch(() => {})
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`)
    await admin.end()
  }
})


test('реальная PostgreSQL: reset ждёт закрытия активного сеанса, не прерывая транзакцию', { skip: !url, timeout: 30000 }, async () => {
  const config = new URL(url)
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(config.hostname)); assert.equal(config.search, '')
  const name = `kit_test_${randomBytes(12).toString('hex')}`
  const admin = new pg.Client({ connectionString: url }); await admin.connect()
  let app, created = false
  try {
    await admin.query(`CREATE DATABASE "${name}"`); created = true
    config.pathname = `/${name}`; app = new pg.Client({ connectionString: config.toString() }); app.on('error', () => {}); await app.connect()
    await app.query('CREATE TABLE public.old_data(id int); INSERT INTO public.old_data VALUES (1)')
    await app.query('BEGIN')
    await app.query('CREATE TABLE public.late_created(id int); INSERT INTO public.late_created VALUES (9)')
    let disabled
    const disabledReady = new Promise(resolve => { disabled = resolve })
    const pendingReset = exclusiveReset(config.toString(), 5000, { afterDisabled: () => disabled() })
    void pendingReset.catch(() => {})
    await disabledReady
    assert.equal((await admin.query('SELECT datallowconn FROM pg_database WHERE datname=$1', [name])).rows[0].datallowconn, false)
    const outsider = new pg.Client({ connectionString: config.toString(), connectionTimeoutMillis: 1000 })
    try { await assert.rejects(outsider.connect()) } finally { await outsider.end().catch(() => {}) }
    await assert.rejects(exclusiveReset(config.toString(), 1000), /другой сброс/)
    assert.equal((await app.query('SELECT id FROM public.late_created')).rows[0].id, 9)
    await app.query('COMMIT')
    // После COMMIT соединение ещё живёт: reset должен ждать и его закрытия.
    assert.equal((await app.query('SELECT count(*)::int n FROM public.old_data')).rows[0].n, 1)
    await app.end(); app = undefined
    const result = await pendingReset
    assert.equal(result.tables, 2)
    const verify = new pg.Client({ connectionString: config.toString() }); await verify.connect()
    try {
      assert.equal((await verify.query("SELECT to_regclass('public.old_data') AS x")).rows[0].x, null)
      assert.equal((await verify.query("SELECT to_regclass('public.late_created') AS x")).rows[0].x, null)
      await verify.query('CREATE TABLE public.new_data(id int); INSERT INTO public.new_data VALUES(5)')
      assert.equal((await verify.query('SELECT id FROM public.new_data')).rows[0].id, 5)
    } finally { await verify.end() }
  } finally {
    await app?.end().catch(() => {})
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`)
    await admin.end()
  }
})

test('реальная PostgreSQL: если соединение не закрылось, reset не начинает DDL и не прерывает транзакцию', { skip: !url, timeout: 30000 }, async () => {
  const config = new URL(url)
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(config.hostname)); assert.equal(config.search, '')
  const name = `kit_test_${randomBytes(12).toString('hex')}`
  const admin = new pg.Client({ connectionString: url }); await admin.connect()
  let app, created = false
  try {
    await admin.query(`CREATE DATABASE "${name}"`); created = true; config.pathname = `/${name}`
    app = new pg.Client({ connectionString: config.toString() }); app.on('error', () => {}); await app.connect()
    await app.query('CREATE TABLE public.keep(id int); INSERT INTO public.keep VALUES (1)')
    await app.query('BEGIN; INSERT INTO public.keep VALUES (2)')
    await assert.rejects(exclusiveReset(config.toString(), 300), /прежние подключения не закрылись вовремя; сброс не начат/)
    assert.equal((await admin.query('SELECT datallowconn FROM pg_database WHERE datname=$1', [name])).rows[0].datallowconn, true)
    // Исходная транзакция всё ещё работает: её не убили ни на idle, ни на COMMIT.
    assert.equal((await app.query('SELECT count(*)::int AS n FROM public.keep')).rows[0].n, 2)
    await app.query('COMMIT'); await app.end(); app = undefined
    const verify = new pg.Client({ connectionString: config.toString() }); await verify.connect()
    try { assert.deepEqual((await verify.query('SELECT id FROM public.keep ORDER BY id')).rows.map(r => r.id), [1, 2]) }
    finally { await verify.end() }
  } finally {
    await app?.end().catch(() => {})
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`)
    await admin.end()
  }
})

test('реальная PostgreSQL: сбой сброса откатывает изменения и восстанавливает подключения', { skip: !url, timeout: 30000 }, async () => {
  const config = new URL(url); assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(config.hostname)); assert.equal(config.search, '')
  const name = `kit_test_${randomBytes(12).toString('hex')}`
  const admin = new pg.Client({ connectionString: url }); await admin.connect(); let created = false
  try {
    await admin.query(`CREATE DATABASE "${name}"`); created = true; config.pathname = `/${name}`
    const setup = new pg.Client({ connectionString: config.toString() }); await setup.connect()
    await setup.query(`CREATE TABLE public.keep(id int); INSERT INTO public.keep VALUES (8); CREATE SCHEMA other; CREATE VIEW other.v AS SELECT * FROM public.keep`); await setup.end()
    await assert.rejects(exclusiveReset(config.toString(), 3000))
    const verify = new pg.Client({ connectionString: config.toString() }); await verify.connect()
    try { assert.equal((await verify.query('SELECT id FROM other.v')).rows[0].id, 8) } finally { await verify.end() }
    assert.equal((await admin.query('SELECT datallowconn FROM pg_database WHERE datname=$1', [name])).rows[0].datallowconn, true)
  } finally { if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`); await admin.end() }
})


test('реальная PostgreSQL: SIGTERM во время эксклюзивной фазы откатывает транзакцию и открывает БД', { skip: !url, timeout: 15000 }, async () => {
  const config = new URL(url); assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(config.hostname)); assert.equal(config.search, '')
  const name = `kit_test_${randomBytes(12).toString('hex')}`; const admin = new pg.Client({ connectionString: url }); await admin.connect()
  let child, created = false
  try {
    await admin.query(`CREATE DATABASE "${name}"`); created = true; config.pathname = `/${name}`
    const setup = new pg.Client({ connectionString: config.toString() }); await setup.connect(); await setup.query('CREATE TABLE public.keep(id int); INSERT INTO public.keep VALUES (9)'); await setup.end()
    const script = `import { exclusiveReset } from './tooling/db-exclusive-lib.mjs'; await exclusiveReset(process.env.KIT_ISOLATED_TARGET, 3000, { afterExclusive: async () => { console.log('LOCKED'); await new Promise(() => {}) } });`
    child = spawn(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, KIT_ISOLATED_TARGET: config.toString() }, stdio: ['ignore', 'pipe', 'pipe'] })
    const locked = new Promise((resolve, reject) => { let out = ''; child.stdout.on('data', (chunk) => { out += chunk; if (out.includes('LOCKED')) resolve() }); child.once('exit', (code) => reject(new Error(`child exited before lock: ${code}`))) })
    await locked
    assert.equal((await admin.query('SELECT datallowconn FROM pg_database WHERE datname=$1', [name])).rows[0].datallowconn, false)
    const exit = new Promise((resolve) => child.once('exit', resolve))
    child.kill('SIGTERM'); await exit
    assert.equal((await admin.query('SELECT datallowconn FROM pg_database WHERE datname=$1', [name])).rows[0].datallowconn, true)
    const verify = new pg.Client({ connectionString: config.toString() }); await verify.connect()
    try { assert.equal((await verify.query('SELECT id FROM public.keep')).rows[0].id, 9) } finally { await verify.end() }
  } finally { child?.kill('SIGKILL'); if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`); await admin.end() }
})

test('реальная PostgreSQL: отдельный watchdog восстанавливает подключения после SIGKILL родителя', { skip: !url, timeout: 15000 }, async () => {
  const config = new URL(url); assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(config.hostname)); assert.equal(config.search, '')
  const name = `kit_test_${randomBytes(12).toString('hex')}`; const admin = new pg.Client({ connectionString: url }); await admin.connect()
  let child, created = false
  try {
    await admin.query(`CREATE DATABASE "${name}"`); created = true; config.pathname = `/${name}`
    const setup = new pg.Client({ connectionString: config.toString() }); await setup.connect(); await setup.query('CREATE TABLE public.keep(id int); INSERT INTO public.keep VALUES (11)'); await setup.end()
    const script = `import { exclusiveReset } from './tooling/db-exclusive-lib.mjs'; await exclusiveReset(process.env.KIT_ISOLATED_TARGET, 3000, { afterExclusive: async () => { console.log('LOCKED'); await new Promise(() => {}) } });`
    child = spawn(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, KIT_ISOLATED_TARGET: config.toString() }, stdio: ['ignore', 'pipe', 'pipe'] })
    await new Promise((resolve, reject) => { let out = ''; child.stdout.on('data', (chunk) => { out += chunk; if (out.includes('LOCKED')) resolve() }); child.once('exit', (code) => reject(new Error(`child exited before lock: ${code}`))) })
    assert.equal((await admin.query('SELECT datallowconn FROM pg_database WHERE datname=$1', [name])).rows[0].datallowconn, false)
    const exit = new Promise((resolve) => child.once('exit', resolve)); child.kill('SIGKILL'); await exit
    let enabled = false
    for (let i = 0; i < 100; i++) {
      enabled = (await admin.query('SELECT datallowconn FROM pg_database WHERE datname=$1', [name])).rows[0].datallowconn
      if (enabled) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    assert.equal(enabled, true)
    const verify = new pg.Client({ connectionString: config.toString() }); await verify.connect()
    try { assert.equal((await verify.query('SELECT id FROM public.keep')).rows[0].id, 11) } finally { await verify.end() }
  } finally { child?.kill('SIGKILL'); if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`); await admin.end() }
})


test('реальная PostgreSQL: включённый build reset очищает только выделенную тестовую БД', { skip: !url, timeout: 15000 }, async () => {
  const config = new URL(url); assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(config.hostname)); assert.equal(config.search, '')
  const name = `kit_test_${randomBytes(12).toString('hex')}`; const admin = new pg.Client({ connectionString: url }); await admin.connect(); let created = false
  try {
    await admin.query(`CREATE DATABASE "${name}"`); created = true; config.pathname = `/${name}`
    const setup = new pg.Client({ connectionString: config.toString() }); await setup.connect(); await setup.query('CREATE TABLE public.to_delete(id int); INSERT INTO public.to_delete VALUES(12)'); await setup.end()
    const child = spawnSync(process.execPath, ['tooling/db-reset.mjs'], { env: { ...process.env, DATABASE_RESET: 'yes', DATABASE_URL: config.toString(), HYPERDRIVE_CONNECTION_STRING: '' }, encoding: 'utf8', timeout: 10000 })
    assert.equal(child.status, 0, child.stderr)
    const verify = new pg.Client({ connectionString: config.toString() }); await verify.connect()
    try { assert.equal((await verify.query("SELECT to_regclass('public.to_delete') AS x")).rows[0].x, null) } finally { await verify.end() }
  } finally { if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`); await admin.end() }
})

test('реальная PostgreSQL: роль без прав владельца не изменяет данные и не закрывает доступ', { skip: !url, timeout: 30000 }, async () => {
  const config = new URL(url)
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(config.hostname)); assert.equal(config.search, '')
  const suffix = randomBytes(8).toString('hex')
  const name = `kit_test_${suffix}`, role = `kit_role_${suffix}`
  const admin = new pg.Client({ connectionString: url }); await admin.connect()
  let dbCreated = false, roleCreated = false
  try {
    await admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD 'isolated-test-only'`); roleCreated = true
    await admin.query(`CREATE DATABASE "${name}"`); dbCreated = true
    config.pathname = `/${name}`
    const setup = new pg.Client({ connectionString: config.toString() }); await setup.connect()
    await setup.query(`CREATE TABLE public.keep(id int); INSERT INTO public.keep VALUES(42); GRANT USAGE ON SCHEMA public TO "${role}"`)
    await setup.end()
    const restricted = new URL(config); restricted.username = role; restricted.password = 'isolated-test-only'
    await assert.rejects(exclusiveReset(restricted.toString(), 3000))
    assert.equal((await admin.query('SELECT datallowconn FROM pg_database WHERE datname=$1', [name])).rows[0].datallowconn, true)
    const verify = new pg.Client({ connectionString: config.toString() }); await verify.connect()
    assert.equal((await verify.query('SELECT id FROM public.keep')).rows[0].id, 42)
    await verify.end()
  } finally {
    if (dbCreated) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`)
    if (roleCreated) await admin.query(`DROP ROLE "${role}"`)
    await admin.end()
  }
})

test('реальная PostgreSQL: подготовленная транзакция блокирует полный сброс', { skip: !url, timeout: 30000 }, async (t) => {
  const config = new URL(url)
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(config.hostname)); assert.equal(config.search, '')
  const suffix = randomBytes(8).toString('hex'), name = `kit_test_${suffix}`, gid = `kit_prepared_${suffix}`
  const admin = new pg.Client({ connectionString: url }); admin.on('error', () => {}); await admin.connect()
  let created = false, prepared = false
  try {
    const setting = await admin.query('SHOW max_prepared_transactions')
    if (Number(setting.rows[0].max_prepared_transactions) === 0) { t.skip('сервер выключил prepared transactions'); return }
    await admin.query(`CREATE DATABASE "${name}"`); created = true; config.pathname = `/${name}`
    const setup = new pg.Client({ connectionString: config.toString() }); setup.on('error', () => {}); await setup.connect()
    await setup.query('CREATE TABLE public.keep(id int); INSERT INTO public.keep VALUES(7)')
    await setup.query('BEGIN'); await setup.query('INSERT INTO public.keep VALUES(8)')
    await setup.query(`PREPARE TRANSACTION '${gid}'`); prepared = true; await setup.end()
    await assert.rejects(exclusiveReset(config.toString(), 3000), /подготовленные транзакции/)
    assert.equal((await admin.query('SELECT datallowconn FROM pg_database WHERE datname=$1', [name])).rows[0].datallowconn, true)
    const verify = new pg.Client({ connectionString: config.toString() }); verify.on('error', () => {}); await verify.connect()
    await verify.query(`ROLLBACK PREPARED '${gid}'`); prepared = false
    assert.equal((await verify.query('SELECT id FROM public.keep')).rows[0].id, 7)
    await verify.end()
  } finally {
    if (prepared) { const client = new pg.Client({ connectionString: config.toString() }); await client.connect(); await client.query(`ROLLBACK PREPARED '${gid}'`); await client.end() }
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`)
    await admin.end()
  }
})

test('реальная PostgreSQL: PREPARE во время ожидания сеанса запрещает reset до DDL', { skip: !url, timeout: 30000 }, async (t) => {
  const config = new URL(url)
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(config.hostname)); assert.equal(config.search, '')
  const suffix = randomBytes(8).toString('hex'), name = `kit_test_${suffix}`, gid = `kit_prepared_late_${suffix}`
  const admin = new pg.Client({ connectionString: url }); await admin.connect()
  let app, created = false, prepared = false, pendingReset
  try {
    if (Number((await admin.query('SHOW max_prepared_transactions')).rows[0].max_prepared_transactions) === 0) { t.skip('сервер выключил prepared transactions'); return }
    await admin.query(`CREATE DATABASE "${name}"`); created = true; config.pathname = `/${name}`
    app = new pg.Client({ connectionString: config.toString() }); app.on('error', () => {}); await app.connect()
    await app.query('CREATE TABLE public.keep(id int); INSERT INTO public.keep VALUES (1)')
    await app.query('BEGIN; INSERT INTO public.keep VALUES (2)')
    let disabled
    const ready = new Promise(resolve => { disabled = resolve })
    pendingReset = exclusiveReset(config.toString(), 5000, { afterDisabled: () => disabled() })
    void pendingReset.catch(() => {})
    await ready
    await app.query(`PREPARE TRANSACTION '${gid}'`); prepared = true
    await app.end(); app = undefined
    await assert.rejects(pendingReset, /подготовленные транзакции/)
    assert.equal((await admin.query('SELECT datallowconn FROM pg_database WHERE datname=$1', [name])).rows[0].datallowconn, true)
    const verify = new pg.Client({ connectionString: config.toString() }); await verify.connect()
    try {
      await verify.query(`ROLLBACK PREPARED '${gid}'`); prepared = false
      assert.deepEqual((await verify.query('SELECT id FROM public.keep ORDER BY id')).rows.map(r => r.id), [1])
    } finally { await verify.end() }
  } finally {
    await app?.end().catch(() => {})
    await pendingReset?.catch(() => {})
    if (prepared) { const c = new pg.Client({ connectionString: config.toString() }); await c.connect(); await c.query(`ROLLBACK PREPARED '${gid}'`); await c.end() }
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`)
    await admin.end()
  }
})

test('реальная PostgreSQL: SIGTERM при ожидании не прерывает действующее соединение', { skip: !url, timeout: 30000 }, async () => {
  const config = new URL(url); assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(config.hostname)); assert.equal(config.search, '')
  const name = `kit_test_${randomBytes(12).toString('hex')}`; const admin = new pg.Client({ connectionString: url }); await admin.connect()
  let app, child, created = false
  try {
    await admin.query(`CREATE DATABASE "${name}"`); created = true; config.pathname = `/${name}`
    app = new pg.Client({ connectionString: config.toString() }); app.on('error', () => {}); await app.connect()
    await app.query('CREATE TABLE public.keep(id int); BEGIN; INSERT INTO public.keep VALUES (3)')
    const script = `import { exclusiveReset } from './tooling/db-exclusive-lib.mjs'; await exclusiveReset(process.env.KIT_ISOLATED_TARGET, 5000, { afterDisabled: () => console.log('WAITING') });`
    child = spawn(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, KIT_ISOLATED_TARGET: config.toString() }, stdio: ['ignore', 'pipe', 'pipe'] })
    await new Promise((resolve, reject) => { let out = ''; child.stdout.on('data', chunk => { out += chunk; if (out.includes('WAITING')) resolve() }); child.once('exit', code => reject(new Error(`child exited before drain: ${code}`))) })
    assert.equal((await admin.query('SELECT datallowconn FROM pg_database WHERE datname=$1', [name])).rows[0].datallowconn, false)
    const exited = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await exited
    assert.equal((await admin.query('SELECT datallowconn FROM pg_database WHERE datname=$1', [name])).rows[0].datallowconn, true)
    await app.query('COMMIT')
    assert.equal((await app.query('SELECT id FROM public.keep')).rows[0].id, 3)
  } finally {
    child?.kill('SIGKILL'); await app?.end().catch(() => {})
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`)
    await admin.end()
  }
})

test('реальная PostgreSQL: build reset с занятым соединением отказывает без уничтожения данных', { skip: !url, timeout: 30000 }, async () => {
  const config = new URL(url); assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(config.hostname)); assert.equal(config.search, '')
  const name = `kit_test_${randomBytes(12).toString('hex')}`; const admin = new pg.Client({ connectionString: url }); await admin.connect()
  let app, created = false
  try {
    await admin.query(`CREATE DATABASE "${name}"`); created = true; config.pathname = `/${name}`
    app = new pg.Client({ connectionString: config.toString() }); app.on('error', () => {}); await app.connect()
    await app.query('CREATE TABLE public.keep(id int); INSERT INTO public.keep VALUES (5)')
    await app.query('BEGIN; INSERT INTO public.keep VALUES (6)')
    const result = spawnSync(process.execPath, ['tooling/db-reset.mjs'], { env: { ...process.env, DATABASE_RESET: '1', DATABASE_URL: config.toString(), HYPERDRIVE_CONNECTION_STRING: '', DB_CONNECT_TIMEOUT_MS: '300' }, encoding: 'utf8', timeout: 10000 })
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /прежние подключения не закрылись вовремя; сброс не начат/)
    assert.equal((await admin.query('SELECT datallowconn FROM pg_database WHERE datname=$1', [name])).rows[0].datallowconn, true)
    await app.query('COMMIT')
    assert.deepEqual((await app.query('SELECT id FROM public.keep ORDER BY id')).rows.map(r => r.id), [5, 6])
  } finally {
    await app?.end().catch(() => {})
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`)
    await admin.end()
  }
})

test('реальная PostgreSQL: преждевременное включение подключений запрещает reset до DDL', { skip: !url, timeout: 30000 }, async () => {
  const config = new URL(url); assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(config.hostname)); assert.equal(config.search, '')
  const name = `kit_test_${randomBytes(12).toString('hex')}`; const admin = new pg.Client({ connectionString: url }); await admin.connect()
  let created = false
  try {
    await admin.query(`CREATE DATABASE "${name}"`); created = true; config.pathname = `/${name}`
    const setup = new pg.Client({ connectionString: config.toString() }); await setup.connect()
    await setup.query('CREATE TABLE public.keep(id int); INSERT INTO public.keep VALUES(10)'); await setup.end()
    await assert.rejects(exclusiveReset(config.toString(), 3000, { afterDisabled: () => admin.query(`ALTER DATABASE "${name}" ALLOW_CONNECTIONS true`) }), /запрет новых подключений снят/)
    const verify = new pg.Client({ connectionString: config.toString() }); await verify.connect()
    try { assert.equal((await verify.query('SELECT id FROM public.keep')).rows[0].id, 10) } finally { await verify.end() }
  } finally { if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`); await admin.end() }
})
