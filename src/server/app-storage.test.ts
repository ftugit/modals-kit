import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('$app/env/private', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    AUTH_COOKIE_SAMESITE: 'lax',
    AUTH_SEAL_ID: 'k1',
    AUTH_SEAL_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef',
    AUTH_SEAL_OLD_KEYS: '',
  }
})

vi.mock('./db.server.js', () => ({
  db: {},
}))

import { conservativeLimits, createDb, type Database } from '#lib/db/index.js'
import { pgliteAdapter } from '#lib/db/adapters/pglite.js'
import { defineSchema } from '#lib/db/sync/index.js'
import { cacheKv } from '#hooks/cache-db.js'
import { storageResources, storageServer } from '#hooks/storage-db.js'
import {
  extractManagedAvatarPath,
  listStorageServers,
  removeManagedAvatarByUrl,
  removeStorageServer,
  resolveAppStorage,
  saveManagedAvatar,
  saveStorageServer,
  type SealKeysConfig,
} from './app-storage.server.js'

const KEYS_V1: SealKeysConfig = {
  id: 'k1',
  secret: '111111111111111111111111111111111111111111111111',
  old: {},
  enabled: true,
}

const KEYS_V2_ROTATED: SealKeysConfig = {
  id: 'k2',
  secret: '222222222222222222222222222222222222222222222222',
  old: { k1: KEYS_V1.secret },
  enabled: true,
}

/** Минимальный in-memory WebDAV fetch-мок для честной проверки `probe` + записи/чтения. */
function createMockWebdavFetch() {
  const objects = new Map<string, Uint8Array>()
  const fn: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const method = (init?.method ?? 'GET').toUpperCase()
    const key = url.pathname.replace(/\/+$/, '')

    if (method === 'MKCOL') {
      return new Response(null, { status: 201 })
    }
    if (method === 'PUT') {
      const raw = init?.body
      let bytes: Uint8Array = new Uint8Array(0)
      if (raw instanceof Uint8Array) bytes = new Uint8Array(raw)
      else if (raw instanceof ArrayBuffer) bytes = new Uint8Array(raw)
      else if (raw && typeof (raw as ReadableStream<Uint8Array>).getReader === 'function') {
        const chunks: Uint8Array[] = []
        const r = (raw as ReadableStream<Uint8Array>).getReader()
        while (true) {
          const { done, value } = await r.read()
          if (done) break
          if (value) chunks.push(value)
        }
        const total = chunks.reduce((s, c) => s + c.byteLength, 0)
        bytes = new Uint8Array(total)
        let off = 0
        for (const c of chunks) {
          bytes.set(c, off)
          off += c.byteLength
        }
      } else if (typeof raw === 'string') {
        bytes = new TextEncoder().encode(raw)
      }
      objects.set(key, bytes)
      return new Response(null, { status: 201 })
    }
    if (method === 'HEAD') {
      const found = objects.get(key)
      if (!found) return new Response(null, { status: 404 })
      return new Response(null, {
        status: 200,
        headers: { 'content-length': String(found.byteLength) },
      })
    }
    if (method === 'GET') {
      const found = objects.get(key)
      if (!found) return new Response('Not Found', { status: 404 })
      return new Response(found as BodyInit, {
        status: 200,
        headers: { 'content-length': String(found.byteLength) },
      })
    }
    if (method === 'DELETE') {
      const existed = objects.delete(key)
      return new Response(null, { status: existed ? 204 : 404 })
    }
    if (method === 'PROPFIND') {
      const found = objects.get(key)
      if (!found && !key.endsWith('/box')) {
        return new Response('Not Found', { status: 404 })
      }
      const size = found ? found.byteLength : 0
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>${url.pathname}</d:href>
    <d:propstat>
      <d:prop>
        <d:getcontentlength>${size}</d:getcontentlength>
        <d:getlastmodified>${new Date().toUTCString()}</d:getlastmodified>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`
      return new Response(xml, { status: 207, headers: { 'content-type': 'application/xml' } })
    }
    return new Response(null, { status: 405 })
  }
  return { fetchImpl: fn, objects }
}

describe('app-storage.server — боевой пул БД, STORAGE_ACL, шифрование секретов и аватары', () => {
  let pg: PGlite
  let testDb: Database
  let devDir: string

  const viewerNone = { id: '00000000-0000-4000-8000-000000000001', permissions: [] }
  const viewerRead = { id: '00000000-0000-4000-8000-000000000002', permissions: ['storage.read'] }
  const viewerEdit = { id: '00000000-0000-4000-8000-000000000003', permissions: ['storage.read', 'storage.edit'] }
  const targetUid = '11111111-2222-4333-8444-555555555555'

  beforeAll(async () => {
    devDir = await mkdtemp(join(tmpdir(), 'modals-kit-app-storage-test-'))
    pg = new PGlite()
    const gated = await defineSchema({
      resources: [cacheKv, ...storageResources],
    }).gate(pgliteAdapter(pg))
    testDb = createDb({ driver: gated, limits: conservativeLimits })
  })

  afterAll(async () => {
    await pg?.close()
    if (devDir) await rm(devDir, { recursive: true, force: true })
  })

  it('STORAGE_ACL: обычный пользователь получает auth.forbidden, storage.read видит пул без правки, sealed_config скрыт от не-server', async () => {
    const denied = await listStorageServers(viewerNone, { db: testDb, sealKeys: KEYS_V1, isCloud: false, devRootDir: devDir })
    expect(denied).toEqual({ ok: false, fact: { code: 'auth.forbidden' } })

    const readSlice = await listStorageServers(viewerRead, { db: testDb, sealKeys: KEYS_V1, isCloud: false, devRootDir: devDir })
    expect(readSlice.ok).toBe(true)
    if (readSlice.ok) {
      expect(readSlice.value.canEdit).toBe(false)
      expect(readSlice.value.activeMode).toBe('dev_local')
    }

    const writeDenied = await saveStorageServer(
      viewerRead,
      { slot: 'dav_main', url: 'webdav://u:p@dav.example.test/box', storageMb: 512, fileMb: 64 },
      { db: testDb, sealKeys: KEYS_V1 },
    )
    expect(writeDenied).toEqual({ ok: false, fact: { code: 'auth.forbidden' } })
  })

  it('пустой пул: в облаке отдаёт storage.pool-empty, а в dev пишет в local_dev и удаляет старый аватар сразу при замене', async () => {
    const sampleFile = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'avatar.jpg', {
      type: 'image/jpeg',
    })

    const cloudWrite = await saveManagedAvatar(targetUid, sampleFile, {
      db: testDb,
      sealKeys: KEYS_V1,
      isCloud: true,
    })
    expect(cloudWrite).toEqual({ ok: false, fact: { code: 'storage.pool-empty' } })

    const devWrite1 = await saveManagedAvatar(targetUid, sampleFile, {
      db: testDb,
      sealKeys: KEYS_V1,
      isCloud: false,
      devRootDir: devDir,
    })
    expect(devWrite1.ok).toBe(true)
    if (!devWrite1.ok) return

    expect(devWrite1.value.url).toMatch(/^\/api\/storage\/avatars\/11111111-2222-4333-8444-555555555555\//)
    expect(extractManagedAvatarPath(devWrite1.value.url)).toBe(devWrite1.value.path)
    expect(extractManagedAvatarPath('https://cdn.example.com/a.jpg')).toBeNull()
    expect(extractManagedAvatarPath('data:image/jpeg;base64,AAA')).toBeNull()

    const resolved = await resolveAppStorage({
      db: testDb,
      sealKeys: KEYS_V1,
      isCloud: false,
      devRootDir: devDir,
    })
    expect(resolved.activeMode).toBe('dev_local')
    const served = await resolved.storage!.serve(
      devWrite1.value.path,
      new Request('http://localhost/api/storage/' + devWrite1.value.path),
      { cacheControl: 'public, max-age=31536000, immutable', etag: 'strong' },
    )
    expect(served.status).toBe(200)
    expect(served.headers.get('cache-control')).toContain('immutable')
    expect(served.headers.get('etag')).toMatch(/^"[^"]+"$/)

    // Немедленное удаление прежнего аватара (замена / удаление профиля)
    const removed = await removeManagedAvatarByUrl(devWrite1.value.url, {
      db: testDb,
      sealKeys: KEYS_V1,
      isCloud: false,
      devRootDir: devDir,
    })
    expect(removed).toBe(true)

    const afterRemove = await resolved.storage!.serve(
      devWrite1.value.path,
      new Request('http://localhost/api/storage/' + devWrite1.value.path),
      { etag: 'strong' },
    )
    expect(afterRemove.status).toBe(404)
  })

  it('saveStorageServer: блокирует недоступный сервер на probe, шифрует sealed_config и переживает ротацию AUTH_SEAL_OLD_KEYS', async () => {
    const brokenFetch: typeof fetch = async () => new Response('Forbidden', { status: 403 })
    const failedProbe = await saveStorageServer(
      viewerEdit,
      {
        slot: 'dav_broken',
        url: 'webdav://user:secretpass@dav.example.test/box',
        storageMb: 1024,
        fileMb: 128,
      },
      { db: testDb, sealKeys: KEYS_V1, fetchImpl: brokenFetch },
    )
    expect(failedProbe.ok).toBe(false)
    if (!failedProbe.ok) {
      expect(failedProbe.fact.code).toBe('storage.probe-failed')
    }

    const reservedSlot = await saveStorageServer(
      viewerEdit,
      {
        slot: 'local_dev',
        url: 'webdav://user:secretpass@dav.example.test/box',
        storageMb: 1024,
        fileMb: 128,
      },
      { db: testDb, sealKeys: KEYS_V1 },
    )
    expect(reservedSlot).toEqual({
      ok: false,
      fact: { code: 'storage.slot-reserved', path: 'slot' },
    })

    const { fetchImpl } = createMockWebdavFetch()
    const saved = await saveStorageServer(
      viewerEdit,
      {
        slot: 'dav_prod',
        url: 'webdav://user:topsecret123@dav.example.test/box',
        encryptionKey: 'my-stream-key',
        storageMb: 2048,
        fileMb: 256,
        priority: 10,
      },
      { db: testDb, sealKeys: KEYS_V1, isCloud: true, fetchImpl },
    )
    expect(saved.ok).toBe(true)
    if (!saved.ok) return

    expect(saved.value.activeMode).toBe('pool')
    expect(saved.value.items).toHaveLength(1)
    expect(saved.value.items[0]?.slot).toBe('dav_prod')
    expect(saved.value.items[0]?.meta.encrypted).toBe(true)
    expect(saved.value.items[0]?.meta.summary).not.toContain('topsecret123')

    // Проверка ACL поля `sealed_config`: читателю с `storage.read` БД не возвращает `sealed_config`
    const readerRows = await testDb.resource(storageServer).select({
      principal: { id: viewerRead.id, roles: ['storage.read'] },
    })
    expect(readerRows).toHaveLength(1)
    expect('sealed_config' in (readerRows[0] as Record<string, unknown>)).toBe(false)

    // Серверный контекст видит запечатанный ciphertext без открытого пароля
    const serverRows = await testDb.resource(storageServer).select({
      principal: { roles: ['server'] },
    })
    const ciphertext = String((serverRows[0] as Record<string, unknown>).sealed_config)
    expect(ciphertext.startsWith('Fe26.2')).toBe(true)
    expect(ciphertext).not.toContain('topsecret123')
    expect(ciphertext).not.toContain('my-stream-key')

    // Ротация ключа: KEYS_V2_ROTATED расшифровывает через `old.k1` и перешифровывает на `k2` при обновлении без повторного ввода URL
    const updated = await saveStorageServer(
      viewerEdit,
      {
        id: saved.value.items[0]!.id,
        slot: 'dav_prod',
        url: '',
        storageMb: 4096,
        fileMb: 512,
        priority: 5,
      },
      { db: testDb, sealKeys: KEYS_V2_ROTATED, isCloud: true, fetchImpl },
    )
    expect(updated.ok).toBe(true)
    if (updated.ok) {
      expect(updated.value.items[0]?.meta.storageMb).toBe(4096)
      expect(updated.value.items[0]?.priority).toBe(5)
    }

    const removed = await removeStorageServer(viewerEdit, saved.value.items[0]!.id, {
      db: testDb,
      sealKeys: KEYS_V2_ROTATED,
      isCloud: true,
    })
    expect(removed.ok).toBe(true)
    if (removed.ok) {
      expect(removed.value.items).toHaveLength(0)
      expect(removed.value.activeMode).toBe('empty')
    }
  })
})
