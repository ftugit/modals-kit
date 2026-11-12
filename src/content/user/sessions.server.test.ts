/**
 * Этап 2: устройства через модель. PGlite, без кук и без `SYSTEM` в человеческих вызовах.
 */
import { PGlite } from '@electric-sql/pglite'
import { afterAll, expect, it } from 'vitest'
import { conservativeLimits, createDb, type Database } from '#lib/db/index.js'
import { pgliteAdapter } from '#lib/db/adapters/pglite.js'
import { defineSchema } from '#lib/db/sync/index.js'
import { SERVER } from './auth.js'
import { auth, session } from './schema.js'
import { SESSIONS_COUNTRY_NONE } from './types.js'
import {
  listSessionsPage,
  readSessionDetail,
  renameSessionDevice,
  revokeBulkSessions,
  revokeSessionById,
  SESSIONS_BULK_IDS_LIMIT,
  type SessionActor,
  type SessionDeps,
} from './sessions.server.js'

const test = (name: string, fn: () => Promise<void>) => it(name, fn, 60_000)
const NOW = Date.parse('2026-11-07T12:00:00.000Z')

let shared: PGlite | undefined
afterAll(async () => {
  await shared?.close()
})

async function withDb(fn: (deps: SessionDeps) => Promise<void>) {
  shared ??= new PGlite()
  await shared.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  const driver = pgliteAdapter(shared)
  const resources = [auth, session]
  expect((await defineSchema({ resources }).sync(driver)).status).toBe('ok')
  const db = createDb({ driver, limits: conservativeLimits, resources })
  await fn({ db, now: NOW })
}

const actor = (id: string, permissions: readonly string[] = [], sessionId?: string | null): SessionActor => ({
  id,
  permissions,
  sessionId: sessionId ?? null,
})

async function account(db: Database, seed: string) {
  const row = await db.resource(auth).insert(SERVER, { seed })
  return String(row.id)
}

async function device(
  db: Database,
  authId: string,
  patch: { jti: string; name?: string; expiresAt?: number; country?: string },
) {
  const row = await db.resource(session).insert(SERVER, {
    auth_id: authId,
    jti: patch.jti,
    device_name: patch.name ?? null,
    country: patch.country ?? null,
    expires_at: new Date(patch.expiresAt ?? NOW + 60_000).toISOString(),
    subnet_history: [{ hash: 'old', country: 'SG', at: NOW - 1_000 }],
  })
  return String(row.id)
}

test('владелец видит свои живые, не видит jti и не открывает журнал', async () => {
  await withDb(async (deps) => {
    const me = await account(deps.db, 'a'.repeat(43))
    const them = await account(deps.db, 'b'.repeat(43))
    const current = await device(deps.db, me, { jti: 'owner-device-token-021', name: 'телефон' })
    await device(deps.db, me, { jti: 'owner-expired-token-21', name: 'старый', expiresAt: NOW - 60_000 })
    await device(deps.db, them, { jti: 'other-device-token-021', name: 'чужой' })
    const meActor = actor(me, [], current)

    const page = await listSessionsPage(meActor, {}, deps)
    expect(page.ok).toBe(true)
    if (!page.ok) return
    expect(page.value.items.map((item) => item.deviceName)).toEqual(['телефон'])
    expect(page.value.items[0]?.current).toBe(true)
    expect(JSON.stringify(page.value)).not.toContain('owner-device-token-021')
    expect(page.value.items.every((item) => !('jti' in item) && !('version' in item))).toBe(true)
    expect(page.value.items[0]?.history[0]?.hash).toBe('old')

    expect((await listSessionsPage(meActor, { journal: true }, deps)).ok).toBe(false)
    expect((await listSessionsPage(meActor, { authId: them }, deps)).ok).toBe(false)
  })
})

test('страницы возвращают все 31 активную сессию без пересечений', async () => {
  await withDb(async (deps) => {
    const me = await account(deps.db, 'f'.repeat(43))
    const ids: string[] = []
    for (let i = 0; i < 31; i++) {
      ids.push(await device(deps.db, me, { jti: `pagination-device-token-${String(i).padStart(3, '0')}` }))
    }
    const first = await listSessionsPage(actor(me, [], ids[0]), { page: 1 }, deps)
    const second = await listSessionsPage(actor(me, [], ids[0]), { page: 2 }, deps)
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(first.value.total).toBe(31)
    expect(first.value.items).toHaveLength(30)
    expect(second.value.items).toHaveLength(1)
    expect(new Set([...first.value.items, ...second.value.items].map((item) => item.id))).toEqual(new Set(ids))
  })
})

test('чтение, правка, отозванные и жёсткое удаление держат круг', async () => {
  await withDb(async (deps) => {
    const me = await account(deps.db, 'c'.repeat(43))
    const id = await device(deps.db, me, { jti: 'reader-device-token-21', name: 'ноутбук', country: 'SG' })
    const reader = actor('reader-account', ['session.read'])
    const editor = actor('editor-account', ['session.edit'])
    const deletedOnly = actor('deleted-account', ['session.readDeleted'])
    const auditor = actor('auditor-account', ['session.read', 'session.readDeleted'])
    const admin = actor('admin-account', ['admin'])

    const journal = await listSessionsPage(reader, { journal: true, state: 'all' }, deps)
    expect(journal.ok).toBe(true)
    if (!journal.ok) return
    expect(journal.value.items).toHaveLength(1)
    expect(JSON.stringify(journal.value)).not.toContain('reader-device-token-21')

    const foreign = await listSessionsPage(reader, { authId: me, state: 'all' }, deps)
    expect(foreign.ok && foreign.value.total).toBe(1)
    expect((await listSessionsPage(reader, { authId: crypto.randomUUID() }, deps)).ok).toBe(false)
    const missing = await listSessionsPage(reader, { authId: crypto.randomUUID() }, deps)
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.fact.code).toBe('auth.identity-unknown')

    const renamedDenied = await renameSessionDevice(reader, id, 'нет', deps)
    expect(renamedDenied.ok).toBe(false)
    if (!renamedDenied.ok) expect(renamedDenied.fact.code).toBe('auth.forbidden')
    const revokedDenied = await revokeSessionById(reader, id, deps)
    expect(revokedDenied.ok).toBe(false)
    if (!revokedDenied.ok) expect(revokedDenied.fact.code).toBe('auth.forbidden')

    const renamed = await renameSessionDevice(editor, id, '  ', deps)
    expect(renamed.ok).toBe(true)
    if (!renamed.ok) return
    expect(renamed.value.deviceName).toBeNull()

    const hardDenied = await revokeSessionById(editor, id, deps, { hard: true })
    expect(hardDenied.ok).toBe(false)
    if (!hardDenied.ok) expect(hardDenied.fact.code).toBe('auth.forbidden')
    expect((await deps.db.resource(session).select(SERVER, { filter: { field: 'id', op: 'eq', value: id } })).length).toBe(1)

    const revoked = await revokeSessionById(editor, id, deps)
    expect(revoked.ok).toBe(true)
    expect((await listSessionsPage(deletedOnly, { journal: true, state: 'revoked' }, deps)).ok).toBe(false)
    const hidden = await listSessionsPage(reader, { journal: true, state: 'revoked' }, deps)
    expect(hidden.ok).toBe(true)
    if (!hidden.ok) return
    expect(hidden.value.state).toBe('all')
    expect(hidden.value.items).toHaveLength(0)

    const seen = await listSessionsPage(auditor, { journal: true, state: 'revoked' }, deps)
    expect(seen.ok).toBe(true)
    if (!seen.ok) return
    expect(seen.value.items.map((item) => item.id)).toEqual([id])
    expect(JSON.stringify(seen.value)).not.toContain('reader-device-token-21')

    const wiped = await revokeSessionById(admin, id, deps, { hard: true })
    expect(wiped.ok).toBe(true)
    if (!wiped.ok) return
    expect(wiped.value.hard).toBe(true)
    expect((await deps.db.resource(session).select(SERVER, {
      includeDeleted: true,
      filter: { field: 'id', op: 'eq', value: id },
    })).length).toBe(0)
  })
})

test('чужой uuid не отличим от пустого; пакетный отзыв исключает текущую только в others', async () => {
  await withDb(async (deps) => {
    const me = await account(deps.db, 'd'.repeat(43))
    const current = await device(deps.db, me, { jti: 'bulk-current-token-021', name: 'эта' })
    const other = await device(deps.db, me, { jti: 'bulk-other-token-02121', name: 'та' })
    const meActor = actor(me, [], current)

    const empty = await readSessionDetail(meActor, '', deps)
    const foreign = await readSessionDetail(meActor, crypto.randomUUID(), deps)
    expect(empty.ok).toBe(false)
    expect(foreign.ok).toBe(false)
    if (!empty.ok && !foreign.ok) expect(foreign.fact.code).toBe(empty.fact.code)

    const unknown = await revokeBulkSessions(actor(me), { scope: 'others' }, deps)
    expect(unknown).toMatchObject({ ok: false, fact: { code: 'auth.session-unknown' } })
    const before = await listSessionsPage(meActor, { state: 'all' }, deps)
    expect(before.ok && before.value.items).toHaveLength(2)

    const kept = await revokeBulkSessions(meActor, { scope: 'others' }, deps)
    expect(kept.ok).toBe(true)
    if (!kept.ok) return
    expect(kept.value).toEqual({ revoked: 1, current: false })
    const live = await listSessionsPage(meActor, { state: 'all' }, deps)
    expect(live.ok).toBe(true)
    if (!live.ok) return
    expect(live.value.items.map((item) => item.id)).toEqual([current])

    const all = await revokeBulkSessions(meActor, { scope: 'all' }, deps)
    expect(all.ok).toBe(true)
    if (!all.ok) return
    expect(all.value.current).toBe(true)
    expect(all.value.revoked).toBe(1)
    expect(other).not.toBe(current)
  })
})

test('all без известной текущей сессии доступен после отказа others', async () => {
  await withDb(async (deps) => {
    const me = await account(deps.db, 'c'.repeat(43))
    await device(deps.db, me, { jti: 'bulk-nosession-token-021', name: 'та' })
    const noSession = actor(me, [])
    const denied = await revokeBulkSessions(noSession, { scope: 'others' }, deps)
    expect(denied).toMatchObject({ ok: false, fact: { code: 'auth.session-unknown' } })
    const live = await listSessionsPage(noSession, { state: 'all' }, deps)
    expect(live.ok && live.value.items).toHaveLength(1)
    const all = await revokeBulkSessions(noSession, { scope: 'all' }, deps)
    expect(all.ok).toBe(true)
    if (all.ok) expect(all.value.revoked).toBe(1)
  })
})

test('пакетный отзыв по набору id: only закрывает перечисленное, пустой набор — отказ', async () => {
  await withDb(async (deps) => {
    const me = await account(deps.db, 'e'.repeat(43))
    const them = await account(deps.db, 'f'.repeat(43))
    const current = await device(deps.db, me, { jti: 'set-current-token-0021', name: 'эта' })
    const other = await device(deps.db, me, { jti: 'set-other-token-00211', name: 'та' })
    const third = await device(deps.db, me, { jti: 'set-third-token-00211', name: 'третья' })
    const foreign = await device(deps.db, them, { jti: 'set-foreign-token-0021', name: 'чужая' })
    const meActor = actor(me, [], current)

    // Пустой `only` — не «закрыть всё», а отказ. Это главная ловушка набора.
    const empty = await revokeBulkSessions(meActor, { scope: 'all', pick: 'only', ids: [] }, deps)
    expect(empty).toMatchObject({ ok: false, fact: { code: 'auth.session-unknown' } })
    const survivedEmpty = await listSessionsPage(meActor, { state: 'all' }, deps)
    expect(survivedEmpty.ok && survivedEmpty.value.items).toHaveLength(3)

    // Мусор не проходит в набор и не роняет вызов: один годный id — закрыт один.
    const one = await revokeBulkSessions(meActor, {
      scope: 'all',
      pick: 'only',
      ids: ['мусор', '', '  ', other, other],
    }, deps)
    expect(one.ok).toBe(true)
    if (!one.ok) return
    expect(one.value.revoked).toBe(1)
    expect(one.value.requested).toBe(1)

    // Чужой id не закрывается: набор ограничен `auth_id` цели.
    const withForeign = await revokeBulkSessions(meActor, {
      scope: 'all',
      pick: 'only',
      ids: [foreign, third],
    }, deps)
    expect(withForeign.ok).toBe(true)
    if (!withForeign.ok) return
    expect(withForeign.value.requested).toBe(2)
    expect(withForeign.value.revoked).toBe(1)

    const left = await listSessionsPage(meActor, { state: 'all' }, deps)
    expect(left.ok).toBe(true)
    if (!left.ok) return
    expect(left.value.items.map((item) => item.id)).toEqual([current])

    const foreignLeft = await deps.db.resource(session).select(SERVER, {
      filter: { field: 'id', op: 'eq', value: foreign },
    })
    expect(foreignLeft).toHaveLength(1)
  })
})

test('пакетный отзыв по набору id: except закрывает всё, кроме перечисленного', async () => {
  await withDb(async (deps) => {
    const me = await account(deps.db, 'a'.repeat(43))
    const current = await device(deps.db, me, { jti: 'exc-current-token-0021', name: 'эта' })
    const other = await device(deps.db, me, { jti: 'exc-other-token-00211', name: 'та' })
    const meActor = actor(me, [], current)

    // Исключили текущую — закрылась одна, `current` не поднимался.
    const keepCurrent = await revokeBulkSessions(meActor, {
      scope: 'others',
      pick: 'except',
      ids: [current],
    }, deps)
    expect(keepCurrent.ok).toBe(true)
    if (!keepCurrent.ok) return
    expect(keepCurrent.value.revoked).toBe(1)
    expect(keepCurrent.value.current).toBe(false)

    // Исключений нет — закрывается и текущая: набор полностью заменяет `scope`.
    const all = await revokeBulkSessions(meActor, { scope: 'others', pick: 'except', ids: [] }, deps)
    expect(all.ok).toBe(true)
    if (!all.ok) return
    expect(all.value.revoked).toBe(1)
    expect(all.value.current).toBe(true)

    const left = await listSessionsPage(meActor, { state: 'all' }, deps)
    expect(left.ok && left.value.items).toHaveLength(0)
    expect(other).not.toBe(current)
  })
})

test('пакетный отзыв по набору id: предел набора — отказ, а не усечение', async () => {
  await withDb(async (deps) => {
    const me = await account(deps.db, 'b'.repeat(43))
    const current = await device(deps.db, me, { jti: 'lim-current-token-0021', name: 'эта' })
    const meActor = actor(me, [], current)
    const over = Array.from({ length: SESSIONS_BULK_IDS_LIMIT + 1 }, () => crypto.randomUUID())

    for (const pick of ['only', 'except'] as const) {
      const denied = await revokeBulkSessions(meActor, { scope: 'all', pick, ids: over }, deps)
      expect(denied).toMatchObject({ ok: false, fact: { code: 'auth.forbidden' } })
    }

    // Негативный контроль: при отказе ничего не закрылось.
    const left = await listSessionsPage(meActor, { state: 'all' }, deps)
    expect(left.ok && left.value.items).toHaveLength(1)
  })
})

test('пакетный отзыв по набору id: набор важнее scope и прав на чужой аккаунт не даёт', async () => {
  await withDb(async (deps) => {
    const me = await account(deps.db, 'c'.repeat(43))
    const them = await account(deps.db, 'd'.repeat(43))
    const mine = await device(deps.db, me, { jti: 'scope-mine-token-00211', name: 'моя' })
    const theirs = await device(deps.db, them, { jti: 'scope-their-token-0021', name: 'их' })

    // `pick` задан — он и определяет набор, `scope: 'others'` не исключает ничего сам.
    const meActor = actor(me, [])
    const picked = await revokeBulkSessions(meActor, {
      scope: 'others',
      authId: them,
      pick: 'only',
      ids: [theirs],
    }, deps)
    expect(picked).toMatchObject({ ok: false, fact: { code: 'auth.forbidden' } })

    // Админ с правом на чужой аккаунт закрывает перечисленную строку цели.
    const admin = await revokeBulkSessions(actor(me, ['admin']), {
      scope: 'all',
      authId: them,
      pick: 'only',
      ids: [theirs],
    }, deps)
    expect(admin.ok).toBe(true)
    if (!admin.ok) return
    expect(admin.value.revoked).toBe(1)
    // При `uid` текущей считается только своя строка: чужая не поднимает `current`.
    expect(admin.value.current).toBe(false)

    const mineLeft = await deps.db.resource(session).select(SERVER, {
      filter: { field: 'id', op: 'eq', value: mine },
    })
    expect(mineLeft).toHaveLength(1)
  })
})

test('сервер пишет свой id сессии только без protect', async () => {
  await withDb(async ({ db }) => {
    const authId = await account(db, 'e'.repeat(43))
    const id = '00000000-0000-4000-8000-0000000000bb'
    const row = {
      id,
      auth_id: authId,
      jti: 'server-device-token-021',
      device_name: null,
      subnet_hash: null,
      country: null,
      subnet_history: [] as unknown[],
      version: 0,
      expires_at: new Date(NOW + 60_000).toISOString(),
      last_seen_at: new Date(NOW).toISOString(),
    }
    await expect(db.resource(session).insert(SERVER, row)).rejects.toMatchObject({ kind: 'forbidden' })
    const inserted = await db.resource(session).without(['protect'], (m) => m.insert(SERVER, row))
    expect(inserted.id).toBe(id)
    const found = await db.resource(session).select(SERVER, { filter: { field: 'jti', op: 'eq', value: row.jti } })
    expect(found.map((item) => item.id)).toEqual([id])
  })
})

test('фильтры среза: страна, смена сети, диапазоны и подсказка стран', async () => {
  await withDb(async (deps) => {
    const me = await account(deps.db, 'g'.repeat(43))
    const ru = await device(deps.db, me, { jti: 'filter-country-ru-001', name: 'ru', country: 'RU' })
    await device(deps.db, me, { jti: 'filter-country-sg-001', name: 'sg', country: 'SG' })
    await device(deps.db, me, { jti: 'filter-country-none-01', name: 'без страны' })
    const meActor = actor(me, [], ru)

    const onlyRu = await listSessionsPage(meActor, { country: ['RU'] }, deps)
    expect(onlyRu.ok).toBe(true)
    if (!onlyRu.ok) return
    expect(onlyRu.value.items.map((item) => item.deviceName)).toEqual(['ru'])
    // Пункты стран считаются по срезу БЕЗ фильтра страны, поэтому видны все три.
    expect([...onlyRu.value.countries]).toEqual(['RU', 'SG', SESSIONS_COUNTRY_NONE])

    const unknown = await listSessionsPage(meActor, { country: [SESSIONS_COUNTRY_NONE] }, deps)
    expect(unknown.ok && unknown.value.items.map((item) => item.deviceName)).toEqual(['без страны'])

    // Устройство с пустой историей подсетей «сменой сети» не считается.
    await deps.db.resource(session).insert(SERVER, {
      auth_id: me,
      jti: 'filter-no-history-0001',
      device_name: 'чистый',
      expires_at: new Date(NOW + 60_000).toISOString(),
      subnet_history: [],
    })
    const changed = await listSessionsPage(meActor, { subnetChanged: true }, deps)
    expect(changed.ok).toBe(true)
    if (!changed.ok) return
    expect(new Set(changed.value.items.map((item) => item.deviceName))).toEqual(
      new Set(['ru', 'sg', 'без страны']),
    )

    // Активность не записана — в диапазон она не попадает.
    const seen = await listSessionsPage(meActor, { seenFrom: NOW - 60_000 }, deps)
    expect(seen.ok && seen.value.items).toHaveLength(0)

    // Начало диапазона в будущем отсекает всё созданное сейчас: `created_at`
    // ставит часы базы, а не константа теста.
    const future = await listSessionsPage(meActor, { createdFrom: Date.now() + 86_400_000 }, deps)
    expect(future.ok && future.value.items).toHaveLength(0)
  })
})
