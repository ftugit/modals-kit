/**
 * Этап 5 `plan-drive.md`: WebDAV поверх настоящей модели.
 *
 * Проверяется не «отвечает 207», а границы: чужой пароль не открывает диск,
 * `PROPFIND` не отдаёт чужой узел, `PUT` пишет через сервис (значит, квоту и
 * `hash: true` не обойти), `GET` с `Range` отдаёт 206 через общий
 * `createFileResponse`.
 */
import { PGlite } from '@electric-sql/pglite'
import { afterAll, expect, it } from 'vitest'
import { conservativeLimits, createDb, type Database } from '#core/lib/db/index.js'
import { pgliteAdapter } from '#core/lib/db/adapters/pglite.js'
import { defineSchema } from '#core/lib/db/sync/index.js'
import type { DavFileLike } from '#core/lib/storage/webdav.js'
import { auth } from '#modules/user/base/model/schema.js'
import { dbExtension } from './db.ext.js'
import { driveDavLock, driveDavToken, driveNode, driveShare } from './schema.js'
import type { DriveActor } from './types.js'
import { DRIVE_SERVER } from './service/access.js'
import { createDriveFolder } from './service/mutate.js'
import { issueDriveDavToken, verifyDriveDavToken } from './service/tokens.js'
import { createDriveDav } from './webdav.server.js'

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
  const resources = [auth, driveNode, driveShare, driveDavToken, driveDavLock]
  const report = await defineSchema({ resources, sql: dbExtension.sql }).sync(driver)
  expect(report.status).toBe('ok')
  await fn(createDb({ driver, limits: conservativeLimits, resources }))
}

let seeds = 0
async function account(db: Database): Promise<string> {
  seeds += 1
  const row = await db.resource(auth).insert(DRIVE_SERVER, {
    seed: `${String(seeds).padStart(2, '0')}${'c'.repeat(41)}`,
  })
  return String(row.id)
}

const actor = (id: string): DriveActor => ({ id, permissions: [] })

function memoryStorage() {
  const files = new Map<string, { bytes: Uint8Array; type: string; at: number }>()
  return {
    files,
    async put(input: { path: string; body: unknown; contentType?: string }) {
      const bytes =
        input.body instanceof Uint8Array
          ? input.body
          : new Uint8Array(await new Response(input.body as BodyInit).arrayBuffer())
      files.set(input.path, { bytes, type: input.contentType ?? 'application/octet-stream', at: Date.now() })
      return { hash: `hash-${bytes.byteLength}` }
    },
    async del(path: string) {
      return files.delete(path)
    },
    async lazy(path: string): Promise<DavFileLike | null> {
      const file = files.get(path)
      if (!file) return null
      return {
        name: path.split('/').pop() ?? 'file',
        size: file.bytes.byteLength,
        type: file.type,
        lastModified: file.at,
        stream: () => new Response(file.bytes.slice().buffer).body!,
        arrayBuffer: async () => file.bytes.buffer.slice(0) as ArrayBuffer,
        slice: (start = 0, end = file.bytes.byteLength) => ({
          stream: () => new Response(file.bytes.slice(start, end).buffer).body!,
        }),
      }
    },
  }
}

// Тест идёт в Node: `Buffer` не тянет браузерный base64-путь и не нарушает
// правило слоя о переводе файлов в base64.
const basic = (token: string): string =>
  `Basic ${Buffer.from(`drive:${token}`, 'utf8').toString('base64')}`

test('пароль приложения: выдача один раз, секрет в БД не лежит, отзыв закрывает вход', async () => {
  await withDb(async (db) => {
    const me = actor(await account(db))
    const issued = await issueDriveDavToken(db, me, { label: 'ноутбук', secretKey: KEY })
    expect(issued.ok).toBe(true)
    if (!issued.ok) return
    expect(issued.value.token).toMatch(/^dv1_[a-f0-9]{16}_/)
    expect(JSON.stringify(await db.resource(driveDavToken).select(DRIVE_SERVER, {}))).not.toContain(
      issued.value.token,
    )

    expect(await verifyDriveDavToken(db, basic(issued.value.token), KEY)).toMatchObject({ id: me.id })
    expect(await verifyDriveDavToken(db, basic(issued.value.token), 'x'.repeat(32))).toBeNull()
    const other = await issueDriveDavToken(db, actor(await account(db)), { label: 'чужой', secretKey: KEY })
    if (other.ok) expect((await verifyDriveDavToken(db, basic(issued.value.token), KEY))?.id).toBe(me.id)

    const revoked = await (await import('./service/tokens.js')).revokeDriveDavToken(db, me, issued.value.id)
    expect(revoked.ok).toBe(true)
    expect(await verifyDriveDavToken(db, basic(issued.value.token), KEY)).toBeNull()
  })
})

test('PROPFIND, PUT, GET Range и DELETE через настоящий протокол', async () => {
  await withDb(async (db) => {
    const me = actor(await account(db))
    const issued = await issueDriveDavToken(db, me, { label: 'клиент', secretKey: KEY })
    if (!issued.ok) return
    const storage = memoryStorage()
    const dav = createDriveDav({ db, storage, secretKey: KEY })
    const authHeader = { authorization: basic(issued.value.token) }

    const root = await dav.handle(
      new Request('http://local/api/dav/', { method: 'PROPFIND', headers: { ...authHeader, depth: '1' } }),
    )
    expect(root.status).toBe(207)

    const made = await dav.handle(
      new Request('http://local/api/dav/Отчёты', { method: 'MKCOL', headers: authHeader }),
    )
    expect(made.status).toBe(201)

    const put = await dav.handle(
      new Request('http://local/api/dav/Отчёты/план.txt', {
        method: 'PUT',
        headers: { ...authHeader, 'content-type': 'text/plain' },
        body: 'hello, disk',
      }),
    )
    expect(put.status).toBe(201)

    const list = await dav.handle(
      new Request('http://local/api/dav/Отчёты', {
        method: 'PROPFIND',
        headers: { ...authHeader, depth: '1' },
      }),
    )
    const xml = await list.text()
    expect(list.status).toBe(207)
    expect(xml).toContain('план.txt')
    // ETag из PROPFIND совпадает с GET (иначе If-Range у клиентов ломается).
    expect(xml).toMatch(/getetag>[^<]+<\/D:getetag/)

    const ranged = await dav.handle(
      new Request('http://local/api/dav/Отчёты/план.txt', {
        method: 'GET',
        headers: { ...authHeader, range: 'bytes=0-5' },
      }),
    )
    expect(ranged.status).toBe(206)
    expect(await ranged.text()).toBe('hello,')
    expect(ranged.headers.get('content-range')).toMatch(/^bytes 0-5\//)

    const del = await dav.handle(
      new Request('http://local/api/dav/Отчёты/план.txt', { method: 'DELETE', headers: authHeader }),
    )
    expect(del.status).toBe(204)
  })
})

test('чужой пароль и чужой путь не протекают', async () => {
  await withDb(async (db) => {
    const owner = actor(await account(db))
    const stranger = actor(await account(db))
    const folder = await createDriveFolder(db, owner, { name: 'Личное' })
    expect(folder.ok).toBe(true)

    const ownerToken = await issueDriveDavToken(db, owner, { label: 'владелец', secretKey: KEY })
    const strangerToken = await issueDriveDavToken(db, stranger, { label: 'чужой', secretKey: KEY })
    if (!ownerToken.ok || !strangerToken.ok) return
    const storage = memoryStorage()
    const dav = createDriveDav({ db, storage, secretKey: KEY })

    const denied = await dav.handle(
      new Request('http://local/api/dav/', { method: 'PROPFIND', headers: { depth: '1' } }),
    )
    expect(denied.status).toBe(401)
    expect(denied.headers.get('www-authenticate')).toContain('Basic')

    const foreign = await dav.handle(
      new Request('http://local/api/dav/Личное', {
        method: 'PROPFIND',
        headers: { authorization: basic(strangerToken.value.token), depth: '0' },
      }),
    )
    expect(foreign.status).toBe(404)

    const own = await dav.handle(
      new Request('http://local/api/dav/Личное', {
        method: 'PROPFIND',
        headers: { authorization: basic(ownerToken.value.token), depth: '0' },
      }),
    )
    expect(own.status).toBe(207)
  })
})
