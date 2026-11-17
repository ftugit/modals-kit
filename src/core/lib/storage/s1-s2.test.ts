import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  createBandwidthLimiter,
  createStorage,
  decryptedSize,
  encryptedSize,
  memoryDriver,
  memoryLedger,
  memoryStore,
  StorageConcurrencyError,
  StorageCryptoError,
  type StorageDriver,
} from './index.js'
import { localSpool } from './local.js'
import { createStorageState } from './state.js'

function patternedBuffer(size: number, seed = 17): Buffer {
  const buf = Buffer.alloc(size)
  for (let i = 0; i < size; i++) {
    buf[i] = (i * 41 + seed) & 0xff
  }
  return buf
}

describe('S1: потоковое шифрование AES-256-GCM (64 КиБ STREAM + O(1) Range)', () => {
  it('точно вычисляет encryptedSize/decryptedSize на всех граничных размерах (0, 1, 65535, 65536, 65537, 200 КиБ)', async () => {
    const rawDriver = memoryDriver()
    const storage = createStorage({
      servers: {
        enc: {
          driver: rawDriver,
          limits: { storageBytes: 10 * 1024 * 1024, fileBytes: 5 * 1024 * 1024 },
          key: 'correct-horse-battery-staple',
        },
      },
    })

    for (const len of [0, 1, 65_535, 65_536, 65_537, 200 * 1024 + 13]) {
      const wantStored = encryptedSize(len)
      expect(decryptedSize(wantStored)).toBe(len)

      const plain = patternedBuffer(len, len & 0x7f)
      const path = `bounds/b-${len}.bin`
      const stored = await storage.put({
        path,
        body: plain,
        contentType: 'application/octet-stream',
      })
      expect(stored.size).toBe(len)
      expect(stored.storedBytes).toBe(wantStored)
      expect(stored.encrypted).toBe(true)

      // На сыром драйвере лежит именно шифротекст длиной wantStored (не совпадающий с открытым текстом)
      const rawMeta = await rawDriver.head(path)
      expect(rawMeta?.size).toBe(wantStored)
      if (len > 32) {
        const rawLazy = await rawDriver.lazy(path)
        const rawBytes = Buffer.from(await rawLazy!.arrayBuffer())
        expect(Buffer.compare(rawBytes.subarray(32, 32 + 32), plain.subarray(0, 32))).not.toBe(0)
      }

      // Полное чтение через serve() возвращает точный открытый текст
      const res = await storage.serve(path, new Request('http://test.local/f'))
      expect(res.status).toBe(200)
      expect(Buffer.compare(Buffer.from(await res.arrayBuffer()), plain)).toBe(0)
    }
  })

  it('читает Range 206 поперёк границы 64-КБ блоков за O(1), ловит порчу байта и поддерживает key: null', async () => {
    const baseDriver = memoryDriver()
    const readSpans: Array<{ start: number; end: number }> = []

    const countingDriver: StorageDriver = {
      ...baseDriver,
      async lazy(path) {
        const inner = await baseDriver.lazy(path)
        if (!inner) return null
        const { StreamFile } = await import('./index.js')
        return new StreamFile(
          {
            byteLength: inner.size,
            stream(start = 0, end = inner.size) {
              readSpans.push({ start, end })
              return inner.slice(start, end).stream()
            },
          },
          inner.name,
          { type: inner.type, lastModified: inner.lastModified },
        )
      },
    }

    const storage = createStorage({
      servers: {
        vault: {
          driver: countingDriver,
          limits: { storageBytes: 10 * 1024 * 1024, fileBytes: 5 * 1024 * 1024 },
          key: new Uint8Array(32).fill(0x5a),
        },
        vault_mirror: {
          driver: memoryDriver(),
          limits: { storageBytes: 10 * 1024 * 1024, fileBytes: 5 * 1024 * 1024 },
          key: new Uint8Array(32).fill(0x5a),
        },
      },
    })

    // 4 полных блока (256 КиБ): проверим чтение среза на стыке блоков #1 и #2 (не трогая блоки #0 и #3!)
    const total = 4 * 65_536
    const plain = patternedBuffer(total, 91)
    await storage.put({ path: 'movie.bin', body: plain })

    readSpans.length = 0
    const seamStart = 2 * 65_536 - 20
    const seamEnd = 2 * 65_536 + 25
    const rangeRes = await storage.serve(
      'movie.bin',
      new Request('http://test.local/movie.bin', {
        headers: { range: `bytes=${seamStart}-${seamEnd - 1}` },
      }),
    )
    expect(rangeRes.status).toBe(206)
    expect(
      Buffer.compare(
        Buffer.from(await rangeRes.arrayBuffer()),
        plain.subarray(seamStart, seamEnd),
      ),
    ).toBe(0)

    // Доказательство O(1): прочитан только 32-байтный заголовок + ровно 2 блока (#1 и #2), а не все 256 КиБ!
    const totalRawRead = readSpans.reduce((acc, s) => acc + (s.end - s.start), 0)
    expect(totalRawRead).toBe(32 + 2 * (65_536 + 16))

    // Быстрое копирование между серверами с одинаковым ключом переносит шифротекст байт-в-байт и сохраняет читаемость
    const copied = await storage.copy({ path: 'movie.bin', from: 'vault', to: 'vault_mirror' })
    expect(copied.encrypted).toBe(true)
    const mirrorRange = await storage.serve(
      'movie.bin',
      new Request('http://test.local/movie.bin', {
        headers: { range: `bytes=${seamStart}-${seamEnd - 1}` },
      }),
      { server: 'vault_mirror' },
    )
    expect(mirrorRange.status).toBe(206)
    expect(
      Buffer.compare(
        Buffer.from(await mirrorRange.arrayBuffer()),
        plain.subarray(seamStart, seamEnd),
      ),
    ).toBe(0)

    // Принудительный сброс `key: null` на конкретный вызов сохраняет открытые байты без шифрования
    const unenc = patternedBuffer(128, 3)
    const plainStored = await storage.put({
      path: 'public.bin',
      body: unenc,
      key: null,
    })
    expect(plainStored.encrypted).toBe(false)
    expect(plainStored.storedBytes).toBe(128)

    // Подделка 1 байта шифротекста обязана ронять чтение с StorageCryptoError
    const rawMovie = await baseDriver.lazy('movie.bin')
    const corrupted = Buffer.from(await rawMovie!.arrayBuffer())
    corrupted[100] ^= 0xff
    await baseDriver.put({
      path: 'movie.bin',
      stream: new Blob([corrupted]).stream() as ReadableStream<Uint8Array>,
      size: corrupted.byteLength,
      contentType: 'application/octet-stream',
      lastModified: Date.now(),
    })

    const badLazy = await storage.lazy('movie.bin')
    await expect(badLazy!.arrayBuffer()).rejects.toThrow(StorageCryptoError)
  })
})

describe('S1: лимитеры rate + concurrency (reject/queue/preempt), store/tech/state и console.error', () => {
  it('дозирует скорость rate (со снятием через rate: 0), ограничивает потоки (429 / queue / preempt) и мягко деградирует с console.error', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const telemetry = createStorageState()

      // 1. Проверка деградации statTtlMs без store и scope="ip" без ip + cdn: true без cdnUrl
      const degraded = createStorage({
        state: telemetry.onEvent,
        servers: {
          main: {
            driver: memoryDriver(),
            limits: { storageBytes: 10 * 1024 * 1024, fileBytes: 5 * 1024 * 1024 },
            statTtlMs: 5_000,
            concurrency: { max: 1, scope: 'ip', mode: 'reject' },
          },
        },
      })
      // Уже на старте statTtlMs без store обязан залогировать предупреждение в console.error
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('statTtlMs'))

      errSpy.mockClear()
      await degraded.put({ path: 'doc.txt', body: new TextEncoder().encode('hello world') })
      // put без meta.ip при scope="ip" логирует деградацию и НЕ падает
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('concurrency.scope="ip"'))

      errSpy.mockClear()
      const cdnFallback = await degraded.serve(
        'doc.txt',
        new Request('http://test.local/doc.txt'),
        { cdn: true },
      )
      expect(cdnFallback.status).toBe(200)
      expect(await cdnFallback.text()).toBe('hello world')
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('cdn: true'))

      expect(telemetry.getSnapshot().bytesWritten).toBe(11)
      expect(telemetry.getSnapshot().bytesRead).toBe(11)

      // 2. С подключённым store, cdnUrl и tech.resolveMeta — всё работает штатно (302 CDN и 429 по IP)
      const store = memoryStore()
      let slowUnlock!: () => void
      const slowGate = new Promise<void>((r) => {
        slowUnlock = r
      })

      const slowDriver: StorageDriver = {
        kind: 'slow-mem',
        async put(inp) {
          const buf = await new Response(inp.stream).arrayBuffer()
          return {
            path: inp.path,
            size: buf.byteLength,
            contentType: inp.contentType,
            lastModified: inp.lastModified,
          }
        },
        async head(path) {
          return { path, size: 16, contentType: 'application/octet-stream', lastModified: 1 }
        },
        async lazy(path) {
          const { StreamFile } = await import('./index.js')
          return new StreamFile(
            {
              byteLength: 16,
              stream() {
                let step = 0
                return new ReadableStream({
                  async pull(c) {
                    if (step === 0) {
                      step = 1
                      c.enqueue(new Uint8Array(8).fill(1))
                      return
                    }
                    if (step === 1) {
                      step = 2
                      await slowGate
                      c.enqueue(new Uint8Array(8).fill(2))
                      c.close()
                    }
                  },
                })
              },
            },
            path,
          )
        },
        async del() {
          return true
        },
      }

      const guarded = createStorage({
        store,
        tech: {
          resolveMeta: (req) => ({ ip: req.headers.get('x-real-ip') ?? undefined }),
        },
        servers: {
          edge: {
            driver: slowDriver,
            limits: { storageBytes: 10 * 1024 * 1024, fileBytes: 5 * 1024 * 1024 },
            cdnUrl: 'https://cdn.example.test/files',
            statTtlMs: 60_000,
            concurrency: { max: 1, scope: 'ip', mode: 'reject' },
          },
        },
      })

      const cdnRedirect = await guarded.serve(
        'clip.mp4',
        new Request('http://test.local/clip.mp4', { headers: { 'x-real-ip': '203.0.113.10' } }),
        { cdn: true },
      )
      expect(cdnRedirect.status).toBe(302)
      expect(cdnRedirect.headers.get('location')).toBe('https://cdn.example.test/files/clip.mp4')

      // Первый поток с IP 203.0.113.10 занимает слот (останавливается на slowGate после первых 8 байт)
      const res1 = await guarded.serve(
        'clip.mp4',
        new Request('http://test.local/clip.mp4', { headers: { 'x-real-ip': '203.0.113.10' } }),
      )
      expect(res1.status).toBe(200)
      // Второй параллельный запрос с ТОГО ЖЕ IP получает 429!
      const res2 = await guarded.serve(
        'clip.mp4',
        new Request('http://test.local/clip.mp4', { headers: { 'x-real-ip': '203.0.113.10' } }),
      )
      expect(res2.status).toBe(429)
      // Запрос с ДРУГОГО IP проходит свободно (200), как и запрос со снятым лимитом concurrency: 0!
      const resBypass = await guarded.serve(
        'clip.mp4',
        new Request('http://test.local/clip.mp4', { headers: { 'x-real-ip': '203.0.113.10' } }),
        { concurrency: 0 },
      )
      expect(resBypass.status).toBe(200)

      slowUnlock()
      await res1.arrayBuffer()
      await resBypass.arrayBuffer()

      // 3. Проверка preempt (вытеснение старого потока новым) и rate limiter
      const preemptStorage = createStorage({
        servers: {
          p: {
            driver: slowDriver,
            limits: { storageBytes: 10 * 1024 * 1024, fileBytes: 5 * 1024 * 1024 },
            concurrency: { max: 1, mode: 'preempt' },
          },
        },
      })
      let holdPreempt!: () => void
      const holdPromise = new Promise<void>((r) => {
        holdPreempt = r
      })
      const slowPreemptDriver: StorageDriver = {
        ...slowDriver,
        async lazy(path) {
          const { StreamFile } = await import('./index.js')
          return new StreamFile(
            {
              byteLength: 8,
              stream() {
                return new ReadableStream({
                  async pull(c) {
                    await holdPromise
                    c.enqueue(new Uint8Array(8))
                    c.close()
                  },
                })
              },
            },
            path,
          )
        },
      }
      preemptStorage.setServer('p', {
        driver: slowPreemptDriver,
        limits: { storageBytes: 10 * 1024 * 1024, fileBytes: 5 * 1024 * 1024 },
        concurrency: { max: 1, mode: 'preempt' },
      })

      const streamA = await preemptStorage.get('item.bin')
      const readAPromise = new Response(streamA!).arrayBuffer()
      await new Promise((r) => setTimeout(r, 15))
      // Второй поток вытесняет первый — первый обязан упасть с StorageConcurrencyError!
      const streamB = await preemptStorage.get('item.bin')
      const readBPromise = new Response(streamB!).arrayBuffer()
      await expect(readAPromise).rejects.toThrow(StorageConcurrencyError)
      holdPreempt()
      expect((await readBPromise).byteLength).toBe(8)

      // 4. Проверка дозирования полосы rate (64 КиБ при 256 КиБ/сек занимают заметное время, а rate: 0 мгновенно)
      const limiter = createBandwidthLimiter(200 * 1024)
      const throttledStorage = createStorage({
        servers: {
          slow: {
            driver: memoryDriver(),
            limits: { storageBytes: 10 * 1024 * 1024, fileBytes: 5 * 1024 * 1024 },
            rate: limiter,
          },
        },
      })
      const t0 = performance.now()
      await throttledStorage.put({ path: 'throttled.bin', body: patternedBuffer(40 * 1024) })
      const elapsedThrottled = performance.now() - t0
      expect(elapsedThrottled).toBeGreaterThanOrEqual(80)

      const t1 = performance.now()
      await throttledStorage.put({
        path: 'fast.bin',
        body: patternedBuffer(40 * 1024),
        rate: 0,
      })
      expect(performance.now() - t1).toBeLessThan(60)
    } finally {
      errSpy.mockRestore()
    }
  })
})

describe('S2: мультисерверная нарезка split, allowSplit, stageToDisk (localSpool) и clone()', () => {
  it('нарезает большой файл по серверам (с учётом AES-256-GCM оверхеда и allowSplit: false), отдаёт 206 Range поперёк стыка серверов, откатывает при сбое и клонирует', async () => {
    const tmpSpoolDir = await mkdtemp(join(tmpdir(), 'mk-spool-test-'))
    try {
      const ledger = memoryLedger()
      const storage = createStorage({
        ledger,
        spool: localSpool(tmpSpoolDir),
        writePool: ['no_split', 's1_enc', 's2_plain'],
        servers: {
          no_split: {
            driver: memoryDriver(),
            limits: { storageBytes: 90 * 1024, fileBytes: 90 * 1024 },
            allowSplit: false,
          },
          s1_enc: {
            driver: memoryDriver(),
            limits: { storageBytes: 110 * 1024, fileBytes: 110 * 1024 },
            key: 'part-secret-s1',
          },
          s2_plain: {
            driver: memoryDriver(),
            limits: { storageBytes: 200 * 1024, fileBytes: 110 * 1024 },
          },
          backup: {
            driver: memoryDriver(),
            limits: { storageBytes: 2 * 1024 * 1024, fileBytes: 2 * 1024 * 1024 },
          },
        },
      })

      // 1. Не-sliceable ReadableStream без stageToDisk с явным split: true обязан отклоняться!
      const rawStreamNoSize = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new Uint8Array(1024))
          c.close()
        },
      })
      await expect(
        storage.put({ path: 'bad-split.bin', body: rawStreamNoSize, split: true }),
      ).rejects.toThrow(/stageToDisk/)

      // 2. Тот же самый неизвестного размера ReadableStream с stageToDisk: true сохраняется во временный спул,
      //    получает точный size (220 КиБ), нарезается между s1_enc (зашифрован!) и s2_plain (минуя no_split!),
      //    а временный файл спула удаляется!
      const bigPayload = patternedBuffer(220 * 1024, 73)
      let cursor = 0
      const liveUnknownStream = new ReadableStream<Uint8Array>({
        pull(c) {
          if (cursor >= bigPayload.byteLength) {
            c.close()
            return
          }
          const step = Math.min(32 * 1024, bigPayload.byteLength - cursor)
          c.enqueue(bigPayload.subarray(cursor, cursor + step))
          cursor += step
        },
      })

      const storedSplit = await storage.put({
        path: 'archive/release.tar',
        body: liveUnknownStream,
        server: 'auto',
        stageToDisk: true,
      })
      expect(storedSplit.size).toBe(bigPayload.byteLength)
      expect(storedSplit.partsCount).toBeGreaterThanOrEqual(2)

      // Спул на диске обязан быть пуст после завершения put()
      expect(await readdir(tmpSpoolDir)).toEqual([])

      // Сервер no_split (allowSplit: false) НЕ должен получить ни одного байта нарезанного файла!
      const rec = await storage.stat('archive/release.tar')
      expect(rec).not.toBeNull()
      expect(rec!.parts.some((p) => p.server === 'no_split')).toBe(false)
      expect(rec!.parts[0]?.server).toBe('s1_enc')
      expect(rec!.parts[0]?.encrypted).toBe(true)
      expect(rec!.parts.some((p) => p.server === 's2_plain')).toBe(true)

      // Range 206 чтение ПРЯМО ПОПЕРЁК стыка зашифрованной части на s1_enc и открытой части на s2_plain!
      const part0End = rec!.parts[0]!.plainBytes
      const crossStart = part0End - 150
      const crossEnd = part0End + 180
      const crossRes = await storage.serve(
        'archive/release.tar',
        new Request('http://test.local/archive/release.tar', {
          headers: { range: `bytes=${crossStart}-${crossEnd - 1}` },
        }),
      )
      expect(crossRes.status).toBe(206)
      expect(
        Buffer.compare(
          Buffer.from(await crossRes.arrayBuffer()),
          bigPayload.subarray(crossStart, crossEnd),
        ),
      ).toBe(0)

      // 3. Проверка атомарного отката брони и уже записанных кусков при падении второго сервера во время split
      const failingDriver: StorageDriver = {
        kind: 'broken',
        async put() {
          throw new Error('simulated second server crash')
        },
        async head() {
          return null
        },
        async lazy() {
          return null
        },
        async del() {
          return false
        },
      }
      const part1Driver = memoryDriver()
      const rollbackStorage = createStorage({
        servers: {
          ok_first: {
            driver: part1Driver,
            limits: { storageBytes: 60 * 1024, fileBytes: 60 * 1024 },
          },
          crash_second: {
            driver: failingDriver,
            limits: { storageBytes: 60 * 1024, fileBytes: 60 * 1024 },
          },
        },
      })
      await expect(
        rollbackStorage.put({
          path: 'tx/will-fail.bin',
          body: patternedBuffer(100 * 1024, 5),
          server: 'auto',
        }),
      ).rejects.toThrow('simulated second server crash')

      // Первый кусок на ok_first удалён, а reservedBytes и usedBytes вернулись в 0!
      expect(await part1Driver.head('tx/will-fail.bin.part.0')).toBeNull()
      const rbReport = await rollbackStorage.report()
      expect(rbReport.servers.every((s) => s.usedBytes === 0 && s.reservedBytes === 0)).toBe(true)

      // 4. Клонирование (`clone`) собирает склеенный файл на целевой сервер `backup`
      const cloneRep = await storage.clone({
        from: 's1_enc',
        to: 'backup',
        prefix: 'archive/',
      })
      expect(cloneRep.clonedPaths).toEqual(['archive/release.tar'])
      expect(cloneRep.bytesTransferred).toBe(bigPayload.byteLength)

      const backupFull = await storage.serve(
        'archive/release.tar',
        new Request('http://test.local/archive/release.tar'),
        { server: 'backup' },
      )
      expect(backupFull.status).toBe(200)
      expect(Buffer.compare(Buffer.from(await backupFull.arrayBuffer()), bigPayload)).toBe(0)
    } finally {
      await rm(tmpSpoolDir, { recursive: true, force: true })
    }
  })
})
