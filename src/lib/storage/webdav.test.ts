import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import {
  createStorage,
  encryptedSize,
  memoryLedger,
  StorageReadOnlyError,
} from './index.js'
import {
  formatWebdavUrl,
  maskWebdavUrl,
  parseWebdavUrl,
  webdavDriver,
} from './webdav.js'

function patternedBuffer(length: number, seed: number): Buffer {
  const buf = Buffer.allocUnsafe(length)
  for (let i = 0; i < length; i++) {
    buf[i] = (i * 41 + seed) & 0xff
  }
  return buf
}

interface MockDavFile {
  bytes: Buffer
  contentType: string
  lastModified: Date
  etag: string
}

/**
 * Локальный HTTP WebDAV-стенд, воспроизводящий поведение Облака Mail.ru:
 * - Basic Auth;
 * - `PUT` без существующей родительской коллекции возвращает `409 Conflict`;
 * - `MKCOL` создаёт коллекцию (`201`), а на повторный вызов возвращает `405 Method Not Allowed`;
 * - `PROPFIND` (`Depth: 0` и `Depth: 1`) отдаёт `207 Multi-Status` XML (`<d:collection/>` для папок);
 * - `GET` с `Range: bytes=start-end` отдаёт `206 Partial Content`;
 * - `COPY` копирует по заголовку `Destination` (`201`/`204`), `DELETE` удаляет файлы и поддеревья папок.
 */
async function startMockWebdavServer(expectedAuth: string) {
  const collections = new Set<string>(['/'])
  const files = new Map<string, MockDavFile>()
  const log: Array<{ method: string; path: string }> = []

  const normCol = (p: string) => {
    const clean = '/' + p.split('/').filter(Boolean).map(decodeURIComponent).join('/')
    return clean === '/' ? '/' : `${clean}/`
  }
  const normFile = (p: string) =>
    '/' + p.split('/').filter(Boolean).map(decodeURIComponent).join('/')

  const parentColOf = (fileOrCol: string) => {
    const trimmed = fileOrCol.replace(/\/+$/, '')
    const idx = trimmed.lastIndexOf('/')
    return idx <= 0 ? '/' : `${trimmed.slice(0, idx)}/`
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const method = (req.method || 'GET').toUpperCase()
    const urlObj = new URL(req.url || '/', 'http://127.0.0.1')
    log.push({ method, path: urlObj.pathname })

    if (req.headers.authorization !== expectedAuth) {
      res.statusCode = 401
      res.end('Unauthorized')
      return
    }

    if (method === 'MKCOL') {
      const col = normCol(urlObj.pathname)
      const parent = parentColOf(col)
      if (!collections.has(parent)) {
        res.statusCode = 409
        res.end('Parent collection missing')
        return
      }
      if (collections.has(col)) {
        // Точная эмуляция Облака Mail.ru: повторный MKCOL на существующей папке -> 405
        res.statusCode = 405
        res.end('Collection already exists')
        return
      }
      collections.add(col)
      res.statusCode = 201
      res.end()
      return
    }

    if (method === 'PUT') {
      const fpath = normFile(urlObj.pathname)
      const parent = parentColOf(fpath)
      if (!collections.has(parent)) {
        for await (const _ of req) {
          // дренируем тело
        }
        res.statusCode = 409
        res.end('Conflict: parent collection does not exist')
        return
      }
      const chunks: Buffer[] = []
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      const bytes = Buffer.concat(chunks)
      const existed = files.has(fpath)
      files.set(fpath, {
        bytes,
        contentType: String(req.headers['content-type'] || 'application/octet-stream'),
        lastModified: new Date(),
        etag: `etag-${bytes.length}-${Date.now()}`,
      })
      res.statusCode = existed ? 204 : 201
      res.end()
      return
    }

    if (method === 'PROPFIND') {
      const depth = String(req.headers.depth || '0')
      for await (const _ of req) {
        // читаем XML propfind
      }
      const asCol = normCol(urlObj.pathname)
      const asFile = normFile(urlObj.pathname)

      const xmlEntries: string[] = []
      const renderCol = (c: string) =>
        `<d:response><d:href>${c}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop>` +
        `<d:resourcetype><d:collection/></d:resourcetype>` +
        `</d:prop></d:propstat></d:response>`
      const renderFile = (p: string, f: MockDavFile) =>
        `<d:response><d:href>${p}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop>` +
        `<d:resourcetype/>` +
        `<d:getcontentlength>${f.bytes.length}</d:getcontentlength>` +
        `<d:getcontenttype>${f.contentType}</d:getcontenttype>` +
        `<d:getlastmodified>${f.lastModified.toUTCString()}</d:getlastmodified>` +
        `<d:getetag>"${f.etag}"</d:getetag>` +
        `</d:prop></d:propstat></d:response>`

      if (files.has(asFile) && !urlObj.pathname.endsWith('/')) {
        xmlEntries.push(renderFile(asFile, files.get(asFile)!))
      } else if (collections.has(asCol)) {
        xmlEntries.push(renderCol(asCol))
        if (depth === '1') {
          for (const c of collections) {
            if (c !== asCol && parentColOf(c) === asCol) {
              xmlEntries.push(renderCol(c))
            }
          }
          for (const [fp, meta] of files) {
            if (parentColOf(fp) === asCol) {
              xmlEntries.push(renderFile(fp, meta))
            }
          }
        }
      } else {
        res.statusCode = 404
        res.end('Not Found')
        return
      }

      const xml =
        `<?xml version="1.0" encoding="utf-8"?>` +
        `<d:multistatus xmlns:d="DAV:">${xmlEntries.join('')}</d:multistatus>`
      res.statusCode = 207
      res.setHeader('content-type', 'application/xml; charset=utf-8')
      res.end(xml)
      return
    }

    if (method === 'GET' || method === 'HEAD') {
      const fpath = normFile(urlObj.pathname)
      const f = files.get(fpath)
      if (!f) {
        res.statusCode = 404
        res.end('Not Found')
        return
      }
      const range = req.headers.range
      if (range && method === 'GET') {
        const m = /^bytes=(\d+)-(\d+)?$/.exec(range)
        if (m) {
          const start = Number(m[1])
          const end = m[2] ? Math.min(Number(m[2]), f.bytes.length - 1) : f.bytes.length - 1
          const slice = f.bytes.subarray(start, end + 1)
          res.statusCode = 206
          res.setHeader('content-type', f.contentType)
          res.setHeader('content-length', String(slice.length))
          res.setHeader('content-range', `bytes ${start}-${end}/${f.bytes.length}`)
          res.end(slice)
          return
        }
      }
      res.statusCode = 200
      res.setHeader('content-type', f.contentType)
      res.setHeader('content-length', String(f.bytes.length))
      res.end(method === 'HEAD' ? undefined : f.bytes)
      return
    }

    if (method === 'COPY') {
      const srcPath = normFile(urlObj.pathname)
      const src = files.get(srcPath)
      if (!src) {
        res.statusCode = 404
        res.end('Source Not Found')
        return
      }
      const destHeader = String(req.headers.destination || '')
      const dstPath = normFile(new URL(destHeader).pathname)
      const dstParent = parentColOf(dstPath)
      if (!collections.has(dstParent)) {
        res.statusCode = 409
        res.end('Destination parent missing')
        return
      }
      const overwrite = String(req.headers.overwrite || 'T') !== 'F'
      const dstExisted = files.has(dstPath)
      if (dstExisted && !overwrite) {
        res.statusCode = 412
        res.end('Precondition Failed')
        return
      }
      files.set(dstPath, {
        bytes: Buffer.from(src.bytes),
        contentType: src.contentType,
        lastModified: new Date(),
        etag: `copy-${src.etag}`,
      })
      res.statusCode = dstExisted ? 204 : 201
      res.end()
      return
    }

    if (method === 'DELETE') {
      const asFile = normFile(urlObj.pathname)
      const asCol = normCol(urlObj.pathname)
      if (files.has(asFile) && !urlObj.pathname.endsWith('/')) {
        files.delete(asFile)
        res.statusCode = 200
        res.end()
        return
      }
      if (collections.has(asCol) && asCol !== '/') {
        for (const c of [...collections]) {
          if (c.startsWith(asCol)) collections.delete(c)
        }
        for (const fp of [...files.keys()]) {
          if (fp.startsWith(asCol)) files.delete(fp)
        }
        res.statusCode = 200
        res.end()
        return
      }
      res.statusCode = 404
      res.end('Not Found')
      return
    }

    res.statusCode = 405
    res.end()
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as AddressInfo).port
  return {
    endpoint: `http://127.0.0.1:${port}`,
    port,
    log,
    files,
    collections,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  }
}

describe('webdavDriver: DSN, MKCOL кэш, PROPFIND, Range 206, COPY, basePath и readOnly', () => {
  it('корректно разбирает и маскирует DSN webdav:// (включая email с @ от Mail.ru Cloud)', () => {
    const humanDsn =
      'webdav://ivan.petrov@mail.ru:pa%2Fss+word=42@webdav.cloud.mail.ru/modals-kit/demo?readOnly=1'
    const parsed = parseWebdavUrl(humanDsn)
    expect(parsed.endpoint).toBe('https://webdav.cloud.mail.ru')
    expect(parsed.username).toBe('ivan.petrov@mail.ru')
    expect(parsed.password).toBe('pa/ss+word=42')
    expect(parsed.basePath).toBe('modals-kit/demo')
    expect(parsed.readOnly).toBe(true)

    expect(maskWebdavUrl(humanDsn)).toBe('webdav://***@webdav.cloud.mail.ru/modals-kit/demo')

    const formatted = formatWebdavUrl(parsed)
    expect(parseWebdavUrl(formatted)).toEqual(parsed)
  })

  it('работает с локальным WebDAV-сервером (MKCOL 201/405 с кэшем, потоковый PUT, PROPFIND, Range 206, нативный COPY, readOnly и basePath)', async () => {
    const auth = `Basic ${Buffer.from('demo@mail.ru:app-secret-pass', 'utf8').toString('base64')}`
    const mock = await startMockWebdavServer(auth)

    try {
      const dsn = `webdav+http://demo@mail.ru:app-secret-pass@127.0.0.1:${mock.port}/sandbox/app`
      const driver = webdavDriver(dsn)

      // Защита от обхода basePath
      await expect(driver.head('../escape.txt')).rejects.toThrow()

      // 1. Потоковый PUT без известного size (chunked) создаёт родительские коллекции /sandbox/app/a/b через MKCOL
      const bodyA = patternedBuffer(96 * 1024, 17)
      let pos = 0
      const chunkedStream = new ReadableStream<Uint8Array>({
        pull(c) {
          if (pos >= bodyA.length) {
            c.close()
            return
          }
          const step = Math.min(16 * 1024, bodyA.length - pos)
          c.enqueue(bodyA.subarray(pos, pos + step))
          pos += step
        },
      })

      const putMeta = await driver.put({
        path: 'a/b/first.bin',
        stream: chunkedStream,
        contentType: 'application/octet-stream',
        lastModified: Date.now(),
      })
      expect(putMeta.size).toBe(bodyA.length)
      expect(mock.files.has('/sandbox/app/a/b/first.bin')).toBe(true)

      const mkcolCountAfterFirst = mock.log.filter((x) => x.method === 'MKCOL').length
      expect(mkcolCountAfterFirst).toBe(4) // /sandbox/, /sandbox/app/, /sandbox/app/a/, /sandbox/app/a/b/

      // Второй файл в ту же папку НЕ шлёт ни одного лишнего MKCOL благодаря кэшу!
      await driver.put({
        path: 'a/b/second.txt',
        stream: new Blob(['second-payload']).stream() as ReadableStream<Uint8Array>,
        size: 14,
        contentType: 'text/plain',
        lastModified: Date.now(),
      })
      expect(mock.log.filter((x) => x.method === 'MKCOL').length).toBe(mkcolCountAfterFirst)

      // Директория не путается с файлом при head() (PROPFIND видит <d:collection/>)
      expect(await driver.head('a/b')).toBeNull()

      // listObjects (PROPFIND Depth: 1) возвращает оба файла без самой папки
      const listed = await driver.listObjects('a/b')
      expect(listed.map((x) => x.path).sort()).toEqual(['a/b/first.bin', 'a/b/second.txt'])

      // 2. Интеграция через createStorage: probe(), AES-256-GCM + O(1) Range 206 и нативный COPY
      const storage = createStorage({
        ledger: memoryLedger(),
        servers: {
          dav: {
            url: dsn,
            limits: { storageBytes: 10 * 1024 * 1024, fileBytes: 5 * 1024 * 1024 },
            key: 'dav-aes-256-gcm-passphrase',
          },
        },
      })

      const probe = await storage.probe('dav')
      expect(probe.ok).toBe(true)

      const plain = patternedBuffer(150 * 1024, 53)
      const stored = await storage.put({ path: 'docs/report.bin', body: plain })
      expect(stored.encrypted).toBe(true)
      expect(stored.storedBytes).toBe(encryptedSize(plain.length))

      const rangeRes = await storage.serve(
        'docs/report.bin',
        new Request('http://test.local/docs/report.bin', {
          headers: { range: 'bytes=65520-65560' },
        }),
      )
      expect(rangeRes.status).toBe(206)
      expect(
        Buffer.compare(
          Buffer.from(await rangeRes.arrayBuffer()),
          plain.subarray(65520, 65561),
        ),
      ).toBe(0)

      // Внутрисерверный copy под новый путь использует нативный WebDAV COPY без повторного PUT!
      const copyCountBefore = mock.log.filter((x) => x.method === 'COPY').length
      const putCountBefore = mock.log.filter((x) => x.method === 'PUT').length
      const copied = await storage.copy({
        path: 'docs/report.bin',
        toPath: 'archive/report-copy.bin',
        from: 'dav',
        to: 'dav',
      })
      expect(copied.path).toBe('archive/report-copy.bin')
      expect(mock.log.filter((x) => x.method === 'COPY').length).toBe(copyCountBefore + 1)
      expect(mock.log.filter((x) => x.method === 'PUT').length).toBe(putCountBefore)

      const copiedRange = await storage.serve(
        'archive/report-copy.bin',
        new Request('http://test.local/archive/report-copy.bin', {
          headers: { range: 'bytes=65520-65560' },
        }),
      )
      expect(copiedRange.status).toBe(206)
      expect(
        Buffer.compare(
          Buffer.from(await copiedRange.arrayBuffer()),
          plain.subarray(65520, 65561),
        ),
      ).toBe(0)

      // 3. Строгая блокировка readOnly: ни одного мутирующего запроса по сети!
      const roDriver = webdavDriver(`${dsn}?readOnly=1`)
      const mutBefore = mock.log.filter((x) =>
        ['PUT', 'MKCOL', 'DELETE', 'COPY'].includes(x.method),
      ).length
      await expect(
        roDriver.put({
          path: 'forbidden.bin',
          stream: new Blob(['x']).stream() as ReadableStream<Uint8Array>,
          size: 1,
          contentType: 'text/plain',
          lastModified: Date.now(),
        }),
      ).rejects.toThrow(StorageReadOnlyError)
      await expect(roDriver.del('a/b/second.txt')).rejects.toThrow(StorageReadOnlyError)
      await expect(roDriver.copyObject('a/b/second.txt', 'a/b/third.txt')).rejects.toThrow(
        StorageReadOnlyError,
      )
      const mutAfter = mock.log.filter((x) =>
        ['PUT', 'MKCOL', 'DELETE', 'COPY'].includes(x.method),
      ).length
      expect(mutAfter).toBe(mutBefore)
    } finally {
      await mock.close()
    }
  })
})

const liveWebdavUrl = process.env.TEST_WEBDAV_URL
const liveS3Url = process.env.TEST_S3_PRIMARY_URL

describe.skipIf(!liveWebdavUrl)('живая проверка Облака Mail.ru по WebDAV (TEST_WEBDAV_URL)', () => {
  it(
    'проверяет readOnly-защиту, probe(), потоковое шифрование AES-256-GCM + O(1) Range 206, нативный COPY и перенос Mail.ru WebDAV <-> S3 с полной очисткой',
    async () => {
      const baseParsed = parseWebdavUrl(liveWebdavUrl!)
      const sandboxBasePath = [
        baseParsed.basePath,
        `modals-kit-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ]
        .filter(Boolean)
        .join('/')

      const isolatedDsn = formatWebdavUrl({
        endpoint: baseParsed.endpoint,
        username: baseParsed.username,
        password: baseParsed.password,
        basePath: sandboxBasePath,
      })
      const readOnlyDsn = formatWebdavUrl({
        endpoint: baseParsed.endpoint,
        username: baseParsed.username,
        password: baseParsed.password,
        basePath: sandboxBasePath,
        readOnly: true,
      })

      // 1. В режиме readOnly запись гарантированно блокируется без создания папки в облаке
      const roStorage = createStorage({
        servers: {
          mailru_ro: {
            url: readOnlyDsn,
            limits: { storageBytes: 64 * 1024 * 1024, fileBytes: 16 * 1024 * 1024 },
          },
        },
      })
      const roProbe = await roStorage.probe('mailru_ro')
      expect(roProbe.ok).toBe(true)
      expect(roProbe.readOnly).toBe(true)

      const rawSandboxDriver = webdavDriver(isolatedDsn)
      const s3KeyToClean: { storage?: ReturnType<typeof createStorage>; path?: string } = {}

      try {
        const servers: Record<string, { url: string; limits: { storageBytes: number; fileBytes: number }; key?: string }> = {
          mailru: {
            url: isolatedDsn,
            limits: { storageBytes: 64 * 1024 * 1024, fileBytes: 16 * 1024 * 1024 },
            key: 'mailru-live-aes-256-gcm-key-2026',
          },
        }
        if (liveS3Url) {
          servers.b2 = {
            url: liveS3Url,
            limits: { storageBytes: 64 * 1024 * 1024, fileBytes: 16 * 1024 * 1024 },
            key: 'mailru-live-aes-256-gcm-key-2026',
          }
        }

        const storage = createStorage({
          ledger: memoryLedger(),
          servers,
        })
        s3KeyToClean.storage = storage

        // 2. Живой probe() на Облаке Mail.ru (PUT -> PROPFIND -> Range 206 -> DELETE)
        const probeRes = await storage.probe('mailru')
        expect(probeRes.ok).toBe(true)

        // 3. Потоковая загрузка > 200 КиБ (4 блока AES-256-GCM по 64 КиБ) в вложенный путь Mail.ru Cloud
        const plain = patternedBuffer(210 * 1024, 77)
        const putRes = await storage.put({
          path: 'nested/encrypted-cloud.bin',
          body: plain,
          server: 'mailru',
        })
        expect(putRes.encrypted).toBe(true)
        expect(putRes.storedBytes).toBe(encryptedSize(plain.length))

        // На самом Облаке Mail.ru лежит именно шифротекст с сигнатурой MKSG1, а не открытый файл
        const rawHead = await rawSandboxDriver.head('nested/encrypted-cloud.bin')
        expect(rawHead?.size).toBe(encryptedSize(plain.length))
        const rawLazy = await rawSandboxDriver.lazy('nested/encrypted-cloud.bin')
        const rawHeader = Buffer.from(await rawLazy!.slice(0, 8).arrayBuffer())
        expect(rawHeader.equals(Buffer.from([0x4d, 0x4b, 0x53, 0x47, 0x31, 0, 0, 0]))).toBe(true)

        // 4. Чтение Range 206 поперёк стыка 64-КиБ блоков на Облаке Mail.ru за O(1)
        const seamStart = 2 * 65_536 - 30
        const seamEnd = 2 * 65_536 + 35
        const rangeRes = await storage.serve(
          'nested/encrypted-cloud.bin',
          new Request('http://test.local/nested/encrypted-cloud.bin', {
            headers: { range: `bytes=${seamStart}-${seamEnd - 1}` },
          }),
          { server: 'mailru' },
        )
        expect(rangeRes.status).toBe(206)
        expect(
          Buffer.compare(
            Buffer.from(await rangeRes.arrayBuffer()),
            plain.subarray(seamStart, seamEnd),
          ),
        ).toBe(0)

        // 5. Нативный WebDAV COPY внутри Облака Mail.ru
        const intraCopied = await storage.copy({
          path: 'nested/encrypted-cloud.bin',
          toPath: 'copied/from-native-dav.bin',
          from: 'mailru',
          to: 'mailru',
        })
        expect(intraCopied.size).toBe(plain.length)

        // 6. Если задан S3 — проверяем прямой потоковый перенос Mail.ru Cloud WebDAV -> Backblaze B2 S3!
        if (liveS3Url) {
          const crossPath = `cross-dav-to-s3-${Date.now()}.bin`
          s3KeyToClean.path = crossPath
          const crossMoved = await storage.copy({
            path: 'nested/encrypted-cloud.bin',
            toPath: crossPath,
            from: 'mailru',
            to: 'b2',
          })
          expect(crossMoved.server).toBe('b2')
          const b2Range = await storage.serve(
            crossPath,
            new Request('http://test.local/cross', {
              headers: { range: `bytes=${seamStart}-${seamEnd - 1}` },
            }),
            { server: 'b2' },
          )
          expect(b2Range.status).toBe(206)
          expect(
            Buffer.compare(
              Buffer.from(await b2Range.arrayBuffer()),
              plain.subarray(seamStart, seamEnd),
            ),
          ).toBe(0)
          await storage.del(crossPath, { server: 'b2' })
          s3KeyToClean.path = undefined
        }
      } finally {
        if (s3KeyToClean.storage && s3KeyToClean.path) {
          await s3KeyToClean.storage
            .del(s3KeyToClean.path, { server: 'b2' })
            .catch(() => undefined)
        }
        // Удаляем весь изолированный тестовый подкаталог с Облака Mail.ru одним DELETE коллекции
        const rootCleaner = webdavDriver({
          endpoint: baseParsed.endpoint,
          username: baseParsed.username,
          password: baseParsed.password,
        })
        await rootCleaner.del(sandboxBasePath).catch(() => undefined)
      }
    },
    60_000,
  )
})
