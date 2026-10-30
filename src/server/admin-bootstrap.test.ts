/**
 * Первый администратор на настоящей БД: заводится один раз при открытии БД
 * в рантайме, получает `admin` в правах и не обманывается лимитом страницы
 * `pageSize: 20` поверх 100 демо-аккаунтов.
 */
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, it } from 'vitest'
import { conservativeLimits, createDb } from '#lib/db/index.js'
import { pgliteAdapter } from '#lib/db/adapters/pglite.js'
import { defineSchema } from '#lib/db/sync/index.js'
import { SERVER } from '#content/user/auth.js'
import { auth } from '#content/user/schema.js'
import { ensureSeedAdmin } from './admin-bootstrap.server.js'

const test = (name: string, fn: () => Promise<void>) => it(name, fn, 60_000)

let shared: PGlite | undefined
afterAll(async () => {
  await shared?.close()
})

async function withDb(fn: (db: ReturnType<typeof createDb>) => Promise<void>) {
  shared ??= new PGlite()
  await shared.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  const driver = pgliteAdapter(shared)
  assert.equal((await defineSchema({ resources: [auth] }).sync(driver)).status, 'ok')
  await fn(createDb({ driver, limits: conservativeLimits, resources: [auth] }))
}

test('схема появилась — администратор создан, seed настоящий и он же в БД', async () => {
  await withDb(async (db) => {
    const created = await ensureSeedAdmin(db)
    assert.ok(created, 'администратор создан')
    assert.equal(created.seed.length, 43, 'seed — base64url от 32 байт')
    assert.equal(created.secret.length, 43, 'ключ для входа тоже 32 байта')

    const rows = (await db.resource(auth).select(SERVER, {})) as unknown as {
      id: string
      seed: string | null
      permissions: string[]
    }[]
    assert.equal(rows.length, 1)
    assert.deepEqual(rows[0]!.permissions, ['admin'])
    assert.equal(rows[0]!.seed, created.seed, 'в БД лежит публичная половина')
    assert.notEqual(rows[0]!.seed, created.secret, 'приватная половина в БД не попадает')
  })
})

test('повторный запуск администратора не плодит даже при > pageSize (100 демо-аккаунтов)', async () => {
  await withDb(async (db) => {
    const created = await ensureSeedAdmin(db)
    assert.ok(created, 'первый вызов создаёт администратора')

    await db.query({
      text: `INSERT INTO public.user_auth (seed, permissions, subnet_salt, created_at, updated_at)
               SELECT 'demo-' || substr(md5('seed-' || n), 1, 19) || substr(md5('salt-' || n), 1, 19),
                      '{}',
                      substr(md5('sub-' || n), 1, 32),
                      clock_timestamp() - (n * interval '1 day'),
                      clock_timestamp() - (n * interval '1 day')
                 FROM generate_series(1, 100) n`,
    })

    const second = await ensureSeedAdmin(db)
    assert.equal(second, null, 'существующий админ среди 101 строки найден — дубль не создан')

    const countRes = await db.query<{ total: number; admins: number }>({
      text: `SELECT count(*)::int AS total,
                    count(*) FILTER (WHERE 'admin' = ANY(permissions))::int AS admins
               FROM public.user_auth`,
    })
    assert.equal(countRes.rows[0]!.total, 101, '100 демо-аккаунтов + 1 администратор')
    assert.equal(countRes.rows[0]!.admins, 1)
  })
})
