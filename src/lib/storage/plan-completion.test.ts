import { describe, expect, it } from 'vitest'
import {
  createConcurrencyGate,
  createStorage,
  memoryDriver,
  memoryLedger,
  StorageOverwriteError,
  StreamFile,
  type StorageDriver,
} from './index.js'

function deterministicBytes(length: number, seed = 41): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(length))
  for (let i = 0; i < length; i++) {
    out[i] = (i * 53 + seed) & 0xff
  }
  return out
}

describe('#lib/storage S6a — полное соответствие спецификации §1.3 плана', () => {
  it('поддерживает все цели serve(string | File | StoredFileRecord), включая склейку split-записи и Range 206', async () => {
    const ledger = memoryLedger()
    const storage = createStorage({
      ledger,
      tech: {
        publicOrigin: 'https://files.modals.test/',
      },
      servers: {
        a: {
          driver: memoryDriver({ publicBaseUrl: '/api/files' }),
          key: 'shard-a-secret',
          limits: { storageBytes: 200_000, fileBytes: 80_000 },
        },
        b: {
          driver: memoryDriver({ publicBaseUrl: 'https://custom-cdn.example/raw' }),
          key: 'shard-b-secret',
          limits: { storageBytes: 200_000, fileBytes: 80_000 },
        },
      },
    })

    // 1. tech.publicOrigin приклеивается к относительному publicBaseUrl, но не ломает абсолютный
    const small = await storage.put({
      path: 'single/hello.txt',
      body: new TextEncoder().encode('привет'),
      contentType: 'text/plain; charset=utf-8',
      server: 'a',
    })
    expect(small.url).toBe('https://files.modals.test/api/files/single/hello.txt')

    const onCustom = await storage.put({
      path: 'single/abs.txt',
      body: new TextEncoder().encode('abs'),
      contentType: 'text/plain',
      server: 'b',
    })
    expect(onCustom.url).toBe('https://custom-cdn.example/raw/single/abs.txt?server=b')

    // 2. Нарезаем файл 110 КиБ между зашифрованными серверами `a` и `b` и раздаём прямо по StoredFileRecord
    const splitPayload = deterministicBytes(110_000, 7)
    const storedSplit = await storage.put({
      path: 'movies/demo.mp4',
      body: new Blob([splitPayload], { type: 'video/mp4' }),
    })
    expect(storedSplit.partsCount).toBe(2)
    expect(storedSplit.url).toBe('https://files.modals.test/api/files/movies/demo.mp4')

    const record = await storage.stat('movies/demo.mp4')
    expect(record).not.toBeNull()
    expect(record!.parts).toHaveLength(2)

    const seamRes = await storage.serve(
      record!,
      new Request('http://localhost/movies/demo.mp4', {
        headers: { range: 'bytes=70000-85000' },
      }),
      { download: 'Фрагмент ролика.mp4' },
    )
    expect(seamRes.status).toBe(206)
    expect(seamRes.headers.get('content-disposition')).toContain('filename*=UTF-8\'\'')
    const seamBytes = new Uint8Array(await seamRes.arrayBuffer())
    expect(seamBytes).toEqual(splitPayload.subarray(70_000, 85_001))

    // 3. Раздача произвольного File и ленивого StreamFile напрямую через storage.serve(file, req)
    const adhocPayload = deterministicBytes(4_096, 99)
    const adhocFile = new File([adhocPayload], 'Отчёт 2026.pdf', {
      type: 'application/pdf',
    })
    const fileRes = await storage.serve(
      adhocFile,
      new Request('http://localhost/adhoc', {
        headers: { range: 'bytes=100-299' },
      }),
      { download: true },
    )
    expect(fileRes.status).toBe(206)
    expect(fileRes.headers.get('content-disposition')).toContain(
      encodeURIComponent('Отчёт 2026.pdf'),
    )
    expect(new Uint8Array(await fileRes.arrayBuffer())).toEqual(
      adhocPayload.subarray(100, 300),
    )

    const lazyOpened = await storage.lazy('movies/demo.mp4')
    expect(lazyOpened).toBeInstanceOf(StreamFile)
    const lazyRes = await storage.serve(
      lazyOpened!,
      new Request('http://localhost/lazy-full'),
    )
    expect(lazyRes.status).toBe(200)
    expect(new Uint8Array(await lazyRes.arrayBuffer())).toEqual(splitPayload)
  })

  it('соблюдает overwrite: false в put(), stat(path, { server }) для реплик и общий ConcurrencyGate между инстансами', async () => {
    const ledger = memoryLedger()
    const drvA = memoryDriver()
    const drvB = memoryDriver()

    const storage = createStorage({
      ledger,
      servers: {
        a: { driver: drvA, limits: { storageBytes: 1_000_000, fileBytes: 500_000 } },
        b: { driver: drvB, limits: { storageBytes: 1_000_000, fileBytes: 500_000 } },
      },
    })

    const original = new TextEncoder().encode('v1-immutable')
    await storage.put({
      path: 'docs/readme.txt',
      body: original,
      contentType: 'text/plain',
      overwrite: false,
    })

    await expect(
      storage.put({
        path: 'docs/readme.txt',
        body: new TextEncoder().encode('v2-should-fail'),
        overwrite: false,
      }),
    ).rejects.toThrow(StorageOverwriteError)

    const preserved = await storage.lazy('docs/readme.txt')
    expect(new Uint8Array(await preserved!.arrayBuffer())).toEqual(original)

    // Создаём реплику на сервере `b` и проверяем stat(path, { server: 'b' })
    await storage.copy({ path: 'docs/readme.txt', from: 'a', to: 'b' })
    const statB = await storage.stat('docs/readme.txt', { server: 'b' })
    expect(statB).not.toBeNull()
    expect(statB!.parts[0]!.server).toBe('b')
    expect(statB!.size).toBe(original.byteLength)

    // Общий createConcurrencyGate разделяет лимит между двумя независимыми вызовами createStorage
    let releaseSlow!: () => void
    const slowWait = new Promise<void>((r) => {
      releaseSlow = r
    })
    const slowDriver: StorageDriver = {
      kind: 'slow-mem',
      async put(inp) {
        return drvA.put(inp)
      },
      async head(p) {
        return drvA.head(p)
      },
      async del(p) {
        return drvA.del(p)
      },
      async lazy(p) {
        return new StreamFile(
          {
            byteLength: 16,
            stream() {
              let step = 0
              return new ReadableStream({
                async pull(c) {
                  if (step === 0) {
                    step = 1
                    c.enqueue(new Uint8Array(8).fill(7))
                    return
                  }
                  await slowWait
                  c.enqueue(new Uint8Array(8).fill(8))
                  c.close()
                },
              })
            },
          },
          p,
        )
      },
    }

    const sharedGate = createConcurrencyGate('shared-dl', { max: 1, mode: 'reject' })
    const s1 = createStorage({
      servers: { a: { driver: slowDriver, limits: { storageBytes: 100_000, fileBytes: 50_000 } } },
    })
    const s2 = createStorage({
      servers: { a: { driver: slowDriver, limits: { storageBytes: 100_000, fileBytes: 50_000 } } },
    })

    const r1 = await s1.serve('docs/readme.txt', new Request('http://localhost/1'), {
      concurrency: sharedGate,
    })
    expect(r1.status).toBe(200)

    const r2 = await s2.serve('docs/readme.txt', new Request('http://localhost/2'), {
      concurrency: sharedGate,
    })
    expect(r2.status).toBe(429)

    releaseSlow()
    await r1.arrayBuffer()
  })
})
