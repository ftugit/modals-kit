/**
 * Первый администратор и предразвёртывание БД (`bootstrapDatabase`):
 * заводится один раз, получает `admin` в правах, не обманывается лимитом
 * страницы `pageSize: 20` поверх 100 демо-аккаунтов и поднимает все модели.
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
import { bootstrapDatabase, DB_LIMITS } from './db-spec.server.js'

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
  shared ??= new PGlite()
  await shared.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  const rawDriver = pgliteAdapter(shared)

  const first = await bootstrapDatabase(rawDriver)
  assert.ok(first.createdAdmin, 'на пустой БД администратор создан вместе со всеми моделями и сидами')

  const db = createDb({ driver: first.driver, limits: DB_LIMITS })
  const countRes = await db.query<{ total: number; admins: number }>({
    text: `SELECT count(*)::int AS total,
                  count(*) FILTER (WHERE 'admin' = ANY(permissions))::int AS admins
             FROM public.user_auth`,
  })
  assert.equal(countRes.rows[0]!.total, 101, '100 демо-аккаунтов + 1 администратор')
  assert.equal(countRes.rows[0]!.admins, 1)

  // Повторный вызов (имитация холодного старта рантайма после предразвёртывания на этапе сборки)
  const second = await bootstrapDatabase(rawDriver)
  assert.equal(second.createdAdmin, null, 'существующий админ среди 101 строки найден — дубль не создан')

  const afterRes = await db.query<{ admins: number }>({
    text: `SELECT count(*) FILTER (WHERE 'admin' = ANY(permissions))::int AS admins FROM public.user_auth`,
  })
  assert.equal(afterRes.rows[0]!.admins, 1)
})
