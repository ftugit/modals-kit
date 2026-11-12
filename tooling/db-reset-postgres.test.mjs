import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { spawn, spawnSync } from 'node:child_process'
import { resetPublicTables, resetPublicObjects } from './db-reset-lib.mjs'
import { exclusiveReset } from './db-exclusive-lib.mjs'

// Только по явному opt-in и только локальный тестовый кластер. Создаётся и
// удаляется новая БД со случайным именем; существующие БД не модифицируются.
// Пытается взять блокировку синхронизации схемы ровно тем выражением, что и
// src/lib/db/sync/index.ts: pg_advisory_xact_lock(hashtext(kit)::bigint).
async function probeLock(connectionString) {
  const client = new pg.Client({ connectionString })
  await client.connect()
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_xact_lock(hashtext($1)::bigint) AS ok', ['"public"."kit_schema"'])
    return rows[0].ok
  } finally { await client.end() }
}

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


test('реальная PostgreSQL: idle-соединение другого инстанса не мешает сбросу', { skip: !url, timeout: 30000 }, async () => {
  const config = new URL(url)
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(config.hostname)); assert.equal(config.search, '')
  const name = `kit_test_${randomBytes(12).toString('hex')}`
  const admin = new pg.Client({ connectionString: url }); await admin.connect()
  let app, created = false
  try {
    await admin.query(`CREATE DATABASE "${name}"`); created = true; config.pathname = `/${name}`
    app = new pg.Client({ connectionString: config.toString() }); app.on('error', () => {}); await app.connect()
    await app.query('CREATE TABLE public.old_data(id int); INSERT INTO public.old_data VALUES (1)')
    // Соединение остаётся открытым и простаивает: ровно состояние тёплого инстанса,
    // который не перевыпускался. DDL это не блокирует, поэтому сброс обязан пройти.
    const result = await exclusiveReset(config.toString(), 5000)
    assert.equal(result.tables, 1)
    assert.equal((await app.query("SELECT to_regclass('public.old_data') AS x")).rows[0].x, null)
  } finally {
    await app?.end().catch(() => {})
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`)
    await admin.end()
  }
})

test('реальная PostgreSQL: сброс держит ту же блокировку, что синхронизация схемы', { skip: !url, timeout: 30000 }, async () => {
  const config = new URL(url)
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(config.hostname)); assert.equal(config.search, '')
  const name = `kit_test_${randomBytes(12).toString('hex')}`
  const admin = new pg.Client({ connectionString: url }); await admin.connect()
  let release, created = false
  try {
    await admin.query(`CREATE DATABASE "${name}"`); created = true; config.pathname = `/${name}`
    const setup = new pg.Client({ connectionString: config.toString() }); await setup.connect()
    await setup.query('CREATE TABLE public.keep(id int)'); await setup.end()
    // Негативный контроль: проверка обязана видеть чужую блокировку. Берём её
    // сами — до запуска сброса, иначе контроль встанет в очередь за сбросом,
    // и они взаимно заблокируют друг друга.
    const witness = new pg.Client({ connectionString: config.toString() }); await witness.connect()
    try {
      await witness.query('BEGIN')
      await witness.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', ['"public"."kit_schema"'])
      assert.equal(await probeLock(config.toString()), false, 'контроль: чужая блокировка должна быть видна')
      await witness.query('COMMIT')
    } finally { await witness.end() }
    // Второй полюс контроля: без держателя блокировка свободна.
    assert.equal(await probeLock(config.toString()), true, 'контроль: без держателя блокировка свободна')

    // afterExclusive вызывается уже после взятия блокировки — ждём именно этот момент.
    let signal; const locked = new Promise((resolve) => { signal = resolve })
    const gate = new Promise((resolve) => { release = resolve })
    const pending = exclusiveReset(config.toString(), 5000, { afterExclusive: async () => { signal(); await gate } })
    void pending.catch(() => {})
    await locked
    // Пока сброс не отпустил блокировку, sync ни на одном инстансе не пройдёт:
    // иначе живой инстанс пересоздаст таблицы посреди DROP.
    assert.equal(await probeLock(config.toString()), false, 'сброс должен удерживать блокировку синхронизации')
    release()
    await pending
  } finally {
    release?.()
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`)
    await admin.end()
  }
})

test('реальная PostgreSQL: активная транзакция на сбрасываемых таблицах — сброс отказывает, данные целы', { skip: !url, timeout: 30000 }, async () => {
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
    // lock_timeout, а не ожидание закрытия соединения: транзакция жива, DDL ждать не может.
    await assert.rejects(exclusiveReset(config.toString(), 500), (e) => e.code === '55P03')
    assert.equal((await app.query('SELECT count(*)::int AS n FROM public.keep')).rows[0].n, 2)
    await app.query('COMMIT'); await app.end(); app = undefined
    // После освобождения тот же сброс проходит.
    const result = await exclusiveReset(config.toString(), 5000)
    assert.equal(result.tables, 1)
  } finally {
    await app?.end().catch(() => {})
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`)
    await admin.end()
  }
})

test('реальная PostgreSQL: сбой сброса откатывает изменения и не закрывает доступ к базе', { skip: !url, timeout: 30000 }, async () => {
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


test('реальная PostgreSQL: SIGTERM во время эксклюзивной фазы откатывает транзакцию, база остаётся доступной', { skip: !url, timeout: 15000 }, async () => {
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
    const exit = new Promise((resolve) => child.once('exit', resolve))
    child.kill('SIGTERM'); await exit
    assert.equal((await admin.query('SELECT datallowconn FROM pg_database WHERE datname=$1', [name])).rows[0].datallowconn, true)
    const verify = new pg.Client({ connectionString: config.toString() }); await verify.connect()
    try { assert.equal((await verify.query('SELECT id FROM public.keep')).rows[0].id, 9) } finally { await verify.end() }
  } finally { child?.kill('SIGKILL'); if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`); await admin.end() }
})

test('реальная PostgreSQL: сброс не требует второй БД — роль без доступа к postgres чистит свою базу', { skip: !url, timeout: 30000 }, async () => {
  const config = new URL(url)
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(config.hostname)); assert.equal(config.search, '')
  const admin = new pg.Client({ connectionString: url }); await admin.connect()
  const role = `kit_no_pg_${randomBytes(6).toString('hex')}`
  const name = `kit_test_${randomBytes(12).toString('hex')}`
  let created = false
  try {
    await admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${role}_pw'`)
    await admin.query(`CREATE DATABASE "${name}" OWNER "${role}"`); created = true
    await admin.query('REVOKE CONNECT ON DATABASE postgres FROM PUBLIC')
    const restricted = new URL(config.toString())
    restricted.username = role; restricted.password = `${role}_pw`; restricted.pathname = `/${name}`
    const setup = new pg.Client({ connectionString: restricted.toString() }); await setup.connect()
    await setup.query('CREATE TABLE public.keep(id int); INSERT INTO public.keep VALUES (3)'); await setup.end()
    // Именно здесь старая реализация и падала: maintenance-база postgres недоступна.
    const denied = new pg.Client({ connectionString: restricted.toString().replace(`/${name}`, '/postgres'), connectionTimeoutMillis: 1000 })
    try { await assert.rejects(denied.connect()) } finally { await denied.end().catch(() => {}) }
    const result = await exclusiveReset(restricted.toString(), 5000)
    assert.equal(result.tables, 1)
    const verify = new pg.Client({ connectionString: restricted.toString() }); await verify.connect()
    try { assert.equal((await verify.query("SELECT to_regclass('public.keep') AS x")).rows[0].x, null) } finally { await verify.end() }
  } finally {
    await admin.query('GRANT CONNECT ON DATABASE postgres TO PUBLIC')
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`)
    await admin.query(`DROP ROLE IF EXISTS "${role}"`)
    await admin.end()
  }
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

test('реальная PostgreSQL: роль без права CREATE на public не изменяет данные', { skip: !url, timeout: 30000 }, async () => {
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
    // Право CREATE на схему НЕ выдаём — именно это теперь обязательное условие.
    await setup.query(`CREATE TABLE public.keep(id int); INSERT INTO public.keep VALUES(42); GRANT USAGE ON SCHEMA public TO "${role}"`)
    await setup.end()
    const restricted = new URL(config); restricted.username = role; restricted.password = 'isolated-test-only'
    await assert.rejects(exclusiveReset(restricted.toString(), 3000), /нет права CREATE на схему public/)
    const child = spawnSync(process.execPath, ['tooling/db-reset.mjs'], { env: { ...process.env, DATABASE_RESET: '1', DATABASE_URL: restricted.toString(), HYPERDRIVE_CONNECTION_STRING: '' }, encoding: 'utf8', timeout: 10000 })
    assert.equal(child.status, 1)
    assert.match(child.stderr, /нет права CREATE на схему public/)
    assert.doesNotMatch(child.stderr, /isolated-test-only/)
    const verify = new pg.Client({ connectionString: config.toString() }); await verify.connect()
    assert.equal((await verify.query('SELECT id FROM public.keep')).rows[0].id, 42)
    await verify.end()
  } finally {
    if (dbCreated) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`)
    if (roleCreated) await admin.query(`DROP ROLE "${role}"`)
    await admin.end()
  }
})

test('реальная PostgreSQL: managed-провайдер — роль не владеет БД, в public стоит расширение', { skip: !url, timeout: 30000 }, async (t) => {
  // Ровно конфигурация Clever Cloud: приложение подключается ролью, которая не
  // владеет базой и не суперпользователь, а в public живут объекты расширений,
  // принадлежащие другой роли. Сброс должен очистить только свои объекты.
  const config = new URL(url)
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(config.hostname)); assert.equal(config.search, '')
  const suffix = randomBytes(8).toString('hex')
  const name = `kit_test_${suffix}`, role = `kit_role_${suffix}`, owner = `kit_owner_${suffix}`
  const admin = new pg.Client({ connectionString: url }); await admin.connect()
  let dbCreated = false
  try {
    // Роль приложения НЕ входит в роль-владельца: иначе pg_has_role(...'USAGE')
    // вернёт true и фикстура перестанет воспроизводить managed-провайдера.
    await admin.query(`CREATE ROLE "${owner}" NOLOGIN`)
    await admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD 'isolated-test-only'`)
    await admin.query(`CREATE DATABASE "${name}" OWNER "${owner}"`); dbCreated = true
    config.pathname = `/${name}`
    const setup = new pg.Client({ connectionString: config.toString() }); await setup.connect()
    // Расширение ставим в public: так же, как pg_stat_statements у провайдера.
    try { await setup.query('CREATE EXTENSION IF NOT EXISTS hstore SCHEMA public') }
    catch { t.skip('расширение hstore недоступно на сервере'); return }
    await setup.query(`GRANT CREATE, USAGE ON SCHEMA public TO "${role}"`)
    await setup.query(`SET ROLE "${role}"; CREATE TABLE public.app_data(id int); INSERT INTO public.app_data VALUES(7); CREATE VIEW public.app_view AS SELECT * FROM public.app_data; RESET ROLE`)
    await setup.end()

    const app = new URL(config); app.username = role; app.password = 'isolated-test-only'
    const probe = new pg.Client({ connectionString: app.toString() }); await probe.connect()
    // Негативный контроль фикстуры: роль действительно не владеет базой.
    const rights = await probe.query("SELECT (SELECT pg_has_role(current_user, datdba, 'USAGE') FROM pg_database WHERE datname=current_database()) AS is_owner, (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser")
    assert.equal(rights.rows[0].is_owner, false, 'фикстура: роль не должна владеть базой')
    assert.equal(rights.rows[0].superuser, false)
    await probe.end()

    // Объекты расширения фиксируем до сброса, чтобы сверить после по именам.
    const before = new pg.Client({ connectionString: app.toString() }); await before.connect()
    let extensionObjects = [], schemaOwner
    try {
      const { rows } = await before.query(`SELECT p.proname FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public'
          AND EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid='pg_catalog.pg_proc'::regclass
            AND d.objid=p.oid AND d.refclassid='pg_catalog.pg_extension'::regclass AND d.deptype='e')
        ORDER BY 1`)
      extensionObjects = rows.map((r) => r.proname)
      const meta = await before.query("SELECT pg_get_userbyid(nspowner) AS o FROM pg_namespace WHERE nspname='public'")
      schemaOwner = meta.rows[0].o
    } finally { await before.end() }
    assert.ok(extensionObjects.length > 0, 'фикстура: расширение должно создать объекты в public')

    const result = await exclusiveReset(app.toString(), 5000)
    assert.equal(result.tables, 1, 'удалена только своя таблица')
    assert.equal(result.views, 1)
    // Счётчики считают только свои объекты: объекты расширения в них не входят.
    assert.equal(result.routines, 0, 'процедуры расширения не должны попадать в счётчик удаления')

    const verify = new pg.Client({ connectionString: app.toString() }); await verify.connect()
    try {
      assert.equal((await verify.query("SELECT to_regclass('public.app_data') AS x")).rows[0].x, null)
      assert.equal((await verify.query("SELECT to_regclass('public.app_view') AS x")).rows[0].x, null)
      // Расширение и его объекты должны остаться нетронутыми: hstore — это тип,
      // а его функции лежат в public и принадлежат расширению.
      assert.equal((await verify.query("SELECT to_regtype('public.hstore')::text AS x")).rows[0].x, 'hstore')
      const { rows: after } = await verify.query(`SELECT p.proname FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY 1`)
      assert.deepEqual(after.map((r) => r.proname), extensionObjects, 'объекты расширения должны сохраниться')
      // Схема public и её владелец не изменились. В PostgreSQL 15+ схема public
      // принадлежит служебной роли pg_database_owner, поэтому имя не угадываем,
      // а сверяем с тем, что было до сброса.
      assert.equal((await verify.query("SELECT pg_get_userbyid(nspowner) AS o FROM pg_namespace WHERE nspname='public'")).rows[0].o, schemaOwner)
    } finally { await verify.end() }
  } finally {
    if (dbCreated) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`)
    await admin.query(`DROP OWNED BY "${owner}"`).catch(() => {})
    await admin.query(`DROP ROLE IF EXISTS "${role}"`); await admin.query(`DROP ROLE IF EXISTS "${owner}"`)
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

test('реальная PostgreSQL: build reset проходит при живом соединении другого инстанса', { skip: !url, timeout: 20000 }, async () => {
  const config = new URL(url)
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(config.hostname)); assert.equal(config.search, '')
  const name = `kit_test_${randomBytes(12).toString('hex')}`
  const admin = new pg.Client({ connectionString: url }); await admin.connect()
  let app, created = false
  try {
    await admin.query(`CREATE DATABASE "${name}"`); created = true; config.pathname = `/${name}`
    app = new pg.Client({ connectionString: config.toString() }); app.on('error', () => {}); await app.connect()
    await app.query('CREATE TABLE public.keep(id int); INSERT INTO public.keep VALUES (4)')
    const child = spawnSync(process.execPath, ['tooling/db-reset.mjs'], {
      env: { ...process.env, DATABASE_RESET: 'yes', DATABASE_URL: config.toString(), HYPERDRIVE_CONNECTION_STRING: '' },
      encoding: 'utf8', timeout: 15000,
    })
    assert.equal(child.status, 0, child.stderr || child.stdout)
    assert.match(child.stdout, /\[db-reset\] public очищена/)
    // Живое соединение не убивали: оно просто видит опустевшую схему.
    assert.equal((await app.query("SELECT to_regclass('public.keep') AS x")).rows[0].x, null)
  } finally {
    await app?.end().catch(() => {})
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`)
    await admin.end()
  }
})