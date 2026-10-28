/**
 * Связка `#lib/storage` × `#lib/db` × `#lib/cache` (`src/hooks/storage-db.ts`)
 * на настоящем движке PostgreSQL (PGlite WASM).
 *
 * Как и в `src/hooks/cache-db.test.ts`, таблицы разворачиваются `defineSchema(...).gate(...)`
 * из моделей `storageResources` + `cacheKv`.
 */
import { PGlite } from '@electric-sql/pglite'
import { afterAll, describe, expect, it } from 'vitest'
import { conservativeLimits, createDb, type Database } from '#lib/db/index.js'
import { pgliteAdapter } from '#lib/db/adapters/pglite.js'
import { defineSchema } from '#lib/db/sync/index.js'
import {
  createStorage,
  memoryDriver,
  StorageConcurrencyError,
} from '#lib/storage/index.js'
import { cacheKv, pgStore } from './cache-db.js'
import {
  cacheStorageStore,
  pgStorageLedger,
  storageResources,
} from './storage-db.js'

const test = (name: string, fn: () => Promise<void>) => it(name, fn, 30_000)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let shared: PGlite | undefined
afterAll(async () => {
  await shared?.close()
})

async function fresh(): Promise<{ pg: PGlite; db: Database }> {
  shared ??= new PGlite()
  await shared.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  const gated = await defineSchema({
    resources: [cacheKv, ...storageResources],
  }).gate(pgliteAdapter(shared))
  const db = createDb({ driver: gated, limits: conservativeLimits })
  return { pg: shared, db }
}

function deterministicBytes(length: number, seed = 13): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(length))
  for (let i = 0; i < length; i++) {
    out[i] = (i * 31 + seed) & 0xff
  }
  return out
}

describe('pgStorageLedger & cacheStorageStore (#hooks/storage-db)', () => {
  test('sync разворачивает таблицы storage_file и storage_reservation с типами и уникальными ключами', async () => {
    const { pg } = await fresh()

    const fileCols = (
      await pg.query<{ name: string; type: string }>(
        `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type
           FROM pg_attribute a
          WHERE a.attrelid = 'public.storage_file'::regclass
            AND a.attnum > 0
            AND NOT a.attisdropped
          ORDER BY a.attnum`,
      )
    ).rows
    expect(fileCols).toEqual([
      { name: 'id', type: 'uuid' },
      { name: 'scope', type: 'text' },
      { name: 'path', type: 'text' },
      { name: 'record', type: 'jsonb' },
    ])

    const resvCols = (
      await pg.query<{ name: string; type: string }>(
        `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type
           FROM pg_attribute a
          WHERE a.attrelid = 'public.storage_reservation'::regclass
            AND a.attnum > 0
            AND NOT a.attisdropped
          ORDER BY a.attnum`,
      )
    ).rows
    expect(resvCols).toEqual([
      { name: 'id', type: 'uuid' },
      { name: 'scope', type: 'text' },
      { name: 'reservation_id', type: 'text' },
      { name: 'allocations', type: 'jsonb' },
      { name: 'expires_at', type: 'timestamp with time zone' },
    ])
  })

  test('атомарно ограничивает квоту при параллельных reserve() и освобождает просроченные брони по часам базы clock_timestamp()', async () => {
    const { db } = await fresh()
    const ledger = pgStorageLedger(db, { scope: 'quota-race' })

    // Потолок 1000 Б: из 8 параллельных заявок по 400 Б пройти обязаны ровно 2 (800 Б <= 1000 Б)
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, idx) =>
        ledger.reserve({
          id: `r-${idx}`,
          allocations: [{ server: 's1', bytes: 400, maxStorageBytes: 1_000 }],
          ttlMs: 80,
        }),
      ),
    )

    const winners = results.filter((r) => r !== null)
    expect(winners).toHaveLength(2)

    const liveUsage = await ledger.usage(['s1'])
    expect(liveUsage.s1?.reservedBytes).toBe(800)

    // Ждём истечения TTL по часам PostgreSQL (`clock_timestamp()`)
    await sleep(110)

    const afterExpiry = await ledger.usage(['s1'])
    expect(afterExpiry.s1?.reservedBytes).toBe(0)

    const nextWinner = await ledger.reserve({
      id: 'r-after-ttl',
      allocations: [{ server: 's1', bytes: 950, maxStorageBytes: 1_000 }],
      ttlMs: 60_000,
    })
    expect(nextWinner).not.toBeNull()
  })

  test('обеспечивает полный цикл createStorage поверх PostgreSQL: нарезка split, шифрование, перезапись, реплики, кэш statTtlMs и лимит потоков по IP', async () => {
    const { db } = await fresh()
    const sharedCache = pgStore(db)
    const ledger = pgStorageLedger(db, { scope: 'prod' })
    const store = cacheStorageStore(sharedCache)

    const storage = createStorage({
      ledger,
      store,
      writePool: ['node_a', 'node_b'],
      servers: {
        node_a: {
          driver: memoryDriver({ publicBaseUrl: '/api/files' }),
          key: 'pg-ledger-key-a',
          statTtlMs: 30_000,
          concurrency: { max: 1, scope: 'ip', mode: 'reject' },
          limits: {
            storageBytes: 120_000,
            fileBytes: 90_000,
          },
        },
        node_b: {
          driver: memoryDriver({ publicBaseUrl: '/api/files' }),
          key: 'pg-ledger-key-b',
          statTtlMs: 30_000,
          limits: {
            storageBytes: 200_000,
            fileBytes: 120_000,
          },
        },
      },
    })

    // 1. Записываем 140 КиБ: нарезается на 3 части (2 части на node_a по fileBytes=90 КиБ до потолка 120 КиБ + 1 часть на node_b)
    const bigPayload = deterministicBytes(140_000, 55)
    const savedSplit = await storage.put({
      path: 'videos/clip.bin',
      body: new Blob([bigPayload], { type: 'video/mp4' }),
      contentType: 'video/mp4',
      meta: { ip: '198.51.100.10' },
    })
    expect(savedSplit.partsCount).toBe(3)

    const statRec = await storage.stat('videos/clip.bin')
    expect(statRec?.parts).toHaveLength(3)
    expect(statRec?.parts.map((p) => p.server)).toEqual(['node_a', 'node_a', 'node_b'])
    expect(statRec?.size).toBe(bigPayload.byteLength)

    // Повторный stat читается из Postgres `cache_kv` через `cacheStorageStore`
    const cachedInPg = await sharedCache
      .scope('storage')
      .get<{ path: string }>('stat:videos/clip.bin')
    expect(cachedInPg?.path).toBe('videos/clip.bin')

    // Range-чтение поперёк стыка двух серверов и границ 64-КиБ шифрования
    const resRange = await storage.serve(
      'videos/clip.bin',
      new Request('http://app.local/videos/clip.bin', {
        headers: { range: 'bytes=70000-105000' },
      }),
      { meta: { ip: '198.51.100.10' } },
    )
    expect(resRange.status).toBe(206)
    const rangeBytes = new Uint8Array(await resRange.arrayBuffer())
    expect(Buffer.compare(rangeBytes, bigPayload.subarray(70_000, 105_001))).toBe(0)

    // 2. Перезапись по тому же пути: пока старый файл жив, node_a полон (120 КиБ), поэтому новая версия
    //    безопасно пишется на node_b, а commit() возвращает `replaced` и освобождает node_a в 0!
    const smallReplacement = deterministicBytes(16_384, 99)
    const overwritten = await storage.put({
      path: 'videos/clip.bin',
      body: smallReplacement,
      contentType: 'video/mp4',
      meta: { ip: '198.51.100.10' },
    })
    expect(overwritten.partsCount).toBe(1)
    expect(overwritten.server).toBe('node_b')

    const repAfterOverwrite = await storage.report()
    const repA = repAfterOverwrite.servers.find((s) => s.server === 'node_a')!
    expect(repA.usedBytes).toBe(0)
    expect(repA.partsCount).toBe(0)

    // 3. Копия на node_a создаёт `@replica:node_a:videos/clip.bin`, не засоряя курсорный `list()`
    await storage.copy({
      path: 'videos/clip.bin',
      from: 'node_b',
      to: 'node_a',
      meta: { ip: '198.51.100.10' },
    })
    await storage.put({
      path: 'videos/second.bin',
      body: new Uint8Array([1, 2, 3, 4]),
      server: 'node_b',
    })

    const page1 = await storage.list({ prefix: 'videos/', limit: 1 })
    expect(page1.entries.map((e) => e.path)).toEqual(['videos/clip.bin'])
    expect(page1.cursor).toBe('videos/clip.bin')

    const page2 = await storage.list({ prefix: 'videos/', limit: 1, cursor: page1.cursor })
    expect(page2.entries.map((e) => e.path)).toEqual(['videos/second.bin'])
    expect(page2.cursor).toBeUndefined()

    // 4. Атомарные add/incr в cacheStorageStore(pgStore(db)) и лимит параллельных потоков `scope: 'ip'`
    expect(await store.add('upload-lock:1', { owner: 'a' }, { ttlMs: 10_000 })).toBe(true)
    expect(await store.add('upload-lock:1', { owner: 'b' }, { ttlMs: 10_000 })).toBe(false)
    expect(await store.incr('rate-counter', { ttlMs: 10_000, by: 3 })).toBe(3)

    let releaseSlowStream!: () => void
    const slowGate = new Promise<void>((resolve) => {
      releaseSlowStream = resolve
    })
    const slowBody = new ReadableStream<Uint8Array>({
      async start(c) {
        c.enqueue(new Uint8Array([1, 2, 3]))
        await slowGate
        c.close()
      },
    })

    const inflight = storage.put({
      path: 'videos/inflight.bin',
      body: slowBody,
      server: 'node_a',
      meta: { ip: '198.51.100.77' },
    })

    // Даём первому потоку занять слот в `pgStore`
    await sleep(30)

    await expect(
      storage.put({
        path: 'videos/rejected.bin',
        body: new Uint8Array([9, 9]),
        server: 'node_a',
        meta: { ip: '198.51.100.77' },
      }),
    ).rejects.toBeInstanceOf(StorageConcurrencyError)

    releaseSlowStream()
    await inflight
  })
})
