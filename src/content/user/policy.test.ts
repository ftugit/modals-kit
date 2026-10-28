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
import { auth, config, profile } from './schema.js'

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
  assert.equal((await defineSchema({ resources: [auth, profile, config] }).sync(driver)).status, 'ok')
  await fn(createDb({ driver, limits: conservativeLimits, resources: [auth, profile, config] }))
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

test('конфиг-модель: новый ключ умолчания — только insert-роль; чтение — владелец и config.read', async () => {
  await withDb(async (db) => {
    const auths = db.resource(auth)
    const rows = db.resource(config)
    const me = (await auths.insert(SERVER, { seed: SEED })) as unknown as { id: string }
    const asMe = owner(me.id)
    const asReader = other(['config.read'])

    // клиент ключ умолчания не заводит: insert держат server/admin
    await assert.rejects(() => rows.insert(asMe, { auth_id: null, key: 'k1', value: 1 }), forbidden)

    await rows.insert(SERVER, { auth_id: null, key: 'k1', value: 'nobody', schema: { assign: ['admin'] } })
    await rows.insert(SERVER, { auth_id: me.id, key: 'k1', value: 'all' })

    // владелец видит свою строку; глобальная чужим без config.read не видна
    const mine = await rows.select(asMe)
    assert.deepEqual(mine.map((r) => r.value), ['all'])
    const read = await rows.select(asReader)
    assert.equal(read.length, 2)

    // прямая запись владельца в модель закрыта (работа — конфиг-API от системы)
    const own = mine[0] as unknown as { id: string }
    await assert.rejects(() => rows.update(asMe, own.id, { value: 'x' }), forbidden)
  })
})

test('приватность профиля (этап 8): строка видна по ключу конфига — гостю all, вошедшему users, nobody — никому', async () => {
  await withDb(async (db) => {
    const auths = db.resource(auth)
    const profiles = db.resource(profile)
    const rows = db.resource(config)
    const me = (await auths.insert(SERVER, { seed: SEED })) as unknown as { id: string }
    await profiles.insert(SERVER, { auth_id: me.id, nickname: 'Вася' })
    const guest = { principal: { roles: [] as string[] } }
    const stranger = other()

    const seen = async (ctx: typeof guest | typeof stranger) =>
      (await profiles.select(ctx)).length

    // без строки конфига — как раньше: чужим не видна
    assert.equal(await seen(guest), 0)
    assert.equal(await seen(stranger), 0)

    await rows.insert(SERVER, { auth_id: me.id, key: 'profile.visibility', value: 'all' })
    assert.equal(await seen(guest), 1)
    assert.equal(await seen(stranger), 1)

    await rows.update(SERVER, String((await rows.select(SERVER))[0]!.id), { value: 'users' })
    assert.equal(await seen(guest), 0)
    assert.equal(await seen(stranger), 1)

    await rows.update(SERVER, String((await rows.select(SERVER))[0]!.id), { value: 'nobody' })
    assert.equal(await seen(guest), 0)
    assert.equal(await seen(stranger), 0)
    // владелец свою строку видит при любом уровне
    assert.equal((await profiles.select(owner(me.id))).length, 1)
  })
})
