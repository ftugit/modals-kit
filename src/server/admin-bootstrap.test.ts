/**
 * Первый администратор на настоящей БД: заводится один раз, получает `admin`
 * в правах, повторный запуск ничего не создаёт.
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

test('повторный запуск администратора не плодит', async () => {
  await withDb(async (db) => {
    assert.ok(await ensureSeedAdmin(db))
    assert.equal(await ensureSeedAdmin(db), null)
    const rows = await db.resource(auth).select(SERVER, {})
    assert.equal(rows.length, 1)
  })
})
