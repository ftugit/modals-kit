import { randomUUID } from 'node:crypto'
import { createServer, type Server as HttpServer } from 'node:http'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RequestEvent } from '@sveltejs/kit'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { buildEnvelope, CheckRegistry, defineForm, field, v } from '#lib/form/index.js'
import { reject } from '#lib/form/server.js'
import { createStorage } from '#lib/storage/index.js'
import { localDriver } from '#lib/storage/local.js'
import { image, registerImageCheck } from '../../components/form/image.js'
import { attachNodeWsUpgrade } from '#server/vite-ws.server.js'
import { upgradeWs } from '#server/ws-upgrade.server.js'
import { componentFormRegistry, registerComponentForm } from './registry.js'
import { createFileIntegrityChain, importUploadSaltKey } from './ws-integrity.js'
import { handleFormUploadWs } from './ws-session.server.js'
import {
  DEFAULT_WS_CHUNK_BYTES,
  FORM_UPLOAD_WS_PATH,
  packBinarySegment,
  type WsClientInitMessage,
  type WsServerMessage,
  type WsServerPullMessage,
} from './ws-protocol.js'

// Минимальный валидный 1x1 PNG (67 байт)
const VALID_1X1_PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
)

describe('ws-session + vite-ws + upgradeWs', () => {
  let rootDir = ''
  let httpServer: HttpServer | null = null
  let wsBaseUrl = ''

  beforeEach(async () => {
    componentFormRegistry().clear()
    rootDir = await mkdtemp(join(tmpdir(), 'modals-ws-upload-'))

    httpServer = createServer((_req, res) => {
      res.statusCode = 404
      res.end()
    })

    attachNodeWsUpgrade(
      httpServer,
      (req, res) => {
        const host = req.headers.host ?? 'localhost'
        const url = new URL(req.url ?? '/', `http://${host}`)
        const headers = new Headers()
        for (const [k, val] of Object.entries(req.headers)) {
          if (typeof val === 'string') headers.set(k, val)
          else if (Array.isArray(val)) headers.set(k, val.join(', '))
        }
        const webReq = new Request(url.href, { method: req.method ?? 'GET', headers })
        const fakeEvent = {
          request: webReq,
          url,
          cookies: {
            get: () => undefined,
            getAll: () => [],
            set: () => undefined,
            delete: () => undefined,
            serialize: () => '',
          },
          locals: {},
          params: {},
          platform: undefined,
          route: { id: '/api/form-upload' },
          isDataRequest: false,
          isSubRequest: false,
          isRemoteRequest: false,
          getClientAddress: () => '127.0.0.1',
          fetch,
          setHeaders: () => undefined,
          tracing: undefined as never,
        } as unknown as RequestEvent

        void upgradeWs(fakeEvent, (socket) => handleFormUploadWs(socket, fakeEvent)).then(
          (response) => {
            res.statusCode = response.status
            res.end()
          },
          () => {
            res.statusCode = 500
            res.end()
          },
        )
      },
      [FORM_UPLOAD_WS_PATH],
    )

    await new Promise<void>((resolve) => {
      httpServer!.listen(0, '127.0.0.1', () => resolve())
    })
    const addr = httpServer.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    wsBaseUrl = `ws://127.0.0.1:${port}${FORM_UPLOAD_WS_PATH}`
  })

  afterEach(async () => {
    componentFormRegistry().clear()
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer!.close(() => resolve()))
      httpServer = null
    }
    if (rootDir) {
      await rm(rootDir, { recursive: true, force: true })
    }
  })

  async function runWsUploadClient(
    init: WsClientInitMessage,
    fileBytesById: Record<string, Uint8Array>,
    opts?: { abortAfterSegments?: number },
  ): Promise<{
    pulls: WsServerPullMessage[]
    terminal: WsServerMessage | null
  }> {
    const pulls: WsServerPullMessage[] = []
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsBaseUrl, {
        headers: { origin: 'http://localhost:5173' },
      })
      let terminal: WsServerMessage | null = null
      let sentCount = 0

      ws.on('open', () => {
        ws.send(JSON.stringify(init))
      })

      ws.on('message', (raw, isBinary) => {
        if (isBinary) return
        const msg = JSON.parse(raw.toString('utf8')) as WsServerMessage
        if (msg.type === 'pull') {
          pulls.push(msg)
          if (opts?.abortAfterSegments !== undefined && sentCount >= opts.abortAfterSegments) {
            ws.close(1001, 'Client cancelled upload')
            return
          }
          const src = fileBytesById[msg.fileId]
          if (!src) {
            reject(new Error(`Missing test file bytes for ${msg.fileId}`))
            return
          }
          const slice = src.subarray(msg.offset, msg.offset + msg.length)
          ws.send(packBinarySegment(msg.reqId, slice))
          sentCount += 1
          return
        }
        terminal = msg
      })

      ws.on('close', () => {
        resolve({ pulls, terminal })
      })

      ws.on('error', (err) => reject(err))
    })
  }

  it('отклоняет невалидный Кадр 0 синхронными правилами с 0 запрошенных сегментов', async () => {
    const storage = createStorage({ servers: { local: localDriver({ rootDir }) } })
    let executed = false
    const form = defineForm({
      id: 'ws_sync_guard',
      fields: {
        title: field.text({ validate: [v.required()] }),
        doc: field.file({ validate: [v.required(), v.maxSize(1024 * 1024)] }),
      },
    })

    registerComponentForm({
      description: form,
      async execute({ commit }) {
        executed = true
        commit()
        return { data: { ok: true } }
      },
    })

    const env = buildEnvelope({
      formId: form.id,
      revision: form.revision,
      instance: `${form.id}:main`,
      submissionId: randomUUID(),
    })

    const { pulls, terminal } = await runWsUploadClient(
      {
        type: 'init',
        target: '/demo',
        fields: [
          ...Object.entries(env),
          [form.policy.envelopeKeys.intent, 'submit'],
          ['title', ''], // пустой обязательный заголовок + превышен maxSize
        ],
        files: [
          {
            id: 'f0',
            field: 'doc',
            name: 'huge.bin',
            size: 8 * 1024 * 1024,
            type: 'application/octet-stream',
            lastModified: Date.now(),
          },
        ],
      },
      { f0: new Uint8Array(0) },
    )

    expect(pulls).toHaveLength(0)
    expect(executed).toBe(false)
    expect(terminal?.type).toBe('result')
    if (terminal?.type === 'result') {
      expect(terminal.status).toBe(422)
      expect(terminal.result.ok).toBe(false)
      expect(terminal.result.errors.length).toBeGreaterThanOrEqual(2)
    }
    expect(await storage.head('huge.bin')).toBeNull()
  })

  it('проверяет шапку картинки (256 КБ) в imageCheck: режет битый файл на 1-м сегменте и переиспользует headCache на валидном', async () => {
    const storage = createStorage({ servers: { local: localDriver({ rootDir }) } })
    const form = defineForm({
      id: 'ws_image_check',
      fields: {
        photo: field.file({
          validate: [v.required(), v.accept(['image/png']), image()],
        }),
      },
    })

    const checks = new CheckRegistry()
    registerImageCheck(checks)

    registerComponentForm({
      description: form,
      checks,
      async execute({ values, commit }) {
        const file = values.photo as File
        const meta = await storage.put({
          path: `images/${file.name}`,
          body: file.stream(),
          contentType: file.type,
          size: file.size,
        })
        commit()
        return { data: { path: meta.path, size: meta.size } }
      },
    })

    // 1) Поддельный 2 МБ «PNG» — должен оборваться после ровно 1 сегмента (256 КБ)
    const fakePng = new Uint8Array(2 * 1024 * 1024)
    fakePng.fill(0x42)

    const badEnv = buildEnvelope({
      formId: form.id,
      revision: form.revision,
      instance: `${form.id}:main`,
      submissionId: randomUUID(),
    })

    const badRun = await runWsUploadClient(
      {
        type: 'init',
        target: '/demo',
        fields: [...Object.entries(badEnv), [form.policy.envelopeKeys.intent, 'submit']],
        files: [
          {
            id: 'f0',
            field: 'photo',
            name: 'fake.png',
            size: fakePng.byteLength,
            type: 'image/png',
            lastModified: Date.now(),
          },
        ],
      },
      { f0: fakePng },
    )

    expect(badRun.pulls).toHaveLength(1)
    expect(badRun.pulls[0]?.offset).toBe(0)
    expect(badRun.pulls[0]?.length).toBe(DEFAULT_WS_CHUNK_BYTES)
    expect(badRun.terminal?.type).toBe('result')
    if (badRun.terminal?.type === 'result') {
      expect(badRun.terminal.status).toBe(422)
    }

    // 2) Валидный PNG с хвостом до 1.2 МБ (5 сегментов): сегмент 0 НЕ должен качаться дважды
    const validPaddedPng = new Uint8Array(Math.floor(1.2 * 1024 * 1024))
    validPaddedPng.set(VALID_1X1_PNG, 0)
    for (let i = VALID_1X1_PNG.byteLength; i < validPaddedPng.byteLength; i++) {
      validPaddedPng[i] = (i * 17) & 0xff
    }

    const okEnv = buildEnvelope({
      formId: form.id,
      revision: form.revision,
      instance: `${form.id}:main`,
      submissionId: randomUUID(),
    })

    const okRun = await runWsUploadClient(
      {
        type: 'init',
        target: '/demo',
        fields: [...Object.entries(okEnv), [form.policy.envelopeKeys.intent, 'submit']],
        files: [
          {
            id: 'f0',
            field: 'photo',
            name: 'real.png',
            size: validPaddedPng.byteLength,
            type: 'image/png',
            lastModified: Date.now(),
          },
        ],
      },
      { f0: validPaddedPng },
    )

    const expectedSegments = Math.ceil(validPaddedPng.byteLength / DEFAULT_WS_CHUNK_BYTES)
    expect(okRun.pulls).toHaveLength(expectedSegments)
    expect(okRun.pulls.map((p) => p.segmentIndex)).toEqual([0, 1, 2, 3, 4])
    expect(okRun.terminal?.type).toBe('result')
    if (okRun.terminal?.type === 'result') {
      expect(okRun.terminal.status).toBe(200)
      expect(okRun.terminal.result.ok).toBe(true)
    }

    const saved = await storage.lazy('images/real.png')
    expect(saved).not.toBeNull()
    expect(Buffer.compare(Buffer.from(await saved!.bytes()), Buffer.from(validPaddedPng))).toBe(0)
  })

  it('стримит файл > 5.5 МБ сегментами по 256 КБ в один целый файл и очищает .part при обрыве сокета', async () => {
    const storage = createStorage({ servers: { local: localDriver({ rootDir }) } })
    let committedCount = 0

    const form = defineForm({
      id: 'ws_large_upload',
      fields: {
        caption: field.text({ validate: [v.required()] }),
        bundle: field.file({ validate: [v.required(), v.maxSize(25 * 1024 * 1024)] }),
      },
    })

    registerComponentForm({
      description: form,
      async execute({ values, commit }) {
        const file = values.bundle as File
        const meta = await storage.put({
          path: `bundles/${file.name}`,
          body: file.stream(),
          contentType: file.type,
          size: file.size,
        })
        committedCount += 1
        commit()
        return {
          data: {
            caption: values.caption,
            path: meta.path,
            size: meta.size,
          },
        }
      },
    })

    const size = 5 * 1024 * 1024 + 540_123 // > 5.5 MiB
    const payload = new Uint8Array(size)
    for (let i = 0; i < size; i++) payload[i] = (i * 29 + 11) & 0xff

    // 1) Обрыв соединения после 3 сегментов — ни файла, ни .part, ни commit()
    const abortEnv = buildEnvelope({
      formId: form.id,
      revision: form.revision,
      instance: `${form.id}:main`,
      submissionId: randomUUID(),
    })

    await runWsUploadClient(
      {
        type: 'init',
        target: '/demo',
        fields: [
          ...Object.entries(abortEnv),
          [form.policy.envelopeKeys.intent, 'submit'],
          ['caption', 'Прерванная загрузка'],
        ],
        files: [
          {
            id: 'f0',
            field: 'bundle',
            name: 'aborted.bin',
            size,
            type: 'application/octet-stream',
            lastModified: Date.now(),
          },
        ],
      },
      { f0: payload },
      { abortAfterSegments: 3 },
    )

    // Даём серверному `finally` закрыть дескриптор и удалить `.part`
    await new Promise((r) => setTimeout(r, 60))
    expect(committedCount).toBe(0)
    expect(await storage.head('bundles/aborted.bin')).toBeNull()
    const tmpFiles = await readdir(join(rootDir, '.storage-tmp')).catch(() => [] as string[])
    expect(tmpFiles).toEqual([])

    // 2) Полная успешная передача > 5.5 МБ
    const fullEnv = buildEnvelope({
      formId: form.id,
      revision: form.revision,
      instance: `${form.id}:main`,
      submissionId: randomUUID(),
    })

    const fullRun = await runWsUploadClient(
      {
        type: 'init',
        target: '/demo',
        fields: [
          ...Object.entries(fullEnv),
          [form.policy.envelopeKeys.intent, 'submit'],
          ['caption', 'Релизный архив'],
        ],
        files: [
          {
            id: 'f0',
            field: 'bundle',
            name: 'release.bin',
            size,
            type: 'application/octet-stream',
            lastModified: Date.now(),
          },
        ],
      },
      { f0: payload },
    )

    expect(fullRun.pulls.length).toBe(Math.ceil(size / DEFAULT_WS_CHUNK_BYTES))
    expect(fullRun.pulls.at(-1)?.recentSegments.length).toBeGreaterThan(0)
    expect(committedCount).toBe(1)
    expect(fullRun.terminal?.type).toBe('result')
    if (fullRun.terminal?.type === 'result') {
      expect(fullRun.terminal.status).toBe(200)
      expect(fullRun.terminal.result.ok).toBe(true)
      expect(fullRun.terminal.result.data).toEqual({
        caption: 'Релизный архив',
        path: 'bundles/release.bin',
        size,
      })
    }

    const stored = await storage.lazy('bundles/release.bin')
    expect(stored).not.toBeNull()
    expect(Buffer.compare(Buffer.from(await stored!.bytes()), Buffer.from(payload))).toBe(0)
  })

  it('ранний ACL-гейт authorize режет запрос на Кадре 0 ДО imageCheck (0 прочитанных сегментов файла)', async () => {
    let executed = false
    let authMode: 'reject-403' | 'expired-errors' = 'reject-403'

    const form = defineForm({
      id: 'ws_acl_gate',
      fields: {
        avatar: field.file({
          validate: [v.required(), v.accept(['image/png']), image()],
        }),
      },
    })

    const checks = new CheckRegistry()
    registerImageCheck(checks)

    registerComponentForm({
      description: form,
      checks,
      authorize() {
        if (authMode === 'reject-403') {
          return reject(403, 'auth.forbidden')
        }
        return [
          {
            id: 'auth.expired',
            code: 'auth.expired',
            message: 'Сессия устарела — войдите снова',
            origin: 'server',
          },
        ]
      },
      execute({ commit }) {
        executed = true
        commit()
        return { data: { ok: true } }
      },
    })

    const makeInit = (): WsClientInitMessage => {
      const env = buildEnvelope({
        formId: form.id,
        revision: form.revision,
        instance: `${form.id}:main`,
        submissionId: randomUUID(),
      })
      return {
        type: 'init',
        target: '/user/edit',
        fields: [...Object.entries(env), [form.policy.envelopeKeys.intent, 'submit']],
        files: [
          {
            id: 'f0',
            field: 'avatar',
            name: 'avatar.png',
            size: 1024 * 1024,
            type: 'image/png',
            lastModified: Date.now(),
          },
        ],
      }
    }

    // 1) Жёсткий отказ 403 Rejection — ни одного pull даже при наличии imageCheck
    const res403 = await runWsUploadClient(makeInit(), { f0: new Uint8Array(1024 * 1024) })
    expect(res403.pulls).toHaveLength(0)
    expect(executed).toBe(false)
    expect(res403.terminal?.type).toBe('result')
    if (res403.terminal?.type === 'result') {
      expect(res403.terminal.status).toBe(403)
      expect(res403.terminal.result.ok).toBe(false)
      expect(res403.terminal.result.errors[0]?.code).toBe('auth.forbidden')
    }

    // 2) Доменный список ошибок (`instruction` / `auth.expired`) — также 0 pull и сохранение кода `auth.expired`
    authMode = 'expired-errors'
    const res422 = await runWsUploadClient(makeInit(), { f0: new Uint8Array(1024 * 1024) })
    expect(res422.pulls).toHaveLength(0)
    expect(executed).toBe(false)
    expect(res422.terminal?.type).toBe('result')
    if (res422.terminal?.type === 'result') {
      expect(res422.terminal.status).toBe(422)
      expect(res422.terminal.result.ok).toBe(false)
      expect(res422.terminal.result.errors[0]?.code).toBe('auth.expired')
      expect(res422.terminal.result.errors[0]?.message).toContain('Сессия устарела')
    }
  })

  it('ловит искажение байта (bit-flip) при солёной цепочке HMAC-SHA-256 и возвращает 422 на поле с очисткой .part', async () => {
    const storage = createStorage({ servers: { local: localDriver({ rootDir }) } })
    const form = defineForm({
      id: 'ws_hmac_tamper',
      fields: {
        bundle: field.file({ validate: [v.required()] }),
      },
    })

    registerComponentForm({
      description: form,
      integrity: true,
      async execute({ values, commit }) {
        const file = values.bundle as File
        await storage.put({
          path: `tamper/${file.name}`,
          body: file.stream(),
          size: file.size,
        })
        commit()
        return { data: { ok: true } }
      },
    })

    const size = 2 * DEFAULT_WS_CHUNK_BYTES + 4096
    const original = new Uint8Array(size)
    for (let i = 0; i < size; i++) original[i] = (i * 19 + 3) & 0xff

    const env = buildEnvelope({
      formId: form.id,
      revision: form.revision,
      instance: `${form.id}:main`,
      submissionId: randomUUID(),
    })
    const init: WsClientInitMessage = {
      type: 'init',
      target: '/demo',
      fields: [...Object.entries(env), [form.policy.envelopeKeys.intent, 'submit']],
      files: [
        {
          id: 'f0',
          field: 'bundle',
          name: 'corrupted.bin',
          size,
          type: 'application/octet-stream',
          lastModified: Date.now(),
        },
      ],
    }

    const terminal = await new Promise<WsServerMessage | null>((resolve, rejectPromise) => {
      const ws = new WebSocket(wsBaseUrl, { headers: { origin: 'http://localhost:5173' } })
      let chainPromise: Promise<Awaited<ReturnType<typeof createFileIntegrityChain>>> | null = null
      let lastMsg: WsServerMessage | null = null

      ws.on('open', () => ws.send(JSON.stringify(init)))
      ws.on('message', (raw, isBinary) => {
        if (isBinary) return
        const msg = JSON.parse(raw.toString('utf8')) as WsServerMessage
        if (msg.type === 'pull') {
          void (async () => {
            expect(msg.salt).toMatch(/^[0-9a-f]{64}$/)
            if (!chainPromise) {
              const key = await importUploadSaltKey(msg.salt!)
              chainPromise = createFileIntegrityChain(key!, 'f0', size)
            }
            const chain = await chainPromise
            const cleanSlice = original.subarray(msg.offset, msg.offset + msg.length)
            const validTag = await chain.nextSegmentTag(msg.segmentIndex, msg.offset, cleanSlice)

            // На втором сегменте переворачиваем 1 бит полезных данных при старом теге
            const wirePayload = new Uint8Array(cleanSlice)
            if (msg.segmentIndex === 1) {
              wirePayload[17]! ^= 0x01
            }
            ws.send(packBinarySegment(msg.reqId, wirePayload, validTag))
          })()
          return
        }
        lastMsg = msg
      })
      ws.on('close', () => resolve(lastMsg))
      ws.on('error', (err) => rejectPromise(err))
    })

    expect(terminal?.type).toBe('result')
    if (terminal?.type === 'result') {
      expect(terminal.status).toBe(422)
      expect(terminal.result.ok).toBe(false)
      expect(terminal.result.outcome).toBe('not-applied')
      expect(terminal.result.errors[0]).toMatchObject({
        path: 'bundle',
        code: 'file.integrity',
      })
    }

    expect(await storage.head('tamper/corrupted.bin')).toBeNull()
    const tmpFiles = await readdir(join(rootDir, '.storage-tmp')).catch(() => [] as string[])
    expect(tmpFiles).toEqual([])
  })

  it('возвращает штатную ошибку 422 на поле при несовпадении размера бинарного сегмента', async () => {
    const storage = createStorage({ servers: { local: localDriver({ rootDir }) } })
    const form = defineForm({
      id: 'ws_short_segment',
      fields: {
        bundle: field.file({ validate: [v.required()] }),
      },
    })

    registerComponentForm({
      description: form,
      async execute({ values, commit }) {
        const file = values.bundle as File
        await storage.put({
          path: `short/${file.name}`,
          body: file.stream(),
          size: file.size,
        })
        commit()
        return { data: { ok: true } }
      },
    })

    const env = buildEnvelope({
      formId: form.id,
      revision: form.revision,
      instance: `${form.id}:main`,
      submissionId: randomUUID(),
    })

    const terminal = await new Promise<WsServerMessage | null>((resolve, rejectPromise) => {
      const ws = new WebSocket(wsBaseUrl, { headers: { origin: 'http://localhost:5173' } })
      let lastMsg: WsServerMessage | null = null
      ws.on('open', () => {
        ws.send(
          JSON.stringify({
            type: 'init',
            target: '/demo',
            fields: [...Object.entries(env), [form.policy.envelopeKeys.intent, 'submit']],
            files: [
              {
                id: 'f0',
                field: 'bundle',
                name: 'short.bin',
                size: 8192,
                type: 'application/octet-stream',
                lastModified: Date.now(),
              },
            ],
          } satisfies WsClientInitMessage),
        )
      })
      ws.on('message', (raw, isBinary) => {
        if (isBinary) return
        const msg = JSON.parse(raw.toString('utf8')) as WsServerMessage
        if (msg.type === 'pull') {
          // Шлём 100 байт вместо запрошенных 8192
          ws.send(packBinarySegment(msg.reqId, new Uint8Array(100)))
          return
        }
        lastMsg = msg
      })
      ws.on('close', () => resolve(lastMsg))
      ws.on('error', (err) => rejectPromise(err))
    })

    expect(terminal?.type).toBe('result')
    if (terminal?.type === 'result') {
      expect(terminal.status).toBe(422)
      expect(terminal.result.ok).toBe(false)
      expect(terminal.result.outcome).toBe('not-applied')
      expect(terminal.result.errors[0]).toMatchObject({
        path: 'bundle',
        code: 'file.size-mismatch',
      })
    }
    expect(await storage.head('short/short.bin')).toBeNull()
    const tmpFiles = await readdir(join(rootDir, '.storage-tmp')).catch(() => [] as string[])
    expect(tmpFiles).toEqual([])
  })

  it('поддерживает multiple: true с v.maxCount(2) по wss:// и блокирует подмену сигнатуры PDF активным HTML', async () => {
    const storage = createStorage({ servers: { local: localDriver({ rootDir }) } })
    const form = defineForm({
      id: 'ws_multi_and_magic',
      fields: {
        docs: field.file({
          multiple: true,
          validate: [v.required(), v.maxCount(2), v.accept(['application/pdf', '.pdf'])],
        }),
      },
    })

    registerComponentForm({
      description: form,
      async execute({ values, commit }) {
        const files = values.docs as readonly File[]
        const saved: string[] = []
        for (const f of files) {
          const meta = await storage.put({
            path: `docs/${f.name}`,
            body: f.stream(),
            contentType: f.type,
            size: f.size,
          })
          saved.push(meta.path)
        }
        commit()
        return { data: { saved } }
      },
    })

    const makeEnv = () =>
      buildEnvelope({
        formId: form.id,
        revision: form.revision,
        instance: `${form.id}:main`,
        submissionId: randomUUID(),
      })

    // 1) Превышение v.maxCount(2) (3 файла) -> мгновенный 422 на Кадре 0 (0 вытянутых сегментов!)
    const overCount = await runWsUploadClient(
      {
        type: 'init',
        target: '/demo',
        fields: [...Object.entries(makeEnv()), [form.policy.envelopeKeys.intent, 'submit']],
        files: [
          { id: 'f0', field: 'docs', name: '1.pdf', size: 64, type: 'application/pdf', lastModified: 1 },
          { id: 'f1', field: 'docs', name: '2.pdf', size: 64, type: 'application/pdf', lastModified: 1 },
          { id: 'f2', field: 'docs', name: '3.pdf', size: 64, type: 'application/pdf', lastModified: 1 },
        ],
      },
      {},
    )
    expect(overCount.pulls).toHaveLength(0)
    expect(overCount.terminal?.type).toBe('result')
    if (overCount.terminal?.type === 'result') {
      expect(overCount.terminal.status).toBe(422)
      expect(overCount.terminal.result.errors[0]?.code).toBe('maxCount')
    }

    // 2) Заявлен application/pdf, но внутри первого сегмента шлют HTML/скрипт -> 422 file.type-mismatch на 1-м сегменте
    const fakePdf = new Uint8Array(600 * 1024)
    fakePdf.set(new TextEncoder().encode('<!DOCTYPE html><script>evil()</script>'), 0)
    const spoofed = await runWsUploadClient(
      {
        type: 'init',
        target: '/demo',
        fields: [...Object.entries(makeEnv()), [form.policy.envelopeKeys.intent, 'submit']],
        files: [
          {
            id: 'f0',
            field: 'docs',
            name: 'spoof.pdf',
            size: fakePdf.byteLength,
            type: 'application/pdf',
            lastModified: 1,
          },
        ],
      },
      { f0: fakePdf },
    )
    expect(spoofed.pulls).toHaveLength(1) // Оборвано сразу на первом сегменте!
    expect(spoofed.terminal?.type).toBe('result')
    if (spoofed.terminal?.type === 'result') {
      expect(spoofed.terminal.status).toBe(422)
      expect(spoofed.terminal.result.errors[0]).toMatchObject({
        path: 'docs',
        code: 'file.type-mismatch',
      })
    }
    expect(await storage.head('docs/spoof.pdf')).toBeNull()

    // 3) Два настоящих PDF (%PDF-1.7...) -> оба проходят и сохраняются!
    const validPdf1 = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n')
    const validPdf2 = new TextEncoder().encode('%PDF-1.4\n2 0 obj\n<<>>\nendobj\n%%EOF\n')
    const okRun = await runWsUploadClient(
      {
        type: 'init',
        target: '/demo',
        fields: [...Object.entries(makeEnv()), [form.policy.envelopeKeys.intent, 'submit']],
        files: [
          { id: 'f0', field: 'docs', name: 'a.pdf', size: validPdf1.byteLength, type: 'application/pdf', lastModified: 1 },
          { id: 'f1', field: 'docs', name: 'b.pdf', size: validPdf2.byteLength, type: 'application/pdf', lastModified: 1 },
        ],
      },
      { f0: validPdf1, f1: validPdf2 },
    )
    expect(okRun.terminal?.type).toBe('result')
    if (okRun.terminal?.type === 'result') {
      expect(okRun.terminal.status).toBe(200)
      expect(okRun.terminal.result.ok).toBe(true)
      expect(okRun.terminal.result.data).toEqual({ saved: ['docs/a.pdf', 'docs/b.pdf'] })
    }
  })
})

