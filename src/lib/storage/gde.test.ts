import { createHash, randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createSha256Hasher,
  createStorage,
  defineStorageLedger,
  hashStreamSha256,
  memoryDriver,
  memoryLedger,
  memoryStore,
  StorageHashMismatchError,
  StorageServerSuspendedError,
  type StorageDriver,
  type StorageServerSuspendedEvent,
} from './index.js'
import { jsonLedger, localDriver } from './local.js'
import { createStorageState, type StorageStateEvent } from './state.js'

const MB = 1024 * 1024

function makeBytes(length: number, seed = 7): Uint8Array {
  const out = new Uint8Array(length)
  for (let i = 0; i < length; i++) {
    out[i] = (i * 37 + seed) & 0xff
  }
  return out
}

function makeOnePassStream(bytes: Uint8Array, chunkSize = 1024): ReadableStream<Uint8Array> {
  let offset = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close()
        return
      }
      const next = Math.min(bytes.byteLength, offset + chunkSize)
      controller.enqueue(bytes.subarray(offset, next))
      offset = next
    },
  })
}

function spyDriver(inner: StorageDriver) {
  let putCalls = 0
  let headCalls = 0
  let lazyCalls = 0
  let delCalls = 0
  const driver: StorageDriver = {
    kind: inner.kind,
    ...(inner.publicBaseUrl !== undefined ? { publicBaseUrl: inner.publicBaseUrl } : {}),
    async put(input) {
      putCalls += 1
      return inner.put(input)
    },
    async head(path) {
      headCalls += 1
      return inner.head(path)
    },
    async lazy(path) {
      lazyCalls += 1
      return inner.lazy(path)
    },
    async del(path) {
      delCalls += 1
      return inner.del(path)
    },
  }
  return {
    driver,
    get putCalls() {
      return putCalls
    },
    get headCalls() {
      return headCalls
    },
    get lazyCalls() {
      return lazyCalls
    },
    get delCalls() {
      return delCalls
    },
  }
}

describe('#lib/storage Г — потоковый SHA-256, opt-in дедупликация и ref-counting частей', () => {
  it('считает потоковый SHA-256 побайтно идентично node:crypto на любых границах чанков', async () => {
    for (const sample of [
      new Uint8Array(0),
      new TextEncoder().encode('abc'),
      makeBytes(55, 1),
      makeBytes(56, 2),
      makeBytes(64, 3),
      makeBytes(200_123, 19),
    ]) {
      const expected = createHash('sha256').update(sample).digest('hex')
      const hasher = createSha256Hasher()
      for (let i = 0; i < sample.byteLength; i += 61) {
        hasher.update(sample.subarray(i, Math.min(sample.byteLength, i + 61)))
      }
      expect(hasher.digestHex()).toBe(expected)

      const streamed = await hashStreamSha256(makeOnePassStream(sample, 137))
      expect(streamed).toBe(expected)
    }
  })

  it('хеширует и дедуплицирует только файлы с включённым hash/expectedHash и не задваивает usedBytes', async () => {
    const raw = memoryDriver()
    const spy = spyDriver(raw)
    const storage = createStorage({
      servers: {
        s1: {
          driver: spy.driver,
          limits: { storageBytes: 4 * MB, fileBytes: 2 * MB },
        },
      },
    })

    const payload = makeBytes(4096, 11)
    const sha = createHash('sha256').update(payload).digest('hex')

    // 1. По умолчанию hash выключен — файлы не сравниваются и загружаются независимо
    const plainA = await storage.put({ path: 'plain/a.bin', body: payload })
    const plainB = await storage.put({ path: 'plain/b.bin', body: payload })
    expect(plainA.hash).toBeUndefined()
    expect(plainB.deduplicated).toBeUndefined()
    expect(spy.putCalls).toBe(2)

    // 2. Включаем hash: true только для целевых файлов
    const hashed1 = await storage.put({
      path: 'dedup/first.bin',
      body: payload,
      contentType: 'application/octet-stream',
      hash: true,
    })
    expect(hashed1.hash).toBe(sha)
    expect(hashed1.deduplicated).toBeUndefined()
    expect(spy.putCalls).toBe(3)

    // Повторная загрузка с replayable-телом вообще не вызывает driver.put (0 сетевых байт!)
    const hashed2 = await storage.put({
      path: 'dedup/second.bin',
      body: payload,
      contentType: 'application/octet-stream',
      hash: true,
    })
    expect(hashed2.hash).toBe(sha)
    expect(hashed2.deduplicated).toBe(true)
    expect(spy.putCalls).toBe(3)

    // Повторная загрузка однопроходного потока с известным expectedHash тоже не вызывает driver.put!
    const hashed3 = await storage.put({
      path: 'dedup/third.bin',
      body: makeOnePassStream(payload, 512),
      expectedHash: sha.toUpperCase(),
    })
    expect(hashed3.hash).toBe(sha)
    expect(hashed3.deduplicated).toBe(true)
    expect(spy.putCalls).toBe(3)

    // Искажённый поток при expectedHash бросает StorageHashMismatchError без мусора на сервере
    const corrupted = new Uint8Array(payload)
    corrupted[10] ^= 0xff
    await expect(
      storage.put({
        path: 'dedup/corrupted.bin',
        body: makeOnePassStream(corrupted, 512),
        expectedHash: sha,
      }),
    ).rejects.toBeInstanceOf(StorageHashMismatchError)
    expect(spy.putCalls).toBe(3)

    // В отчёте сервера физический объект посчитан ровно 1 раз (plain/a + plain/b + dedup/first = 3 * 4096)
    const report = await storage.report()
    const s1 = report.servers[0]!
    expect(s1.usedBytes).toBe(3 * payload.byteLength)
    expect(s1.filesCount).toBe(5)
    expect(s1.partsCount).toBe(3)

    // Удаление исходного пути `dedup/first.bin` и `dedup/second.bin` сохраняет общие байты для `dedup/third.bin`!
    expect(await storage.del('dedup/first.bin')).toBe(true)
    expect(await storage.del('dedup/second.bin')).toBe(true)
    const readThird = await storage.lazy('dedup/third.bin')
    expect(readThird).not.toBeNull()
    expect(new Uint8Array(await readThird!.arrayBuffer())).toEqual(payload)

    // И только удаление последней ссылки удаляет физический объект с сервера
    expect(await storage.del('dedup/third.bin')).toBe(true)
    expect(await raw.head('dedup/first.bin')).toBeNull()
  })

  it('корректно ведёт подсчёт ссылок при перезаписи и удалении в файловом jsonLedger', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mks-gde-local-'))
    try {
      const storage = createStorage({
        ledger: jsonLedger({ filePath: join(dir, 'ledger.json') }),
        servers: {
          disk: {
            driver: localDriver({ rootDir: join(dir, 'files') }),
            limits: { storageBytes: 8 * MB, fileBytes: 4 * MB },
          },
        },
      })

      const v1 = makeBytes(2048, 5)
      const v2 = makeBytes(1024, 9)

      await storage.put({ path: 'avatars/u1.bin', body: v1, hash: true })
      const deduped = await storage.put({ path: 'avatars/u2.bin', body: v1, hash: true })
      expect(deduped.deduplicated).toBe(true)

      // Перезапись u1 новым содержимым НЕ должна удалить старый физический файл, пока на него ссылается u2
      await storage.put({ path: 'avatars/u1.bin', body: v2, hash: true })

      const u2File = await storage.lazy('avatars/u2.bin')
      expect(u2File).not.toBeNull()
      expect(new Uint8Array(await u2File!.arrayBuffer())).toEqual(v1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('#lib/storage Д — серверная репликация (replicate + copy/clone), 0 N+1 и параллельное чтение', () => {
  it('параллельно реплицирует входящий поток (replicate) с разным шифрованием, даёт 0 N+1 запросов и балансирует чтение', async () => {
    const baseLedger = memoryLedger()
    let getFileCalls = 0
    const trackedLedger = defineStorageLedger({
      reserve: (p) => baseLedger.reserve(p),
      commit: (p) => baseLedger.commit(p),
      release: (id) => baseLedger.release(id),
      sweepExpired: (now) => baseLedger.sweepExpired(now),
      getFile(path) {
        getFileCalls += 1
        return baseLedger.getFile(path)
      },
      deleteFile: (p) => baseLedger.deleteFile(p),
      listFiles: (o) => baseLedger.listFiles(o),
      usage: (s) => baseLedger.usage(s),
      findByHash: (h, sz) => baseLedger.findByHash(h, sz),
      filterUnreferencedParts: (pts, ex) => baseLedger.filterUnreferencedParts(pts, ex),
      patchFile: (p, fn) => baseLedger.patchFile(p, fn),
      listMissingFiles: (o) => baseLedger.listMissingFiles(o),
    })

    const telemetry = createStorageState()
    const keyS2 = randomBytes(32)

    const storage = createStorage({
      defaultServer: 's1',
      writePool: ['s1', 's2', 's3'],
      readStrategy: 'round-robin',
      ledger: trackedLedger,
      state: telemetry.onEvent,
      servers: {
        s1: {
          driver: memoryDriver(),
          cdnUrl: 'https://cdn1.example.com',
          limits: { storageBytes: 8 * MB, fileBytes: 4 * MB },
        },
        s2: {
          driver: memoryDriver(),
          key: keyS2,
          limits: { storageBytes: 8 * MB, fileBytes: 4 * MB },
        },
        s3: {
          driver: memoryDriver(),
          cdnUrl: 'https://cdn3.example.com',
          limits: { storageBytes: 8 * MB, fileBytes: 4 * MB },
        },
      },
    })

    const data = makeBytes(8192, 42)

    // Клиент отправляет однопроходный поток ОДИН раз, а сервер сам разветвляет его на s1 + s2 + s3!
    const stored = await storage.put({
      path: 'media/clip.mp4',
      body: makeOnePassStream(data, 1024),
      contentType: 'video/mp4',
      replicate: ['s2', 's3'],
      hash: true,
    })
    expect(stored.server).toBe('s1')
    expect(stored.replicas).toEqual(['s2', 's3'])

    // Ни одной технической записи `@replica:*` в ledger нет
    expect(await baseLedger.getFile('@replica:s2:media/clip.mp4')).toBeNull()

    // Чтение выполняет РОВНО 1 вызов ledger.getFile (0 N+1 запросов по списку серверов!)
    getFileCalls = 0
    const opened = await storage.lazy('media/clip.mp4')
    expect(opened).not.toBeNull()
    expect(getFileCalls).toBe(1)

    // Round-robin распределяет 6 чтений равномерно по всем 3 серверам (включая расшифровку s2 на лету)
    telemetry.reset()
    for (let i = 0; i < 6; i++) {
      const f = await storage.lazy('media/clip.mp4', { readStrategy: 'round-robin' })
      expect(new Uint8Array(await f!.arrayBuffer())).toEqual(data)
    }
    const snap = telemetry.getSnapshot()
    expect(snap.servers.s1?.bytesRead).toBe(2 * data.byteLength)
    expect(snap.servers.s2?.bytesRead).toBe(2 * data.byteLength)
    expect(snap.servers.s3?.bytesRead).toBe(2 * data.byteLength)

    // Consistent-hash стабильно привязывает одинаковый affinityKey к одному и тому же серверу
    const firstChoice = await storage.head('media/clip.mp4', {
      readStrategy: 'consistent-hash',
      affinityKey: 'post-777',
    })
    for (let i = 0; i < 5; i++) {
      const nextChoice = await storage.head('media/clip.mp4', {
        readStrategy: 'consistent-hash',
        affinityKey: 'post-777',
      })
      expect(nextChoice?.server).toBe(firstChoice?.server)
    }

    // Сильный ETag в serve() идентичен независимо от выбранной реплики (корректный If-Range докачки)
    const res1 = await storage.serve(
      'media/clip.mp4',
      new Request('http://test.local/media/clip.mp4'),
      { server: 's1' },
    )
    const res2 = await storage.serve(
      'media/clip.mp4',
      new Request('http://test.local/media/clip.mp4'),
      { server: 's2' },
    )
    expect(res1.headers.get('etag')).toBeTruthy()
    expect(res1.headers.get('etag')).toBe(res2.headers.get('etag'))

    // CDN 302 редирект также учитывает readStrategy между CDN-серверами (s1 и s3)
    const cdnLocations = new Set<string | null>()
    for (let i = 0; i < 4; i++) {
      const cdnRes = await storage.serve(
        'media/clip.mp4',
        new Request('http://test.local/media/clip.mp4'),
        { cdn: true, readStrategy: 'round-robin' },
      )
      expect(cdnRes.status).toBe(302)
      cdnLocations.add(cdnRes.headers.get('location'))
    }
    expect(cdnLocations.has('https://cdn1.example.com/media/clip.mp4')).toBe(true)
    expect(cdnLocations.has('https://cdn3.example.com/media/clip.mp4')).toBe(true)
  })
})

describe('#lib/storage Е — фиксация пропаж, авто-блокировка сервера (suspended) и reconcile()', () => {
  it('фиксирует пропавшие файлы, переключается на реплику, блокирует сервер при пороге и реактивирует через reconcile()', async () => {
    const rawS1 = memoryDriver()
    const rawS2 = memoryDriver()
    const store = memoryStore()
    const telemetry = createStorageState()
    const events: StorageStateEvent[] = []
    const suspendedCallbacks: StorageServerSuspendedEvent[] = []

    const storage = createStorage({
      defaultServer: 's1',
      writePool: ['s1', 's2'],
      writeStrategy: 'priority',
      missingThreshold: 2,
      store,
      state: (ev) => {
        events.push(ev)
        telemetry.onEvent(ev)
      },
      onServerSuspended(ev) {
        suspendedCallbacks.push(ev)
      },
      servers: {
        s1: {
          driver: rawS1,
          limits: { storageBytes: 4 * MB, fileBytes: 2 * MB },
        },
        s2: {
          driver: rawS2,
          limits: { storageBytes: 4 * MB, fileBytes: 2 * MB },
        },
      },
    })

    const file1Bytes = makeBytes(512, 1)
    const file2Bytes = makeBytes(512, 2)

    await storage.put({ path: 'docs/one.bin', body: file1Bytes, replicate: 2 })
    await storage.put({ path: 'docs/two.bin', body: file2Bytes, replicate: 2 })

    // Имитируем тихую пропажу обоих файлов напрямую на диске/бакете s1 (404 без сетевой ошибки)
    await rawS1.del('docs/one.bin')
    await rawS1.del('docs/two.bin')

    // 1-я пропажа: чтение прозрачно отдаёт данные со здоровой реплики s2 и помечает missingAt (1/2)
    const readOne = await storage.lazy('docs/one.bin')
    expect(readOne).not.toBeNull()
    expect(new Uint8Array(await readOne!.arrayBuffer())).toEqual(file1Bytes)
    expect(storage.isServerSuspended('s1')).toBe(false)

    const statOne = await storage.stat('docs/one.bin')
    expect(statOne?.status).toBe('degraded')
    expect(statOne?.parts[0]?.missingAt).toBeTypeOf('number')

    // Повторное чтение того же файла НЕ накручивает счётчик повторно
    await storage.lazy('docs/one.bin')
    expect(storage.isServerSuspended('s1')).toBe(false)

    // 2-я уникальная пропажа пробивает missingThreshold = 2 -> s1 автоматически переходит в suspended!
    const readTwo = await storage.lazy('docs/two.bin')
    expect(readTwo).not.toBeNull()
    expect(new Uint8Array(await readTwo!.arrayBuffer())).toEqual(file2Bytes)

    expect(storage.isServerSuspended('s1')).toBe(true)
    expect(suspendedCallbacks).toHaveLength(1)
    expect(suspendedCallbacks[0]).toMatchObject({
      server: 's1',
      reason: 'missing-files',
      missingCount: 2,
    })

    const repWhileSuspended = await storage.report()
    const s1Rep = repWhileSuspended.servers.find((s) => s.server === 's1')!
    expect(s1Rep.suspended).toBe(true)
    expect(s1Rep.suspendedReason).toBe('missing-files')
    expect(s1Rep.missingCount).toBe(2)

    // Прямая запись на заблокированный s1 отклоняется, а авто-запись идёт в здоровый s2
    await expect(
      storage.put({ path: 'docs/direct.bin', body: file1Bytes, server: 's1' }),
    ).rejects.toBeInstanceOf(StorageServerSuspendedError)

    const autoSaved = await storage.put({ path: 'docs/auto.bin', body: file1Bytes })
    expect(autoSaved.server).toBe('s2')

    // Пока файлы не возвращены на s1, reconcile() оставляет сервер в списке проблемных
    const recStillMissing = await storage.reconcile({ autoResumeServers: true })
    expect(recStillMissing.restoredFiles).toEqual([])
    expect(recStillMissing.stillMissingFiles).toEqual(['docs/one.bin', 'docs/two.bin'])
    expect(storage.isServerSuspended('s1')).toBe(true)

    // Администратор восстанавливает физические файлы на s1, и проход reconcile() снимает блокировку!
    await rawS1.put({
      path: 'docs/one.bin',
      stream: makeOnePassStream(file1Bytes),
      size: file1Bytes.byteLength,
      contentType: 'application/octet-stream',
      lastModified: Date.now(),
    })
    await rawS1.put({
      path: 'docs/two.bin',
      stream: makeOnePassStream(file2Bytes),
      size: file2Bytes.byteLength,
      contentType: 'application/octet-stream',
      lastModified: Date.now(),
    })

    const recRestored = await storage.reconcile({ autoResumeServers: true })
    expect(recRestored.restoredFiles).toEqual(['docs/one.bin', 'docs/two.bin'])
    expect(recRestored.restoredParts).toBe(2)
    expect(recRestored.resumedServers).toEqual(['s1'])
    expect(storage.isServerSuspended('s1')).toBe(false)

    const statAfter = await storage.stat('docs/one.bin')
    expect(statAfter?.status).toBe('ok')
    expect(statAfter?.parts[0]?.missingAt).toBeUndefined()
    expect(events.some((e) => e.type === 'server:resumed' && e.server === 's1')).toBe(true)
  })
})
