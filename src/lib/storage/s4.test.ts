import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createStorage,
  memoryDriver,
  StorageUploadError,
  StreamFile,
  type DriverPutInput,
  type DriverStoredMeta,
  type StorageDriver,
} from './index.js'
import { localSpool } from './local.js'
import { createStorageState, type StorageStateEvent } from './state.js'

const MB = 1024 * 1024

function deterministicBytes(length: number, seed = 17): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(length))
  for (let i = 0; i < length; i++) {
    out[i] = (i * 37 + seed) & 0xff
  }
  return out
}

function createFlakyDriver(inner: StorageDriver) {
  let failWrites = false
  let failReads = false

  const driver: StorageDriver = {
    kind: `flaky-${inner.kind}`,
    ...(inner.publicBaseUrl !== undefined ? { publicBaseUrl: inner.publicBaseUrl } : {}),
    async put(input: DriverPutInput): Promise<DriverStoredMeta> {
      if (failWrites) {
        throw new Error('upstream storage 503 Service Unavailable')
      }
      return inner.put(input)
    },
    async head(path: string): Promise<DriverStoredMeta | null> {
      if (failReads) {
        throw new Error('upstream storage ECONNRESET on HEAD')
      }
      return inner.head(path)
    },
    async lazy(path: string): Promise<StreamFile | null> {
      if (failReads) {
        throw new Error('upstream storage ECONNRESET on GET')
      }
      return inner.lazy(path)
    },
    async del(path: string): Promise<boolean> {
      if (failWrites) {
        throw new Error('upstream storage 503 on DELETE')
      }
      return inner.del(path)
    },
  }

  return {
    driver,
    setFailWrites(v: boolean) {
      failWrites = v
    },
    setFailReads(v: boolean) {
      failReads = v
    },
  }
}

describe('#lib/storage Этап S4 — потоковый upload(request), has/list и cooldownMs фейловер', () => {
  it('принимает multipart/form-data потоком (upload) с шифрованием AES-256-GCM, пропуском пустых полей и ленивыми StreamFile в FormData', async () => {
    const spoolDir = await mkdtemp(join(tmpdir(), 'mk-s4-spool-'))
    try {
      const resolvedIps: string[] = []
      const storage = createStorage({
        spool: localSpool(spoolDir),
        tech: {
          resolveMeta(req) {
            const ip = req.headers.get('x-real-ip') ?? undefined
            if (ip) resolvedIps.push(ip)
            return { ...(ip ? { ip } : {}) }
          },
        },
        servers: {
          vault: {
            driver: memoryDriver({ publicBaseUrl: '/api/files' }),
            key: 'upload-secret-key-2026',
            limits: { storageBytes: 10 * MB, fileBytes: 5 * MB },
          },
        },
      })

      const avatarBytes = deterministicBytes(135_000, 23) // > 2 блоков AES-256-GCM по 64 КиБ
      const pdfBytes = deterministicBytes(4_096, 91)

      const outgoing = new FormData()
      outgoing.append('title', 'Годовой отчёт')
      outgoing.append('tags', 'alpha')
      outgoing.append('tags', 'beta')
      outgoing.append('empty_input', new File([], '', { type: 'application/octet-stream' }))
      outgoing.append('ignored_doc', new File([new Uint8Array([1, 2, 3])], 'skip.tmp', { type: 'text/plain' }))
      outgoing.append('avatar', new File([avatarBytes], 'photo.png', { type: 'image/png' }))
      outgoing.append('attachment', new File([pdfBytes], 'spec.pdf', { type: 'application/pdf' }))

      const req = new Request('http://upload.local/submit', {
        method: 'POST',
        headers: { 'x-real-ip': '203.0.113.42' },
        body: outgoing,
      })

      const res = await storage.upload(req, {
        resolvePath(ctx) {
          if (ctx.fieldName === 'ignored_doc') return null
          return `forms/${ctx.index}-${ctx.fieldName}-${ctx.name}`
        },
      })

      expect(resolvedIps).toEqual(['203.0.113.42'])
      expect(res.fields).toEqual({
        title: ['Годовой отчёт'],
        tags: ['alpha', 'beta'],
      })
      expect(res.files).toHaveLength(2)

      const [savedAvatar, savedPdf] = res.files
      expect(savedAvatar!.fieldName).toBe('avatar')
      expect(savedAvatar!.originalName).toBe('photo.png')
      expect(savedAvatar!.path).toBe('forms/1-avatar-photo.png')
      expect(savedAvatar!.size).toBe(avatarBytes.byteLength)
      expect(savedAvatar!.encrypted).toBe(true)
      expect(savedAvatar!.storedBytes).toBeGreaterThan(avatarBytes.byteLength)

      expect(savedPdf!.fieldName).toBe('attachment')
      expect(savedPdf!.size).toBe(pdfBytes.byteLength)

      const fdAvatar = res.formData.get('avatar')
      expect(fdAvatar).toBeInstanceOf(File)
      expect(fdAvatar).toBeInstanceOf(StreamFile)
      const roundtripFull = new Uint8Array(await (fdAvatar as StreamFile).arrayBuffer())
      expect(Buffer.compare(roundtripFull, avatarBytes)).toBe(0)

      // Проверка O(1) Range-среза через сохранённый StreamFile на стыке 64-КиБ блока
      const seamSlice = new Uint8Array(
        await (fdAvatar as StreamFile).slice(65_500, 65_600).arrayBuffer(),
      )
      expect(Buffer.compare(seamSlice, avatarBytes.subarray(65_500, 65_600))).toBe(0)
    } finally {
      await rm(spoolDir, { recursive: true, force: true })
    }
  })

  it('отклоняет неразрешённый MIME/расширение и превышение лимитов в upload() с атомарным откатом уже записанных файлов', async () => {
    const storage = createStorage({
      servers: {
        main: {
          driver: memoryDriver(),
          limits: { storageBytes: 5 * MB, fileBytes: 2 * MB },
        },
      },
    })

    // 1. Второй файл нарушает `accept` -> первый файл запроса должен быть атомарно удалён
    const fdBadAccept = new FormData()
    fdBadAccept.append(
      'first',
      new File([deterministicBytes(8_192, 5)], 'cover.png', { type: 'image/png' }),
    )
    fdBadAccept.append(
      'second',
      new File([new Uint8Array([0x4d, 0x5a, 1, 2])], 'payload.exe', {
        type: 'application/x-msdownload',
      }),
    )

    await expect(
      storage.upload(
        new Request('http://upload.local/post', { method: 'POST', body: fdBadAccept }),
        {
          accept: ['image/*', '.pdf'],
          resolvePath: (f) => `batch/${f.name}`,
        },
      ),
    ).rejects.toMatchObject({
      name: 'StorageUploadError',
      code: 'ACCEPT_MISMATCH',
      status: 415,
      fieldName: 'second',
      fileName: 'payload.exe',
    })

    expect(await storage.has('batch/cover.png')).toBe(false)
    const repAfterRollback = await storage.report()
    expect(repAfterRollback.servers[0]!.usedBytes).toBe(0)
    expect(repAfterRollback.servers[0]!.reservedBytes).toBe(0)

    // 2. Превышение `maxFiles`
    const fdTooMany = new FormData()
    fdTooMany.append('a', new File([new Uint8Array([1, 2])], '1.pdf', { type: 'application/pdf' }))
    fdTooMany.append('b', new File([new Uint8Array([3, 4])], '2.pdf', { type: 'application/pdf' }))

    await expect(
      storage.upload(
        new Request('http://upload.local/post', { method: 'POST', body: fdTooMany }),
        {
          maxFiles: 1,
          resolvePath: (f) => `many/${f.name}`,
        },
      ),
    ).rejects.toMatchObject({
      name: 'StorageUploadError',
      code: 'MAX_FILES_EXCEEDED',
      status: 422,
    })
    expect(await storage.has('many/1.pdf')).toBe(false)

    // 3. Превышение `maxFileSize`
    const fdOversize = new FormData()
    fdOversize.append(
      'big',
      new File([deterministicBytes(4_096, 7)], 'huge.bin', {
        type: 'application/octet-stream',
      }),
    )
    await expect(
      storage.upload(
        new Request('http://upload.local/post', { method: 'POST', body: fdOversize }),
        {
          maxFileSize: 1_024,
          resolvePath: (f) => `oversize/${f.name}`,
        },
      ),
    ).rejects.toBeInstanceOf(StorageUploadError)
    expect(await storage.has('oversize/huge.bin')).toBe(false)
  })

  it('корректно выполняет has() и курсорную выборку list() с фильтром по серверу без утечки @replica:*', async () => {
    const storage = createStorage({
      servers: {
        s1: {
          driver: memoryDriver(),
          limits: { storageBytes: 4 * MB, fileBytes: 2 * MB },
        },
        s2: {
          driver: memoryDriver(),
          limits: { storageBytes: 4 * MB, fileBytes: 2 * MB },
        },
      },
    })

    await storage.put({ path: 'docs/a.txt', body: new Uint8Array([1]), server: 's1' })
    await storage.put({ path: 'docs/b.txt', body: new Uint8Array([2]), server: 's2' })
    await storage.put({ path: 'docs/c.txt', body: new Uint8Array([3]), server: 's1' })
    await storage.put({ path: 'images/logo.png', body: new Uint8Array([4]), server: 's2' })
    // Реплика на s2 под тем же путём не должна дублироваться в list()
    await storage.copy({ path: 'docs/a.txt', from: 's1', to: 's2' })

    expect(await storage.has('docs/a.txt')).toBe(true)
    expect(await storage.has('docs/a.txt', { server: 's2' })).toBe(true)
    expect(await storage.has('docs/missing.txt')).toBe(false)

    const p1 = await storage.list({ prefix: 'docs/', limit: 2 })
    expect(p1.entries.map((e) => e.path)).toEqual(['docs/a.txt', 'docs/b.txt'])
    expect(p1.cursor).toBe('docs/b.txt')

    const p2 = await storage.list({ prefix: 'docs/', limit: 2, cursor: p1.cursor })
    expect(p2.entries.map((e) => e.path)).toEqual(['docs/c.txt'])
    expect(p2.cursor).toBeUndefined()

    const onlyS2 = await storage.list({ server: 's2' })
    expect(onlyS2.entries.map((e) => e.path)).toEqual(['docs/b.txt', 'images/logo.png'])
  })

  it('переводит упавший сервер в карантин cooldownMs, автоматически переключает запись и чтение реплик и восстанавливает по probe()', async () => {
    const flakyPrimary = createFlakyDriver(memoryDriver())
    const backupDriver = memoryDriver()
    const telemetry = createStorageState()
    const events: StorageStateEvent[] = []

    const storage = createStorage({
      defaultServer: 'primary',
      writePool: ['primary', 'backup'],
      writeStrategy: 'priority',
      cooldownMs: 5_000,
      state(ev) {
        events.push(ev)
        telemetry.onEvent(ev)
      },
      servers: {
        primary: {
          driver: flakyPrimary.driver,
          key: 'shared-cluster-key',
          limits: { storageBytes: 4 * MB, fileBytes: 2 * MB },
        },
        backup: {
          driver: backupDriver,
          key: 'shared-cluster-key',
          limits: { storageBytes: 4 * MB, fileBytes: 2 * MB },
        },
      },
    })

    const original = deterministicBytes(90_000, 41)
    const saved1 = await storage.put({
      path: 'assets/manual.bin',
      body: original,
      contentType: 'application/octet-stream',
    })
    expect(saved1.server).toBe('primary')

    // Реплицируем файл на backup
    const cloned = await storage.clone({ from: 'primary', to: 'backup' })
    expect(cloned.clonedPaths).toEqual(['assets/manual.bin'])

    // Имитируем падение primary как на запись, так и на чтение
    flakyPrimary.setFailWrites(true)
    flakyPrimary.setFailReads(true)

    // 1. Автозапись нового файла прозрачно уходит на backup, а primary попадает в cooldown
    const nextPayload = deterministicBytes(12_000, 77)
    const saved2 = await storage.put({
      path: 'assets/failover.bin',
      body: nextPayload,
      contentType: 'application/octet-stream',
    })
    expect(saved2.server).toBe('backup')

    const repDuringOutage = await storage.report()
    const primaryRep = repDuringOutage.servers.find((s) => s.server === 'primary')!
    const backupRep = repDuringOutage.servers.find((s) => s.server === 'backup')!
    expect(primaryRep.healthy).toBe(false)
    expect(primaryRep.cooldownUntil).toBeGreaterThan(Date.now() - 1000)
    expect(backupRep.healthy).toBe(true)
    expect(events.some((e) => e.type === 'server:cooldown' && e.server === 'primary')).toBe(
      true,
    )

    // 2. Чтение и HTTP Range-раздача `assets/manual.bin` автоматически берут живую реплику с backup!
    const headFallback = await storage.head('assets/manual.bin')
    expect(headFallback?.size).toBe(original.byteLength)

    const rangeRes = await storage.serve(
      'assets/manual.bin',
      new Request('http://cdn.local/assets/manual.bin', {
        headers: { range: 'bytes=65500-65600' },
      }),
    )
    expect(rangeRes.status).toBe(206)
    const rangeBytes = new Uint8Array(await rangeRes.arrayBuffer())
    expect(Buffer.compare(rangeBytes, original.subarray(65_500, 65_601))).toBe(0)

    // 3. Восстанавливаем primary и подтверждаем выход из карантина через probe('primary')
    flakyPrimary.setFailWrites(false)
    flakyPrimary.setFailReads(false)

    const probeRes = await storage.probe('primary')
    expect(probeRes.ok).toBe(true)
    expect(events.some((e) => e.type === 'server:recovered' && e.server === 'primary')).toBe(
      true,
    )
    expect(telemetry.getSnapshot().servers.primary?.cooldownUntil).toBeUndefined()

    const repRecovered = await storage.report()
    expect(repRecovered.servers.find((s) => s.server === 'primary')!.healthy).toBe(true)
  })
})
