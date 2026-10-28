/**
 * Права модели профиля на реальной БД: чтение и правка — владелец (и те, кому
 * выданы `profile.read`/`profile.edit`), создание — сервер. Это проверка
 * политики, а не api: контекст подставляется руками, как это делает
 * `gateway.server.ts` (`SYSTEM`, `principalOfRow`).
 *
 * Повод: серверный контекст перестал быть `['server','admin']` — теперь
 * `['server']`, и правила `ownerOrRoles` должны узнавать его отдельным именем,
 * а не через админа.
 */
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, it } from 'vitest'
import { conservativeLimits, createDb, type DbFailure } from '#lib/db/index.js'
import { pgliteAdapter } from '#lib/db/adapters/pglite.js'
import { defineSchema } from '#lib/db/sync/index.js'
import { auth, profile } from './schema.js'

const test = (name: string, fn: () => Promise<void>) => it(name, fn, 60_000)

const SEED = 'a'.repeat(43)

/** Серверный контекст адаптеров — как `SYSTEM` в `gateway.server.ts`. */
const SERVER = { principal: { roles: ['server'] } }
/** Владелец строки — как `principalOfRow`: `id` аккаунта, роли = его права. */
const owner = (id: string, permissions: readonly string[] = []) => ({
  principal: { id, roles: [...permissions] },
})
/** Другой вошедший пользователь: свой id, свои права. */
const other = (permissions: readonly string[] = []) => ({
  principal: { id: crypto.randomUUID(), roles: [...permissions] },
})

const forbidden = (e: DbFailure) => e.kind === 'forbidden'

let shared: PGlite | undefined
afterAll(async () => {
  await shared?.close()
})

async function withDb(fn: (db: ReturnType<typeof createDb>) => Promise<void>) {
  shared ??= new PGlite()
  await shared.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  const driver = pgliteAdapter(shared)
  assert.equal((await defineSchema({ resources: [auth, profile] }).sync(driver)).status, 'ok')
  await fn(createDb({ driver, limits: conservativeLimits, resources: [auth, profile] }))
}

test('создание профиля — только сервер; чтение и правка — владелец', async () => {
  await withDb(async (db) => {
    const auths = db.resource(auth)
    const profiles = db.resource(profile)

    // аккаунт заводит сервер (вход)
    const row = (await auths.insert(SERVER, { seed: SEED })) as unknown as { id: string }
    const me = owner(row.id)

    // клиент свою строку не создаёт: `insert: roles(['server'])`
    await assert.rejects(
      () => profiles.insert(me, { auth_id: row.id, nickname: 'Вася' }),
      forbidden,
      'профиль создаёт не человек',
    )

    const made = (await profiles.insert(SERVER, { auth_id: row.id, nickname: 'Вася' })) as unknown as {
      id: string
    }

    // владелец видит и правит своё без всяких прав
    assert.equal((await profiles.select(me, { filter: { field: 'auth_id', op: 'eq', value: row.id } })).length, 1)
    await profiles.update(me, made.id, { nickname: 'Петя' })

    // чужой — не видит и не правит
    const stranger = other()
    assert.equal(
      (await profiles.select(stranger, { filter: { field: 'auth_id', op: 'eq', value: row.id } })).length,
      0,
      'чужая строка политикой не видна',
    )
    await assert.rejects(
      () => profiles.update(stranger, made.id, { nickname: 'Взлом' }),
      (e: DbFailure) => e.kind === 'not_found',
    )

    // выданное право чтения открывает строку, но не правку
    const reader = other(['profile.read'])
    assert.equal(
      (await profiles.select(reader, { filter: { field: 'auth_id', op: 'eq', value: row.id } })).length,
      1,
      'profile.read видит чужой профиль',
    )
    await assert.rejects(
      () => profiles.update(reader, made.id, { nickname: 'Нельзя' }),
      (e: DbFailure) => e.kind === 'not_found',
    )

    // право правки открывает и чтение, и запись
    const editor = other(['profile.edit'])
    assert.equal(
      (await profiles.select(editor, { filter: { field: 'auth_id', op: 'eq', value: row.id } })).length,
      1,
      'profile.edit включает чтение',
    )
    await profiles.update(editor, made.id, { nickname: 'Модератор' })

    // админ — по-прежнему всё
    const admin = other(['admin'])
    await profiles.update(admin, made.id, { nickname: 'Админ' })
    assert.equal((await profiles.select(admin, {})).length, 1)
  })
})

test('сервер без админа: видит строку auth и уносит профиль при смерти аккаунта', async () => {
  await withDb(async (db) => {
    const auths = db.resource(auth)
    const profiles = db.resource(profile)

    const row = (await auths.insert(SERVER, { seed: SEED })) as unknown as { id: string }

    // `ownerOrRoles('id', ['server', 'admin'])` — сервер узнаётся по своему имени
    const seen = await auths.select(SERVER, { filter: { field: 'id', op: 'eq', value: row.id } })
    assert.equal(seen.length, 1, 'SYSTEM без admin видит аккаунт')
    await auths.update(SERVER, row.id, { seed: null })

    const made = (await profiles.insert(SERVER, { auth_id: row.id })) as unknown as { id: string }
    // удаление профиля сервером разрешено только политикой `delete` (цепочка)
    await profiles.delete(SERVER, made.id, { hard: true })
    assert.equal((await profiles.select(SERVER, {})).length, 0)

    // а обычный пользователь чужую строку auth не видит
    assert.equal((await auths.select(other(), { filter: { field: 'id', op: 'eq', value: row.id } })).length, 0)
  })
})

test('срез свипа удалений: фильтр модели по deleted_at вместо выборки всех строк', async () => {
  await withDb(async (db) => {
    const auths = db.resource(auth)
    const gone = (await auths.insert(SERVER, { seed: SEED })) as unknown as { id: string }
    const alive = (await auths.insert(SERVER, { seed: 'b'.repeat(43) })) as unknown as { id: string }
    await auths.delete(SERVER, gone.id)

    // Тот же вызов, что `listDeletedBefore` в gateway: одно `lte` по метке
    // (NULL сравнению не удовлетворяет — действующие выпадают сами).
    const rows = await auths.select(SERVER, {
      includeDeleted: true,
      filter: { field: 'deleted_at', op: 'lte', value: new Date().toISOString() },
    })
    assert.deepEqual(rows.map((r) => r.id), [gone.id])
    void alive
  })
})
