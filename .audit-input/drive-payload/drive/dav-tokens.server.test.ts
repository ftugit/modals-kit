/**
 * Серверные экшены паролей WebDAV.
 *
 * Проверяется полный путь формы: `Request` → `createFormHandler` → сервис →
 * строка в PGlite и 303. Мокаются только края: `db`, `auth`, троттлинг,
 * `sharedStore` (одноразовый секрет) и `AUTH_SEAL_SECRET`.
 */
import { PGlite } from '@electric-sql/pglite'
import { afterAll, expect, it, vi } from 'vitest'
import type { RequestEvent } from '@sveltejs/kit'
import { conservativeLimits, createDb, type Database } from '#core/lib/db/index.js'
import { pgliteAdapter } from '#core/lib/db/adapters/pglite.js'
import { defineSchema } from '#core/lib/db/sync/index.js'
import { auth } from '#modules/user/base/model/schema.js'
import { dbExtension } from '#modules/drive/db.ext.js'
import { driveDavToken, driveNode } from '#modules/drive/schema.js'
import { DRIVE_SERVER } from '#modules/drive/service/access.js'
import { davTokenActions, loadDavTokens } from './dav-tokens.server.js'

const state = vi.hoisted(() => ({
  db: null as unknown,
  actor: '',
  secret: '',
  issued: new Map<string, unknown>(),
}))

vi.mock('$app/env/private', () => ({
  get AUTH_SEAL_SECRET() {
    return state.secret
  },
}))

vi.mock('#core/server/db.server.js', () => ({
  get db() {
    return state.db
  },
}))

vi.mock('#modules/user/base/service/gateway.server.js', () => ({
  auth: () => ({
    enabled: true,
    actor: async () => ({ ok: true, value: { id: state.actor, permissions: [] } }),
  }),
}))

vi.mock('#core/server/client-ip.server.js', () => ({
  createIpThrottle: () => ({ check: () => ({ allowed: true }) }),
}))

vi.mock('#core/server/cache.server.js', () => ({
  sharedStore: {
    scope: () => ({
      get: async (key: string) => state.issued.get(key),
      set: async (key: string, value: unknown) => void state.issued.set(key, value),
      delete: async (key: string) => void state.issued.delete(key),
    }),
  },
}))

vi.mock('#core/server/form-security.server.js', async () => {
  const form = await import('#core/lib/form/server.js')
  return { SECURITY_LAYERS: [form.methodLayer(), form.bodyLayer, form.namesLayer] }
})

const test = (name: string, fn: () => Promise<void>) => it(name, fn, 60_000)
const KEY = 'k'.repeat(32)

let shared: PGlite | undefined
afterAll(async () => {
  await shared?.close()
})

async function withDb(fn: (db: Database) => Promise<void>) {
  shared ??= new PGlite()
  await shared.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  const driver = pgliteAdapter(shared)
  const resources = [auth, driveNode, driveDavToken]
  const report = await defineSchema({ resources, sql: dbExtension.sql }).sync(driver)
  expect(report.status).toBe('ok')
  state.db = createDb({ driver, limits: conservativeLimits, resources })
  state.issued.clear()
  await fn(state.db as Database)
}

async function account(db: Database): Promise<string> {
  const row = await db.resource(auth).insert(DRIVE_SERVER, { seed: `${'c'.repeat(43)}` })
  return String(row.id)
}

function event(path: string): RequestEvent {
  const url = new URL(`http://localhost${path}`)
  return {
    request: new Request(url, { method: 'GET', headers: { origin: 'http://localhost' } }),
    url,
    cookies: { get: () => undefined, set: () => {}, delete: () => {} },
    params: {},
    locals: {},
    getClientAddress: () => '127.0.0.1',
    setHeaders: () => {},
  } as unknown as RequestEvent
}

type ActionName = keyof typeof davTokenActions
const FORM_ID: Record<ActionName, string> = { issue: 'drive-dav-issue', revoke: 'drive-dav-revoke' }

async function post(action: ActionName, fields: Record<string, string>): Promise<{ status: number; location: string }> {
  const body = new URLSearchParams({
    __form_id: FORM_ID[action],
    __form_rev: '1',
    __form_instance: 'drive:dav-test',
    __form_submission: crypto.randomUUID(),
    ...fields,
  })
  const url = new URL('http://localhost/user/config/dav')
  const request = new Request(url, {
    method: 'POST',
    headers: { origin: 'http://localhost' },
    body,
  })
  const ev = { ...event('/user/config/dav'), request } as RequestEvent
  try {
    await davTokenActions[action](ev)
  } catch (error) {
    const thrown = error as { status?: number; location?: string }
    if (thrown.status === 303 && typeof thrown.location === 'string') {
      return { status: thrown.status, location: thrown.location }
    }
    throw error
  }
  throw new Error(`экшен ${action} завершился без редиректа`)
}

test('issue: показывает секрет один раз, в БД остаётся только HMAC; revoke закрывает', async () => {
  await withDb(async (db) => {
    state.actor = await account(db)
    state.secret = KEY

    const created = await post('issue', { label: 'Ноутбук', return_to: '/user/config' })
    expect(created.status).toBe(303)
    const location = new URL(created.location, 'http://localhost')
    expect(location.pathname).toBe('/user/config/dav')
    const issuedId = location.searchParams.get('issued')
    expect(issuedId).toBeTruthy()

    const first = await loadDavTokens(event(`/user/config/dav?issued=${issuedId}`))
    expect(first.enabled).toBe(true)
    expect(first.issued).toMatch(/^dv1_[a-f0-9]{16}_[A-Za-z0-9_-]{32,64}$/)
    expect(first.tokens).toHaveLength(1)
    expect(first.tokens[0]).toMatchObject({ label: 'Ноутбук', revokedAt: null })

    // Второй рендер того же адреса секрет уже не отдаёт.
    expect((await loadDavTokens(event(`/user/config/dav?issued=${issuedId}`))).issued).toBeNull()

    const rows = await db.resource(driveDavToken).select(DRIVE_SERVER, {})
    expect(JSON.stringify(rows)).not.toContain(first.issued)
    expect(rows).toHaveLength(1)

    const revoked = await post('revoke', {
      token_id: first.tokens[0]!.id,
      return_to: '/user/config/dav',
    })
    expect(revoked).toEqual({ status: 303, location: '/user/config/dav' })

    const after = await loadDavTokens(event('/user/config/dav'))
    expect(after.tokens[0]?.revokedAt).toBeInstanceOf(Date)
  })
})

test('issue без AUTH_SEAL_SECRET: отказ и пустая выдача', async () => {
  await withDb(async (db) => {
    state.actor = await account(db)
    state.secret = ''

    const created = await post('issue', { label: 'Ноутбук', return_to: '/user/config/dav' })
    expect(created.location).toBe('/user/config/dav?notice=drive.dav-disabled')

    expect(await db.resource(driveDavToken).select(DRIVE_SERVER, {})).toHaveLength(0)
    const data = await loadDavTokens(event('/user/config/dav'))
    expect(data).toMatchObject({ enabled: false, issued: null, tokens: [] })
  })
})
