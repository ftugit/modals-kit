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
  sessionsWhere,
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

test('журнал: `admin` читает чужие устройства, актор без прав — нет', async () => {
  await withDb(async (deps) => {
    const me = await account(deps.db, 'a'.repeat(43))
    await device(deps.db, me, { jti: 'journal-admin-token-01', name: 'чужое для админа' })
    const admin = actor('admin-account', ['admin'])

    // Круг журнала — права без владельца строки: `admin` в него входит.
    const journalAdmin = await listSessionsPage(admin, { journal: true, state: 'all' }, deps)
    expect(journalAdmin.ok).toBe(true)
    if (!journalAdmin.ok) return
    expect(journalAdmin.value.items.map((item) => item.deviceName)).toEqual(['чужое для админа'])

    // Негативный контроль: без права журнал отказа, а не пустого списка.
    const journalNobody = await listSessionsPage(actor('plain-account', []), { journal: true }, deps)
    expect(journalNobody.ok).toBe(false)
    if (!journalNobody.ok) expect(journalNobody.fact.code).toBe('auth.forbidden')
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

test('чужой uuid не отличим от пустого; серверный набор исключает текущую по умолчанию', async () => {
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

    const before = await listSessionsPage(meActor, { state: 'all' }, deps)
    expect(before.ok && before.value.items).toHaveLength(2)

    // includeCurrent снят: текущая исключается сервером, без клиентских ids.
    const kept = await revokeBulkSessions(meActor, { where: { state: 'all' } }, deps)
    expect(kept.ok).toBe(true)
    if (!kept.ok) return
    expect(kept.value).toEqual({ revoked: 1, current: false, requested: 1 })
    const live = await listSessionsPage(meActor, { state: 'all' }, deps)
    expect(live.ok && live.value.items.map((item) => item.id)).toEqual([current])

    const all = await revokeBulkSessions(meActor, { where: { state: 'all' }, includeCurrent: true }, deps)
    expect(all.ok).toBe(true)
    if (!all.ok) return
    expect(all.value.current).toBe(true)
    expect(all.value.revoked).toBe(1)
    expect(other).not.toBe(current)
  })
})

test('серверный набор по фильтру: две из пяти, лишние строки аккаунта живы', async () => {
  await withDb(async (deps) => {
    const me = await account(deps.db, 'e'.repeat(43))
    const current = await device(deps.db, me, { jti: 'set-current-token-00211', name: 'эта', country: 'RU' })
    const ru2 = await device(deps.db, me, { jti: 'set-ru2-token-0021111', name: 'вторая', country: 'RU' })
    const de = await device(deps.db, me, { jti: 'set-de-token-00211111', name: 'третья', country: 'DE' })
    const none = await device(deps.db, me, { jti: 'set-none-token-002111', name: 'четвёртая' })
    const expired = await device(deps.db, me, { jti: 'set-exp-token-0021111', name: 'пятая', country: 'RU', expiresAt: NOW - 60_000 })
    const meActor = actor(me, [], current)

    const filtered = await listSessionsPage(meActor, { country: ['RU'], state: 'active' }, deps)
    expect(filtered.ok && filtered.value.items.map((i) => i.id).sort()).toEqual([current, ru2].sort())

    const r = await revokeBulkSessions(meActor, { where: { country: ['RU'], state: 'active' }, includeCurrent: true }, deps)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.requested).toBe(2)
    expect(r.value.revoked).toBe(2)
    expect(r.value.current).toBe(true)

    const left = await listSessionsPage(meActor, { state: 'all' }, deps)
    expect(left.ok && left.value.items.map((i) => i.id).sort()).toEqual([de, none, expired].sort())
  })
})

test('IDOR: серверный набор чужого аккаунта не закрывает строки другого аккаунта', async () => {
  await withDb(async (deps) => {
    const me = await account(deps.db, 'c'.repeat(43))
    const them = await account(deps.db, 'd'.repeat(43))
    const mine = await device(deps.db, me, { jti: 'scope-mine-token-00211', name: 'моя', country: 'RU' })
    const theirs = await device(deps.db, them, { jti: 'scope-their-token-0021', name: 'их', country: 'RU' })

    const denied = await revokeBulkSessions(actor(me, []), { authId: them, where: { country: ['RU'] } }, deps)
    expect(denied).toMatchObject({ ok: false, fact: { code: 'auth.forbidden' } })

    const admin = await revokeBulkSessions(actor(me, ['admin']), { authId: them, where: { country: ['RU'] }, includeCurrent: true }, deps)
    expect(admin.ok).toBe(true)
    if (!admin.ok) return
    expect(admin.value.revoked).toBe(1)
    expect(admin.value.current).toBe(false)

    const mineLeft = await deps.db.resource(session).select(SERVER, { filter: { field: 'id', op: 'eq', value: mine } })
    expect(mineLeft).toHaveLength(1)
    const theirsLeft = await deps.db.resource(session).select(SERVER, { filter: { field: 'id', op: 'eq', value: theirs } })
    expect(theirsLeft).toHaveLength(0)
  })
})

test('except: всё кроме перечисленных; предел исключений — отказ, а не усечение', async () => {
  await withDb(async (deps) => {
    const me = await account(deps.db, 'a'.repeat(43))
    const current = await device(deps.db, me, { jti: 'exc-current-token-0021', name: 'эта' })
    const other = await device(deps.db, me, { jti: 'exc-other-token-00211', name: 'та' })
    const meActor = actor(me, [], current)

    const keepCurrent = await revokeBulkSessions(meActor, { where: { state: 'all' }, except: [current], includeCurrent: true }, deps)
    expect(keepCurrent.ok).toBe(true)
    if (!keepCurrent.ok) return
    expect(keepCurrent.value.revoked).toBe(1)
    expect(keepCurrent.value.current).toBe(false)

    const over = Array.from({ length: SESSIONS_BULK_IDS_LIMIT + 1 }, () => crypto.randomUUID())
    const denied = await revokeBulkSessions(meActor, { where: { state: 'all' }, except: over, includeCurrent: true }, deps)
    expect(denied).toMatchObject({ ok: false, fact: { code: 'auth.limit' } })
    const left = await listSessionsPage(meActor, { state: 'all' }, deps)
    expect(left.ok && left.value.items.map((i) => i.id)).toEqual([current])
    expect(other).not.toBe(current)
  })
})

test('onlyCurrent: экран выхода закрывает одну текущую; без текущей — нечего закрывать', async () => {
  await withDb(async (deps) => {
    const me = await account(deps.db, 'b'.repeat(43))
    const current = await device(deps.db, me, { jti: 'lim-current-token-0021', name: 'эта' })
    await device(deps.db, me, { jti: 'lim-other-token-00211', name: 'та' })
    const meActor = actor(me, [], current)

    const one = await revokeBulkSessions(meActor, { onlyCurrent: true }, deps)
    expect(one.ok).toBe(true)
    if (!one.ok) return
    expect(one.value).toEqual({ revoked: 1, current: true, requested: 1 })
    const left = await listSessionsPage(meActor, { state: 'all' }, deps)
    expect(left.ok && left.value.items).toHaveLength(1)

    const noSession = await revokeBulkSessions(actor(me, []), { onlyCurrent: true }, deps)
    expect(noSession).toMatchObject({ ok: false, fact: { code: 'session.nothing-to-close' } })
  })
})

test('пустой срез — session.nothing-to-close, а не тихий успех', async () => {
  await withDb(async (deps) => {
    const me = await account(deps.db, 'f'.repeat(43))
    const current = await device(deps.db, me, { jti: 'empty-current-token-021', name: 'эта', country: 'DE' })
    const r = await revokeBulkSessions(actor(me, [], current), { where: { country: ['RU'] }, includeCurrent: true }, deps)
    expect(r).toMatchObject({ ok: false, fact: { code: 'session.nothing-to-close' } })
    const left = await listSessionsPage(actor(me, [], current), { state: 'all' }, deps)
    expect(left.ok && left.value.items).toHaveLength(1)
  })
})

test('sessionsWhere: один построитель среза для списка и серверного набора', async () => {
  const a = actor('account-id', [])
  const args = {
    authId: 'account-id',
    state: 'active' as const,
    country: ['RU', SESSIONS_COUNTRY_NONE],
    subnetChanged: true,
    createdFrom: NOW - 10_000,
    createdTo: NOW,
  }
  const w = sessionsWhere(a, args, NOW)
  expect(w.state).toBe('active')
  expect(w.includeDeleted).toBe(false)
  expect(w.and).toEqual([
    { field: 'auth_id', op: 'eq', value: 'account-id' },
    { field: 'expires_at', op: 'gt', value: new Date(NOW).toISOString() },
    { or: [{ field: 'country', op: 'eq', value: 'RU' }, { field: 'country', op: 'isNull' }] },
    { field: 'subnet_history', op: 'ne', value: [] },
    { field: 'created_at', op: 'gte', value: new Date(NOW - 10_000).toISOString() },
    { field: 'created_at', op: 'lte', value: new Date(NOW).toISOString() },
  ])
  // Без права на отозванные состояние срезается до all, а не revoked.
  const clamped = sessionsWhere(a, { authId: 'account-id', state: 'revoked' }, NOW)
  expect(clamped.state).toBe('all')
  expect(clamped.includeDeleted).toBe(false)
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

test('except: 101 исключение — две порции notIn, всё кроме перечисленных', async () => {
  await withDb(async (deps) => {
    const me = await account(deps.db, 'h'.repeat(43))
    const ids: string[] = []
    for (let i = 0; i < 120; i++) {
      ids.push(await device(deps.db, me, { jti: `chunk-except-token-${String(i).padStart(4, '0')}`, name: `d${i}` }))
    }
    const keep = ids.slice(0, 101) // 101 > inValues(100) → порции 100 + 1
    const meActor = actor(me, [], ids[0])
    const r = await revokeBulkSessions(meActor, { where: { state: 'all' }, except: keep, includeCurrent: true }, deps)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.revoked).toBe(19)
    expect(r.value.requested).toBe(19)
    expect(r.value.current).toBe(false)
    const left = await deps.db.resource(session).count(SERVER, { filter: { field: 'auth_id', op: 'eq', value: me } })
    expect(left).toBe(101)
    // Первая сохранённая строка жива, первая отозванная — удалена.
    await expect(deps.db.resource(session).get(SERVER, keep[0]!)).resolves.toBeTruthy()
    await expect(deps.db.resource(session).get(SERVER, ids[101]!)).rejects.toMatchObject({ kind: 'not_found' })
  })
})

test('except: 250 исключений — три порции notIn, а не 250 отдельных ne', async () => {
  await withDb(async (deps) => {
    const me = await account(deps.db, 'i'.repeat(43))
    const ids: string[] = []
    for (let i = 0; i < 260; i++) {
      ids.push(await device(deps.db, me, { jti: `bulk-except-token-${String(i).padStart(4, '0')}`, name: `d${i}` }))
    }
    const keep = ids.slice(0, 250) // 250 → порции 100 + 100 + 50
    const meActor = actor(me, [], ids[0])
    const r = await revokeBulkSessions(meActor, { where: { state: 'all' }, except: keep, includeCurrent: true }, deps)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.revoked).toBe(10)
    expect(r.value.requested).toBe(10)
    const left = await deps.db.resource(session).count(SERVER, { filter: { field: 'auth_id', op: 'eq', value: me } })
    expect(left).toBe(250)
  })
})

test('except: ровно SESSIONS_BULK_IDS_LIMIT принят — фильтр строится, а не auth.limit', async () => {
  await withDb(async (deps) => {
    const me = await account(deps.db, 'j'.repeat(43))
    await device(deps.db, me, { jti: 'limit-500-token-00001', name: 'одна' })
    // 500 случайных uuid не совпадают с реальной строкой: срез не пуст,
    // отзыв должен пройти (5 порций notIn), а не упасть validation/auth.limit.
    const except = Array.from({ length: SESSIONS_BULK_IDS_LIMIT }, () => crypto.randomUUID())
    const r = await revokeBulkSessions(actor(me, []), { where: { state: 'all' }, except, includeCurrent: true }, deps)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.revoked).toBe(1)
    expect(r.value.requested).toBe(1)
  })
})

test('R3: чужой id — одиночный отзыв не закрывает чужую строку (revoked=0)', async () => {
  await withDb(async (deps) => {
    const me = await account(deps.db, 'k'.repeat(43))
    const them = await account(deps.db, 'l'.repeat(43))
    const theirs = await device(deps.db, them, { jti: 'foreign-revoke-token-01', name: 'чужая' })
    const mine = await device(deps.db, me, { jti: 'foreign-revoke-mine-001', name: 'моя' })

    // Чужая строка не видна актору без прав: отзыв возвращает отказ, а не успех.
    const r = await revokeSessionById(actor(me, []), theirs, deps)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.fact.code).toBe('auth.session-unknown')

    // Негативный контроль: чужая строка осталась жива, своя тоже не тронута.
    const left = await deps.db.resource(session).select(SERVER, { filter: { field: 'auth_id', op: 'eq', value: them } })
    expect(left.map((row) => row.id)).toEqual([theirs])
    const mineLeft = await deps.db.resource(session).select(SERVER, { filter: { field: 'id', op: 'eq', value: mine } })
    expect(mineLeft).toHaveLength(1)
  })
})
