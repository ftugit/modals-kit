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
import {
  listSessionsPage,
  readSessionDetail,
  renameSessionDevice,
  revokeBulkSessions,
  revokeSessionById,
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
