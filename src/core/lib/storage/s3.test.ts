import { createServer, type Server as HttpServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createStorage,
  StorageQuotaError,
  StorageReadOnlyError,
} from './index.js'
import { jsonLedger } from './local.js'
import {
  formatS3Url,
  maskS3Url,
  parseS3Url,
  S3_MIN_PART_BYTES,
  s3Driver,
} from './s3.js'

/** Минимальный локальный HTTP S3-совместимый стенд (поддерживает SigV4 заголовки, PUT, HEAD, GET Range, DELETE и Multipart Upload). */
function startMockS3Server(): Promise<{
  server: HttpServer
  endpoint: string
  abortedUploads: string[]
  multipartCompleted: string[]
}> {
  const objects = new Map<
    string,
    { bytes: Buffer; contentType: string; mtime: string; etag: string }
  >()
  const uploads = new Map<string, { key: string; contentType: string; mtime: string; parts: Map<number, Buffer> }>()
  const abortedUploads: string[] = []
  const multipartCompleted: string[] = []
  let seq = 1

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const auth = req.headers.authorization ?? ''
    if (!auth.startsWith('AWS4-HMAC-SHA256 ')) {
      res.statusCode = 403
      res.end('<Error><Code>AccessDenied</Code></Error>')
      return
    }

    const segments = url.pathname.replace(/^\/+/, '').split('/')
    const bucket = segments[0] ?? ''
    const key = segments.slice(1).map(decodeURIComponent).join('/')
    const storeKey = `${bucket}/${key}`

    // CreateMultipartUpload: POST ?uploads
    if (req.method === 'POST' && url.searchParams.has('uploads')) {
      const uploadId = `mpu-${seq++}`
      uploads.set(uploadId, {
        key: storeKey,
        contentType: String(req.headers['content-type'] ?? 'application/octet-stream'),
        mtime: String(req.headers['x-amz-meta-mtime'] ?? Date.now()),
        parts: new Map(),
      })
      res.statusCode = 200
      res.setHeader('content-type', 'application/xml')
      res.end(
        `<?xml version="1.0" encoding="UTF-8"?><InitiateMultipartUploadResult><Bucket>${bucket}</Bucket><Key>${key}</Key><UploadId>${uploadId}</UploadId></InitiateMultipartUploadResult>`,
      )
      return
    }

    // UploadPart: PUT ?partNumber=N&uploadId=ID
    if (req.method === 'PUT' && url.searchParams.has('uploadId') && url.searchParams.has('partNumber')) {
      const uploadId = url.searchParams.get('uploadId')!
      const partNumber = Number(url.searchParams.get('partNumber'))
      const up = uploads.get(uploadId)
      if (!up) {
        res.statusCode = 404
        res.end()
        return
      }
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        const buf = Buffer.concat(chunks)
        up.parts.set(partNumber, buf)
        res.statusCode = 200
        res.setHeader('etag', `"part-${uploadId}-${partNumber}-${buf.byteLength}"`)
        res.end()
      })
      return
    }

    // CompleteMultipartUpload: POST ?uploadId=ID
    if (req.method === 'POST' && url.searchParams.has('uploadId')) {
      const uploadId = url.searchParams.get('uploadId')!
      const up = uploads.get(uploadId)
      if (!up) {
        res.statusCode = 404
        res.end()
        return
      }
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        const ordered = [...up.parts.entries()]
          .sort((a, b) => a[0] - b[0])
          .map((e) => e[1])
        const full = Buffer.concat(ordered)
        objects.set(up.key, {
          bytes: full,
          contentType: up.contentType,
          mtime: up.mtime,
          etag: `"mpu-etag-${full.byteLength}"`,
        })
        uploads.delete(uploadId)
        multipartCompleted.push(uploadId)
        res.statusCode = 200
        res.setHeader('content-type', 'application/xml')
        res.end(`<CompleteMultipartUploadResult><ETag>"mpu-etag-${full.byteLength}"</ETag></CompleteMultipartUploadResult>`)
      })
      return
    }

    // AbortMultipartUpload: DELETE ?uploadId=ID
    if (req.method === 'DELETE' && url.searchParams.has('uploadId')) {
      const uploadId = url.searchParams.get('uploadId')!
      uploads.delete(uploadId)
      abortedUploads.push(uploadId)
      res.statusCode = 204
      res.end()
      return
    }

    // Single PUT
    if (req.method === 'PUT') {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        const buf = Buffer.concat(chunks)
        const declared = req.headers['content-length']
        if (declared !== undefined && Number(declared) !== buf.byteLength) {
          res.statusCode = 400
          res.end('IncompleteBody')
          return
        }
        objects.set(storeKey, {
          bytes: buf,
          contentType: String(req.headers['content-type'] ?? 'application/octet-stream'),
          mtime: String(req.headers['x-amz-meta-mtime'] ?? Date.now()),
          etag: `"etag-${buf.byteLength}"`,
        })
        res.statusCode = 200
        res.setHeader('etag', `"etag-${buf.byteLength}"`)
        res.end()
      })
      return
    }

    // HEAD
    if (req.method === 'HEAD') {
      const obj = objects.get(storeKey)
      if (!obj) {
        res.statusCode = 404
        res.end()
        return
      }
      res.statusCode = 200
      res.setHeader('content-length', String(obj.bytes.byteLength))
      res.setHeader('content-type', obj.contentType)
      res.setHeader('x-amz-meta-mtime', obj.mtime)
      res.setHeader('etag', obj.etag)
      res.end()
      return
    }

    // GET (with Range)
    if (req.method === 'GET') {
      const obj = objects.get(storeKey)
      if (!obj) {
        res.statusCode = 404
        res.end('NoSuchKey')
        return
      }
      const range = req.headers.range
      if (range && range.startsWith('bytes=')) {
        const [sRaw, eRaw] = range.slice(6).split('-')
        const start = Number(sRaw)
        const end = eRaw ? Math.min(Number(eRaw), obj.bytes.byteLength - 1) : obj.bytes.byteLength - 1
        const slice = obj.bytes.subarray(start, end + 1)
        res.statusCode = 206
        res.setHeader('content-type', obj.contentType)
        res.setHeader('content-length', String(slice.byteLength))
        res.setHeader('content-range', `bytes ${start}-${end}/${obj.bytes.byteLength}`)
        res.end(slice)
        return
      }
      res.statusCode = 200
      res.setHeader('content-type', obj.contentType)
      res.setHeader('content-length', String(obj.bytes.byteLength))
      res.end(obj.bytes)
      return
    }

    // DELETE
    if (req.method === 'DELETE') {
      const had = objects.delete(storeKey)
      res.statusCode = had ? 204 : 404
      res.end()
      return
    }

    res.statusCode = 405
    res.end()
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({
        server,
        endpoint: `http://127.0.0.1:${port}`,
        abortedUploads,
        multipartCompleted,
      })
    })
  })
}

describe('s3Driver + multi-server ledger + streaming copy/move', () => {
  let hostA: Awaited<ReturnType<typeof startMockS3Server>>
  let hostB: Awaited<ReturnType<typeof startMockS3Server>>
  let tmpDir = ''

  beforeEach(async () => {
    hostA = await startMockS3Server()
    hostB = await startMockS3Server()
    tmpDir = await mkdtemp(join(tmpdir(), 'modals-s3-ledger-'))
  })

  afterEach(async () => {
    await new Promise<void>((r) => hostA.server.close(() => r()))
    await new Promise<void>((r) => hostB.server.close(() => r()))
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true })
  })

  it('льёт одиночный поток, выполняет S3 Multipart Upload (> 5 МиБ) с AbortMultipartUpload при сбое и перекачивает поток между 2 хостами S3', async () => {
    const ledgerFile = join(tmpDir, 'ledger.json')
    const storage = createStorage({
      ledger: jsonLedger({ filePath: ledgerFile }),
      defaultServer: 's3a',
      servers: {
        s3a: {
          driver: s3Driver({
            endpoint: hostA.endpoint,
            bucket: 'bucket-a',
            region: 'us-east-005',
            accessKeyId: 'test-key-a',
            secretAccessKey: 'test-secret-a',
            basePath: 'tenant-1',
            multipartThresholdBytes: S3_MIN_PART_BYTES,
          }),
          limits: {
            storageBytes: 25 * 1024 * 1024,
            fileBytes: 20 * 1024 * 1024,
          },
        },
        s3b: {
          driver: s3Driver({
            endpoint: hostB.endpoint,
            bucket: 'bucket-b',
            region: 'auto',
            accessKeyId: 'test-key-b',
            secretAccessKey: 'test-secret-b',
            basePath: 'tenant-1',
            multipartThresholdBytes: S3_MIN_PART_BYTES,
          }),
          limits: {
            storageBytes: 25 * 1024 * 1024,
            fileBytes: 20 * 1024 * 1024,
          },
        },
        ro: {
          driver: s3Driver({
            endpoint: hostB.endpoint,
            bucket: 'bucket-ro',
            region: 'auto',
            accessKeyId: 'ro-k',
            secretAccessKey: 'ro-s',
          }),
          readOnly: true,
          limits: { storageBytes: 10 * 1024 * 1024, fileBytes: 10 * 1024 * 1024 },
        },
      },
    })

    // 1) ReadOnly сервер блокирует запись
    await expect(
      storage.put({
        path: 'blocked.bin',
        body: new Uint8Array([1, 2, 3]),
        server: 'ro',
      }),
    ).rejects.toBeInstanceOf(StorageReadOnlyError)

    // 2) Multipart Upload 11.2 МиБ (3 части: 5 МиБ + 5 МиБ + 1.2 МиБ) потоком чанков по 256 КБ
    const mpuSize = 11 * 1024 * 1024 + 200 * 1024
    const expectedPayload = Buffer.alloc(mpuSize)
    for (let i = 0; i < mpuSize; i++) expectedPayload[i] = (i * 23 + 7) & 0xff

    let offset = 0
    const chunkedInput = new ReadableStream<Uint8Array>({
      pull(c) {
        if (offset >= mpuSize) {
          c.close()
          return
        }
        const len = Math.min(256 * 1024, mpuSize - offset)
        c.enqueue(expectedPayload.subarray(offset, offset + len))
        offset += len
      },
    })

    const savedA = await storage.put({
      path: 'videos/stream-mpu.mp4',
      body: chunkedInput,
      size: mpuSize,
      contentType: 'video/mp4',
      server: 's3a',
    })
    expect(savedA.server).toBe('s3a')
    expect(savedA.size).toBe(mpuSize)
    expect(hostA.multipartCompleted).toHaveLength(1)

    // Range 206 чтение поперёк границы 5-МиБ парта (байты 5242876..5242883)
    const boundaryStart = S3_MIN_PART_BYTES - 4
    const rangeRes = await storage.serve(
      'videos/stream-mpu.mp4',
      new Request('http://localhost/api/files/videos/stream-mpu.mp4', {
        headers: { range: `bytes=${boundaryStart}-${boundaryStart + 7}` },
      }),
    )
    expect(rangeRes.status).toBe(206)
    const rangeBuf = Buffer.from(await rangeRes.arrayBuffer())
    expect(
      Buffer.compare(rangeBuf, expectedPayload.subarray(boundaryStart, boundaryStart + 8)),
    ).toBe(0)

    // 3) Сбой посреди Multipart Upload вызывает AbortMultipartUpload и освобождает бронь в ledger
    const brokenStream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(512 * 1024).fill(9))
        c.error(new Error('network glitch'))
      },
    })
    await expect(
      storage.put({
        path: 'videos/broken-mpu.mp4',
        body: brokenStream,
        size: 8 * 1024 * 1024,
        server: 's3a',
      }),
    ).rejects.toThrow('network glitch')
    expect(hostA.abortedUploads).toHaveLength(1)

    // Проверяем, что бронь от упавшей загрузки снята в jsonLedger
    const reportAfterFail = await storage.report()
    const s3aReport = reportAfterFail.servers.find((s) => s.server === 's3a')!
    expect(s3aReport.reservedBytes).toBe(0)
    expect(s3aReport.usedBytes).toBe(mpuSize)

    // 4) Превышение квоты storageBytes (осталось ~13.8 МиБ из 25 МиБ, просим 16 МиБ)
    await expect(
      storage.put({
        path: 'videos/too-big-for-quota.mp4',
        body: new Uint8Array(10),
        size: 16 * 1024 * 1024,
        server: 's3a',
      }),
    ).rejects.toBeInstanceOf(StorageQuotaError)

    // 5) Потоковый перенос `move` напрямую между двумя S3-хостами (`s3a` -> `s3b`)
    const moved = await storage.move({
      path: 'videos/stream-mpu.mp4',
      from: 's3a',
      to: 's3b',
    })
    expect(moved.server).toBe('s3b')
    expect(moved.size).toBe(mpuSize)
    expect(hostB.multipartCompleted).toHaveLength(1)

    // На старом хосте `s3a` объект удалён, а `serve` без явного `?server=` читает его с `s3b` по `jsonLedger`
    expect(await storage.head('videos/stream-mpu.mp4', { server: 's3a' })).toBeNull()
    const fullFromB = await storage.lazy('videos/stream-mpu.mp4')
    expect(fullFromB).not.toBeNull()
    expect(Buffer.compare(Buffer.from(await fullFromB!.bytes()), expectedPayload)).toBe(0)

    const finalReport = await storage.report()
    expect(finalReport.servers.find((s) => s.server === 's3a')?.usedBytes).toBe(0)
    expect(finalReport.servers.find((s) => s.server === 's3b')?.usedBytes).toBe(mpuSize)
  })

  it('разбирает и маскирует DSN s3://, подключает серверы по { url, limits }, переключает auto и выполняет probe()', async () => {
    const dsn = formatS3Url({
      endpoint: 'https://s3.us-east-005.backblazeb2.com',
      bucket: 'my-bucket',
      accessKeyId: 'key_005',
      secretAccessKey: 'sec/ret+key=42@!',
      basePath: 'demo/prefix',
    })
    expect(dsn).toBe(
      's3://key_005:sec%2Fret%2Bkey%3D42%40!@s3.us-east-005.backblazeb2.com/my-bucket/demo/prefix',
    )
    expect(maskS3Url(dsn)).toBe(
      's3://***@s3.us-east-005.backblazeb2.com/my-bucket/demo/prefix',
    )
    const parsed = parseS3Url(dsn)
    expect(parsed).toMatchObject({
      endpoint: 'https://s3.us-east-005.backblazeb2.com',
      bucket: 'my-bucket',
      region: 'us-east-005',
      accessKeyId: 'key_005',
      secretAccessKey: 'sec/ret+key=42@!',
      basePath: 'demo/prefix',
    })

    const r2Parsed = parseS3Url('s3://id:secret@acc123.r2.cloudflarestorage.com/assets')
    expect(r2Parsed.region).toBe('auto')
    expect(r2Parsed.bucket).toBe('assets')

    const mockUrlA = formatS3Url({
      endpoint: hostA.endpoint,
      bucket: 'dsn-a',
      accessKeyId: 'ak-a',
      secretAccessKey: 'sk/a+1',
      basePath: 'slot-a',
      region: 'auto',
    })
    const mockUrlRo = formatS3Url({
      endpoint: hostB.endpoint,
      bucket: 'dsn-ro',
      accessKeyId: 'ak-b',
      secretAccessKey: 'sk-b',
      region: 'auto',
    })

    const storage = createStorage({
      defaultServer: 'ram',
      servers: {
        ram: {
          url: 'memory://ram',
          limits: { storageBytes: 2048, fileBytes: 1024 },
        },
      },
    })

    // Динамически добавляем S3-серверы со своим конфигом лимитов по единой DSN-ссылке
    storage.setServer('cloud_1', {
      url: mockUrlA,
      limits: { storageBytes: 10 * 1024 * 1024, fileBytes: 5 * 1024 * 1024 },
    })
    storage.setServer('cloud_ro', {
      url: mockUrlRo,
      readOnly: true,
      limits: { storageBytes: 10 * 1024 * 1024, fileBytes: 5 * 1024 * 1024 },
    })
    expect(storage.serverNames).toEqual(['ram', 'cloud_1', 'cloud_ro'])

    // Живая проверка probe() на пишущем и readOnly сервере
    const probeOk = await storage.probe('cloud_1')
    expect(probeOk.ok).toBe(true)
    expect(probeOk.steps.map((s) => s.step)).toEqual(['put', 'head', 'range', 'delete'])

    const probeRo = await storage.probe('cloud_ro')
    expect(probeRo.ok).toBe(true)
    expect(probeRo.readOnly).toBe(true)
    expect(probeRo.steps.map((s) => s.step)).toEqual(['readonly-guard', 'head'])

    // server: 'auto' пропускает ram (fileBytes=1024) для файла 4096 Б и автоматически выбирает cloud_1!
    const autoSaved = await storage.put({
      path: 'auto-routed.bin',
      body: new Uint8Array(4096).fill(0x5a),
      server: 'auto',
    })
    expect(autoSaved.server).toBe('cloud_1')

    expect(await storage.removeServer('cloud_ro')).toBe(true)
    expect(storage.serverNames).toEqual(['ram', 'cloud_1'])
  })
})

const hasLiveTwoHostS3 = Boolean(
  process.env.TEST_S3_PRIMARY_URL && process.env.TEST_S3_SECONDARY_URL,
)

describe('живая сквозная проверка 2 S3-хостов по DSN s3://', () => {
  it.skipIf(!hasLiveTwoHostS3)(
    'проверяет probe(), льёт > 5 МиБ Multipart Upload в хост 1, читает Range 206 и перекачивает поток в хост 2 с очисткой',
    async () => {
      const storage = createStorage({
        defaultServer: 's3_primary',
        servers: {
          s3_primary: {
            url: process.env.TEST_S3_PRIMARY_URL!,
            limits: {
              storageBytes: 32 * 1024 * 1024,
              fileBytes: 16 * 1024 * 1024,
            },
          },
          s3_secondary: {
            url: process.env.TEST_S3_SECONDARY_URL!,
            limits: {
              storageBytes: 32 * 1024 * 1024,
              fileBytes: 16 * 1024 * 1024,
            },
          },
        },
      })

      expect((await storage.probe('s3_primary')).ok).toBe(true)
      expect((await storage.probe('s3_secondary')).ok).toBe(true)

      const relPath = `_live_dsn_test/${Date.now()}-${Math.random().toString(36).slice(2, 8)}/sample.bin`
      // 5.5 МиБ — гарантированно включает Multipart Upload (2 части: 5 МиБ + 0.5 МиБ) на обоих облаках
      const totalBytes = 5 * 1024 * 1024 + 512 * 1024
      const payload = Buffer.alloc(totalBytes)
      for (let i = 0; i < totalBytes; i++) payload[i] = (i * 37 + 19) & 0xff

      try {
        let sent = 0
        const body = new ReadableStream<Uint8Array>({
          pull(c) {
            if (sent >= totalBytes) {
              c.close()
              return
            }
            const len = Math.min(256 * 1024, totalBytes - sent)
            c.enqueue(payload.subarray(sent, sent + len))
            sent += len
          },
        })

        const onPrimary = await storage.put({
          path: relPath,
          body,
          size: totalBytes,
          contentType: 'application/octet-stream',
          server: 's3_primary',
        })
        expect(onPrimary.server).toBe('s3_primary')
        expect(onPrimary.size).toBe(totalBytes)

        const seam = S3_MIN_PART_BYTES - 8
        const primaryRange = await storage.serve(
          relPath,
          new Request('http://localhost/api/files/sample.bin', {
            headers: { range: `bytes=${seam}-${seam + 15}` },
          }),
          { server: 's3_primary' },
        )
        expect(primaryRange.status).toBe(206)
        expect(
          Buffer.compare(
            Buffer.from(await primaryRange.arrayBuffer()),
            payload.subarray(seam, seam + 16),
          ),
        ).toBe(0)

        const onSecondary = await storage.move({
          path: relPath,
          from: 's3_primary',
          to: 's3_secondary',
        })
        expect(onSecondary.server).toBe('s3_secondary')
        expect(onSecondary.size).toBe(totalBytes)

        expect(await storage.head(relPath, { server: 's3_primary' })).toBeNull()
        const secondaryRange = await storage.serve(
          relPath,
          new Request('http://localhost/api/files/sample.bin', {
            headers: { range: `bytes=${seam}-${seam + 15}` },
          }),
          { server: 's3_secondary' },
        )
        expect(secondaryRange.status).toBe(206)
        expect(
          Buffer.compare(
            Buffer.from(await secondaryRange.arrayBuffer()),
            payload.subarray(seam, seam + 16),
          ),
        ).toBe(0)

        const report = await storage.report()
        expect(report.servers.find((s) => s.server === 's3_primary')?.usedBytes).toBe(0)
        expect(report.servers.find((s) => s.server === 's3_secondary')?.usedBytes).toBe(totalBytes)
      } finally {
        await storage.del(relPath, { server: 's3_primary' }).catch(() => false)
        await storage.del(relPath, { server: 's3_secondary' }).catch(() => false)
      }
    },
    120_000,
  )
})
