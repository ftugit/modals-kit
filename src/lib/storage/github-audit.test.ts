import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createDecryptedStreamFile,
  encryptStream,
  StorageCryptoError,
} from './crypto.js'
import {
  createStorage,
  memoryDriver,
  StorageUploadError,
} from './index.js'
import { jsonLedger, localDriver } from './local.js'
import { S3_MIN_PART_BYTES, s3Driver } from './s3.js'
import { StreamFile } from './stream-file.js'
import { webdavDriver } from './webdav.js'

function deterministicBytes(size: number, seed = 17): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(size))
  for (let i = 0; i < size; i++) {
    out[i] = (i * 29 + seed) & 0xff
  }
  return out
}

describe('GitHub Code Search audit regressions (#lib/storage)', () => {
  let tmpDir = ''

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'modals-gh-audit-'))
  })

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true })
  })

  it('s3Driver: поток неизвестной длины <= 5 MiB уходит одиночным PUT без Multipart, а > 5 MiB — через Multipart с проверкой <Error> в 200 OK', async () => {
    const calls: Array<{ method: string; url: string }> = []
    const store = new Map<string, { bytes: Uint8Array<ArrayBuffer>; contentType: string }>()
    const uploads = new Map<string, Map<number, Uint8Array<ArrayBuffer>>>()
    const aborted: string[] = []
    let failCompleteWith200XmlError = false
    let ignoreRangeHeaderOnGet = false

    const mockFetch: typeof fetch = async (input, init) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      calls.push({ method, url: urlStr })
      const u = new URL(urlStr)

      if (method === 'POST' && u.searchParams.has('uploads')) {
        const id = `up-${uploads.size + 1}`
        uploads.set(id, new Map())
        return new Response(
          `<?xml version="1.0"?><s3:InitiateMultipartUploadResult><s3:UploadId>${id}</s3:UploadId></s3:InitiateMultipartUploadResult>`,
          { status: 200, headers: { 'content-type': 'application/xml' } },
        )
      }

      if (method === 'PUT' && u.searchParams.has('uploadId') && u.searchParams.has('partNumber')) {
        const id = u.searchParams.get('uploadId')!
        const pn = Number(u.searchParams.get('partNumber'))
        const buf = new Uint8Array(await new Response(init?.body as BodyInit).arrayBuffer())
        uploads.get(id)!.set(pn, buf)
        return new Response(null, {
          status: 200,
          headers: { etag: `"etag-${pn}-'special'"` },
        })
      }

      if (method === 'POST' && u.searchParams.has('uploadId')) {
        const id = u.searchParams.get('uploadId')!
        if (failCompleteWith200XmlError) {
          return new Response(
            `<?xml version="1.0"?><s3:Error><s3:Code>InternalError</s3:Code><s3:Message>We encountered an internal error &amp; failed.</s3:Message></s3:Error>`,
            { status: 200, headers: { 'content-type': 'application/xml' } },
          )
        }
        const parts = [...uploads.get(id)!.entries()]
          .sort((a, b) => a[0] - b[0])
          .map((e) => e[1])
        const total = parts.reduce((acc, p) => acc + p.byteLength, 0)
        const merged = new Uint8Array(new ArrayBuffer(total))
        let off = 0
        for (const p of parts) {
          merged.set(p, off)
          off += p.byteLength
        }
        store.set(u.pathname, { bytes: merged, contentType: 'application/octet-stream' })
        uploads.delete(id)
        return new Response(`<CompleteMultipartUploadResult><ETag>"done"</ETag></CompleteMultipartUploadResult>`, {
          status: 200,
        })
      }

      if (method === 'DELETE' && u.searchParams.has('uploadId')) {
        aborted.push(u.searchParams.get('uploadId')!)
        uploads.delete(u.searchParams.get('uploadId')!)
        return new Response(null, { status: 204 })
      }

      if (method === 'PUT') {
        const buf = new Uint8Array(await new Response(init?.body as BodyInit).arrayBuffer())
        const headers = new Headers(init?.headers)
        store.set(u.pathname, {
          bytes: buf,
          contentType: headers.get('content-type') ?? 'application/octet-stream',
        })
        return new Response(null, { status: 200, headers: { etag: '"single"' } })
      }

      if (method === 'HEAD') {
        const hit = store.get(u.pathname)
        if (!hit) return new Response(null, { status: 404 })
        return new Response(null, {
          status: 200,
          headers: {
            'content-length': String(hit.bytes.byteLength),
            'content-type': hit.contentType,
          },
        })
      }

      if (method === 'GET') {
        const hit = store.get(u.pathname)
        if (!hit) return new Response('NoSuchKey', { status: 404 })
        const headers = new Headers(init?.headers)
        const range = headers.get('range')
        if (range && !ignoreRangeHeaderOnGet) {
          const [s, e] = range.replace('bytes=', '').split('-').map(Number)
          const slice = hit.bytes.subarray(s!, e! + 1)
          return new Response(slice, {
            status: 206,
            headers: { 'content-length': String(slice.byteLength) },
          })
        }
        return new Response(hit.bytes, {
          status: 200,
          headers: { 'content-length': String(hit.bytes.byteLength) },
        })
      }

      return new Response(null, { status: 405 })
    }

    const driver = s3Driver({
      endpoint: 'https://s3.example.test',
      bucket: 'bkt',
      region: 'auto',
      accessKeyId: 'ak',
      secretAccessKey: 'sk',
      fetchImpl: mockFetch,
    })

    // 1. Поток неизвестной длины (12 КБ, имени со скобками и `!`) -> ровно 1 одиночный PUT и RFC 3986 URI
    const smallPayload = deterministicBytes(12 * 1024, 3)
    const unknownSmallStream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(smallPayload.subarray(0, 4096))
        c.enqueue(new Uint8Array(0))
        c.enqueue(smallPayload.subarray(4096))
        c.close()
      },
    })
    const metaSmall = await driver.put({
      path: 'docs/Screenshot (1)!.png',
      stream: unknownSmallStream,
      contentType: 'image/png',
      lastModified: 1_700_000_000_000,
    })
    expect(metaSmall.size).toBe(smallPayload.byteLength)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.method).toBe('PUT')
    expect(calls[0]!.url).toContain('Screenshot%20%281%29%21.png')

    // 2. Fallback на 200 OK при Range-чтении (прокси проигнорировал Range и вернул всё тело)
    ignoreRangeHeaderOnGet = true
    const lazySmall = await driver.lazy('docs/Screenshot (1)!.png')
    expect(lazySmall).not.toBeNull()
    const sliced = new Uint8Array(await lazySmall!.slice(100, 350).arrayBuffer())
    expect(sliced).toEqual(smallPayload.subarray(100, 350))
    ignoreRangeHeaderOnGet = false

    // 3. Поток неизвестной длины > 5 MiB + ошибка `<s3:Error>` внутри 200 OK на CompleteMultipartUpload -> ошибка + AbortMultipartUpload
    calls.length = 0
    failCompleteWith200XmlError = true
    const largePayload = deterministicBytes(S3_MIN_PART_BYTES + 128 * 1024, 9)
    const makeLargeUnknownStream = () => {
      let off = 0
      return new ReadableStream<Uint8Array>({
        pull(c) {
          if (off >= largePayload.byteLength) {
            c.close()
            return
          }
          const end = Math.min(off + 512 * 1024, largePayload.byteLength)
          c.enqueue(largePayload.subarray(off, end))
          off = end
        },
      })
    }

    await expect(
      driver.put({
        path: 'big/fail-on-200-error.bin',
        stream: makeLargeUnknownStream(),
        contentType: 'application/octet-stream',
        lastModified: Date.now(),
      }),
    ).rejects.toThrow(/InternalError/)
    expect(aborted).toHaveLength(1)

    // 4. После снятия флага ошибки тот же поток > 5 MiB успешно собирается из равных частей R2/S3
    failCompleteWith200XmlError = false
    const okLarge = await driver.put({
      path: 'big/ok.bin',
      stream: makeLargeUnknownStream(),
      contentType: 'application/octet-stream',
      lastModified: Date.now(),
    })
    expect(okLarge.size).toBe(largePayload.byteLength)
  })

  it('storage.upload: не режет файлы > 2 MiB скрытым дефолтом парсера и не считает пустые <input type="file"> в maxFiles', async () => {
    const storage = createStorage({
      servers: {
        main: {
          driver: memoryDriver(),
          limits: {
            storageBytes: 20 * 1024 * 1024,
            fileBytes: 8 * 1024 * 1024,
          },
        },
      },
    })

    // 2.4 MiB > дефолтных 2 MiB внутри `@remix-run/form-data-parser`, плюс 2 пустых `<input type="file">` при `maxFiles: 1`
    const payload = deterministicBytes(Math.floor(2.4 * 1024 * 1024), 41)
    const fd = new FormData()
    fd.append('empty_avatar', new File([], '', { type: 'application/octet-stream' }))
    fd.append('empty_banner', new File([], '', { type: 'application/octet-stream' }))
    fd.append('document', new File([payload], 'report (final)!.pdf', { type: 'application/pdf' }))

    const req = new Request('http://localhost/upload', { method: 'POST', body: fd })
    const res = await storage.upload(req, { maxFiles: 1 })
    expect(res.files).toHaveLength(1)
    expect(res.files[0]!.size).toBe(payload.byteLength)

    // А 2 реальных непустых файла при `maxFiles: 1` отклоняются со статусом 422
    const fdTwo = new FormData()
    fdTwo.append('a', new File([new Uint8Array([1, 2, 3])], 'a.bin'))
    fdTwo.append('b', new File([new Uint8Array([4, 5, 6])], 'b.bin'))
    await expect(
      storage.upload(new Request('http://localhost/upload', { method: 'POST', body: fdTwo }), {
        maxFiles: 1,
      }),
    ).rejects.toMatchObject({
      code: 'MAX_FILES_EXCEEDED',
      status: 422,
    } satisfies Partial<StorageUploadError>)
  })

  it('webdavDriver: игнорирует 404 propstat, объединяет несколько 200 propstat и дедуплицирует параллельные MKCOL', async () => {
    const mkcolPaths: string[] = []
    const files = new Map<string, Uint8Array>()

    const mockDavFetch: typeof fetch = async (input, init) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      const u = new URL(urlStr)

      if (method === 'MKCOL') {
        mkcolPaths.push(u.pathname)
        await new Promise((r) => setTimeout(r, 15))
        return new Response(null, { status: 201 })
      }

      if (method === 'PUT') {
        const bytes = new Uint8Array(await new Response(init?.body as BodyInit).arrayBuffer())
        files.set(u.pathname, bytes)
        return new Response(null, { status: 201 })
      }

      if (method === 'PROPFIND') {
        const hit = files.get(u.pathname)
        if (!hit) return new Response(null, { status: 404 })
        // Первый propstat = 404 с ложными тегами и самозакрывающимся тегом, затем ДВА отдельных 200 propstat
        return new Response(
          `<?xml version="1.0" encoding="utf-8"?>
          <D:multistatus xmlns:D="DAV:">
            <D:response>
              <D:href>${u.pathname}</D:href>
              <D:propstat>
                <D:prop>
                  <D:getcontenttype/>
                  <D:getcontentlength>999999</D:getcontentlength>
                </D:prop>
                <D:status>HTTP/1.1 404 Not Found</D:status>
              </D:propstat>
              <D:propstat>
                <D:prop>
                  <D:resourcetype/>
                  <D:getcontentlength>${hit.byteLength}</D:getcontentlength>
                </D:prop>
                <D:status>HTTP/1.1 200 OK</D:status>
              </D:propstat>
              <D:propstat>
                <D:prop>
                  <D:getcontenttype>image/webp</D:getcontenttype>
                  <D:getlastmodified>Wed, 28 Oct 2026 12:00:00 GMT</D:getlastmodified>
                </D:prop>
                <D:status>HTTP/1.1 200 OK</D:status>
              </D:propstat>
            </D:response>
          </D:multistatus>`,
          { status: 207, headers: { 'content-type': 'application/xml' } },
        )
      }

      return new Response(null, { status: 404 })
    }

    const dav = webdavDriver({
      endpoint: 'https://dav.example.test',
      username: 'u',
      password: 'p',
      basePath: 'root',
      fetchImpl: mockDavFetch,
    })

    await Promise.all([
      dav.put({
        path: 'albums/2026/photo (1).webp',
        stream: new Blob([new Uint8Array([1, 2, 3, 4])]).stream() as ReadableStream<Uint8Array>,
        size: 4,
        contentType: 'image/webp',
        lastModified: Date.now(),
      }),
      dav.put({
        path: 'albums/2026/photo (2).webp',
        stream: new Blob([new Uint8Array([5, 6, 7, 8, 9])]).stream() as ReadableStream<Uint8Array>,
        size: 5,
        contentType: 'image/webp',
        lastModified: Date.now(),
      }),
    ])

    // На каждый уровень ('/root/', '/root/albums/', '/root/albums/2026/') ушёл ровно 1 MKCOL, без дублей
    expect(mkcolPaths).toEqual(['/root/', '/root/albums/', '/root/albums/2026/'])

    const head = await dav.head('albums/2026/photo (1).webp')
    expect(head).not.toBeNull()
    expect(head!.size).toBe(4) // не 999999 из 404 propstat!
    expect(head!.contentType).toBe('image/webp') // прочитано из второго 200 propstat!
  })

  it('localDriver + jsonLedger: не затирают повреждённый _ledger.json и не глотают EISDIR при del()', async () => {
    const ledgerPath = join(tmpDir, 'corrupt-ledger.json')
    await writeFile(ledgerPath, '{ broken json', 'utf8')
    const ledger = jsonLedger({ filePath: ledgerPath })

    await expect(
      ledger.reserve({
        id: 'r1',
        allocations: [{ server: 's1', bytes: 10, maxStorageBytes: 100 }],
        ttlMs: 5_000,
      }),
    ).rejects.toThrow(SyntaxError)
    // Файл на диске НЕ перезаписан пустым `{ files: {} }`
    expect(await readFile(ledgerPath, 'utf8')).toBe('{ broken json')

    const diskRoot = join(tmpDir, 'disk')
    const driver = localDriver({ rootDir: diskRoot })
    expect(await driver.del('missing.bin')).toBe(false)

    // Если на месте файла оказалась директория (`EISDIR` / `EPERM`), `del()` обязан пробросить ошибку, а не вернуть `false`
    await mkdir(join(diskRoot, 'dir-collision'), { recursive: true })
    await expect(driver.del('dir-collision')).rejects.toThrow()
  })

  it('crypto + serve + Blob/Uint8Array: ловит усечение хвоста при Range-чтении первого чанка, отвязывает буфер и не ставит attachment на 304/416', async () => {
    const plain = deterministicBytes(150_000, 77) // 3 чанка AES-256-GCM
    const encStream = encryptStream(
      new Blob([plain]).stream() as ReadableStream<Uint8Array>,
      'audit-secret-key',
    )
    const fullCipher = new Uint8Array(await new Response(encStream).arrayBuffer())
    // Усекаем последний чанк на сервере, оставляя валидными заголовок + первые 2 чанка
    const truncatedCipher = fullCipher.subarray(0, 32 + 2 * (64 * 1024 + 16))
    const truncatedFile = new StreamFile(
      {
        byteLength: truncatedCipher.byteLength,
        stream(s = 0, e = truncatedCipher.byteLength) {
          const sl = truncatedCipher.subarray(s, e)
          return new ReadableStream({
            start(c) {
              const cp = new Uint8Array(new ArrayBuffer(sl.byteLength))
              cp.set(sl)
              c.enqueue(cp)
              c.close()
            },
          })
        },
      },
      'trunc.enc',
    )

    expect(() =>
      createDecryptedStreamFile(truncatedFile, 'audit-secret-key', {
        plainSize: plain.byteLength,
      }),
    ).toThrow(StorageCryptoError)

    // Проверка мутации входного Uint8Array, срезов Blob > 64 KiB и заголовков 304/416 в serve()
    const storage = createStorage({
      servers: {
        s1: {
          driver: memoryDriver(),
          limits: { storageBytes: 2_000_000, fileBytes: 1_000_000 },
        },
      },
    })

    const mutable = new Uint8Array([10, 20, 30, 40])
    const putPromise = storage.put({
      path: 'docs/mutable (1)!.html',
      body: mutable,
      contentType: 'text/html',
    })
    mutable.fill(0xff)
    await putPromise
    const gotMutable = await storage.lazy('docs/mutable (1)!.html')
    expect(gotMutable).not.toBeNull()
    expect(Array.from(await gotMutable!.bytes())).toEqual([10, 20, 30, 40])

    // Проверка чтения большого Blob (> 2 чанков по 64 KiB) без вызова нативного Blob#stream()
    const bigBlobBytes = deterministicBytes(150_000, 91)
    await storage.put({
      path: 'docs/sliced-blob.bin',
      body: new Blob([bigBlobBytes], { type: 'application/octet-stream' }),
    })
    const gotBlob = await storage.lazy('docs/sliced-blob.bin')
    expect(new Uint8Array(await gotBlob!.arrayBuffer())).toEqual(bigBlobBytes)

    const ok200 = await storage.serve(
      'docs/mutable (1)!.html',
      new Request('http://localhost/f'),
    )
    expect(ok200.status).toBe(200)
    expect(ok200.headers.get('content-disposition')).toContain(
      "filename*=UTF-8''mutable%20%281%29%21.html",
    )

    const etag = ok200.headers.get('etag')!
    const notMod304 = await storage.serve(
      'docs/mutable (1)!.html',
      new Request('http://localhost/f', { headers: { 'if-none-match': etag } }),
    )
    expect(notMod304.status).toBe(304)
    expect(notMod304.headers.get('content-disposition')).toBeNull()

    const badRange416 = await storage.serve(
      'docs/mutable (1)!.html',
      new Request('http://localhost/f', { headers: { range: 'bytes=500-600' } }),
    )
    expect(badRange416.status).toBe(416)
    expect(badRange416.headers.get('content-disposition')).toBeNull()
  })
})
