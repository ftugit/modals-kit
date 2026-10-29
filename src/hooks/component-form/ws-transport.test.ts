import { randomUUID } from 'node:crypto'
import { createServer, type Server as HttpServer } from 'node:http'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RequestEvent } from '@sveltejs/kit'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket as NodeWebSocket } from 'ws'
import { buildEnvelope, CheckRegistry, defineForm, field, v } from '#lib/form/index.js'
import { formTask } from '#lib/form/svelte/index.js'
import { createStorage } from '#lib/storage/index.js'
import { localDriver } from '#lib/storage/local.js'
import { image, registerImageCheck } from '../../components/form/image.js'
import { attachNodeWsUpgrade } from '#server/vite-ws.server.js'
import { upgradeWs } from '#server/ws-upgrade.server.js'
import { componentFormRegistry, registerComponentForm } from './registry.js'
import {
  computeWsMaxPayloadBytes,
  FORM_UPLOAD_WS_PATH,
  type FormUploadProgress,
} from './ws-protocol.js'
import { handleFormUploadWs, type WsFormSessionOptions } from './ws-session.server.js'
import {
  hasUploadableFiles,
  wsFormTransport,
  type ClientWebSocketConstructor,
} from './ws-transport.js'

describe('wsFormTransport + live progress', () => {
  let rootDir = ''
  let httpServer: HttpServer | null = null
  let wsEndpoint = ''
  let sessionOptions: WsFormSessionOptions = {}

  beforeEach(async () => {
    componentFormRegistry().clear()
    sessionOptions = {}
    rootDir = await mkdtemp(join(tmpdir(), 'modals-ws-client-'))

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

        void upgradeWs(
          fakeEvent,
          (socket) => handleFormUploadWs(socket, fakeEvent, sessionOptions),
          { maxPayload: computeWsMaxPayloadBytes(sessionOptions.chunkBytes) },
        ).then(
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
    wsEndpoint = `ws://127.0.0.1:${port}${FORM_UPLOAD_WS_PATH}`
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

  const NodeWsWithOrigin = class extends NodeWebSocket {
    constructor(url: string) {
      super(url, { headers: { origin: 'http://localhost:5173' } })
    }
  } as unknown as ClientWebSocketConstructor

  it('различает формы без файлов (HTTP fetch) и формы с выбранным File (wss://)', () => {
    const textOnly = new FormData()
    textOnly.set('name', 'Алиса')
    // Браузер добавляет пустой безымянный File("", 0) на невыбранный <input type="file">
    textOnly.set('avatar', new File([], ''))
    expect(hasUploadableFiles(textOnly)).toBe(false)

    const withFile = new FormData()
    withFile.set('name', 'Алиса')
    withFile.set('avatar', new File([new Uint8Array([1, 2, 3])], 'a.bin'))
    expect(hasUploadableFiles(withFile)).toBe(true)
  })

  it('отправляет файл 3.2 МБ через wsFormTransport с монотонным прогрессом и совместимостью с formTask', async () => {
    const storage = createStorage({ servers: { local: localDriver({ rootDir }) } })
    const form = defineForm({
      id: 'ws_client_roundtrip',
      fields: {
        title: field.text({ validate: [v.required()] }),
        archive: field.file({ validate: [v.required(), v.maxSize(20 * 1024 * 1024)] }),
      },
    })

    registerComponentForm({
      description: form,
      async execute({ values, commit }) {
        const file = values.archive as File
        const stored = await storage.put({
          path: `uploads/${file.name}`,
          body: file.stream(),
          contentType: file.type,
          size: file.size,
        })
        commit()
        return { data: { path: stored.path, size: stored.size } }
      },
    })

    const size = 3 * 1024 * 1024 + 210_000
    const rawBytes = new Uint8Array(size)
    for (let i = 0; i < size; i++) rawBytes[i] = (i * 13 + 5) & 0xff
    const file = new File([rawBytes], 'video.mp4', { type: 'video/mp4' })

    const submissionId = randomUUID()
    const instance = `${form.id}:main` as `${string}:${string}`
    const env = buildEnvelope({
      formId: form.id,
      revision: form.revision,
      instance,
      submissionId,
    })

    const fd = new FormData()
    for (const [k, val] of Object.entries(env)) fd.set(k, val)
    fd.set(form.policy.envelopeKeys.intent, 'submit')
    fd.set('title', 'Демо-видео')
    fd.set('archive', file)

    const reports: FormUploadProgress[] = []
    const transport = wsFormTransport(() => '/upload-demo', {
      wsUrl: wsEndpoint,
      WebSocketImpl: NodeWsWithOrigin,
    })

    const outcome = await transport({
      envelope: {
        formId: form.id,
        revision: form.revision,
        instance,
        submissionId,
        intent: 'submit',
      },
      data: fd,
      accept: ['application/json'],
      signal: new AbortController().signal,
      report: (progress) => {
        reports.push(progress as FormUploadProgress)
      },
    })

    expect(outcome.kind).toBe('result')
    if (outcome.kind === 'result') {
      expect(outcome.result.ok).toBe(true)
      expect(outcome.result.data).toEqual({ path: 'uploads/video.mp4', size })
    }

    // Проверяем фазы прогресса: validating -> uploading (сегменты) -> processing -> done
    expect(reports[0]?.phase).toBe('validating')
    expect(reports.some((r) => r.phase === 'uploading' && r.percent > 0 && r.percent < 100)).toBe(
      true,
    )
    expect(reports.some((r) => r.phase === 'processing')).toBe(true)
    expect(reports.at(-1)?.phase).toBe('done')
    expect(reports.at(-1)?.percent).toBe(100)

    // Монотонность sentBytes и совместимость с formTask
    let prevBytes = 0
    for (const snap of reports) {
      expect(snap.sentBytes).toBeGreaterThanOrEqual(prevBytes)
      prevBytes = snap.sentBytes
    }
    const midSnap = reports.find((r) => r.phase === 'uploading' && r.sentBytes > 0)!
    const taskView = formTask({
      status: 'submitting',
      pending: true,
      pendingIntent: 'submit',
      progress: midSnap,
    } as never)
    expect(taskView).toMatchObject({
      status: 'pending',
      scope: 'local',
      progress: { kind: 'bytes', loaded: midSnap.sentBytes, total: size },
    })

    const stored = await storage.lazy('uploads/video.mp4')
    expect(Buffer.compare(Buffer.from(await stored!.bytes()), Buffer.from(rawBytes))).toBe(0)
  })

  it('прерывает загрузку по AbortController.abort() и очищает .part на сервере', async () => {
    const storage = createStorage({ servers: { local: localDriver({ rootDir }) } })
    const form = defineForm({
      id: 'ws_client_abort',
      fields: {
        archive: field.file({ validate: [v.required(), v.maxSize(20 * 1024 * 1024)] }),
      },
    })

    registerComponentForm({
      description: form,
      async execute({ values, commit }) {
        const file = values.archive as File
        await storage.put({
          path: `uploads/${file.name}`,
          body: file.stream(),
          size: file.size,
        })
        commit()
        return { data: { ok: true } }
      },
    })

    const size = 4 * 1024 * 1024
    const file = new File([new Uint8Array(size)], 'cancel-me.bin')
    const submissionId = randomUUID()
    const instance = `${form.id}:main` as `${string}:${string}`
    const env = buildEnvelope({
      formId: form.id,
      revision: form.revision,
      instance,
      submissionId,
    })

    const fd = new FormData()
    for (const [k, val] of Object.entries(env)) fd.set(k, val)
    fd.set(form.policy.envelopeKeys.intent, 'submit')
    fd.set('archive', file)

    const ac = new AbortController()
    const transport = wsFormTransport(() => '/upload-demo', {
      wsUrl: wsEndpoint,
      WebSocketImpl: NodeWsWithOrigin,
    })

    const outcome = await transport({
      envelope: {
        formId: form.id,
        revision: form.revision,
        instance,
        submissionId,
        intent: 'submit',
      },
      data: fd,
      accept: ['application/json'],
      signal: ac.signal,
      report: (progress) => {
        const p = progress as FormUploadProgress
        if (p.phase === 'uploading' && p.sentBytes >= 512 * 1024) {
          ac.abort()
        }
      },
    })

    expect(outcome).toEqual({ kind: 'abort', reason: 'aborted' })
    await new Promise((r) => setTimeout(r, 60))
    expect(await storage.head('uploads/cancel-me.bin')).toBeNull()
    const tmpFiles = await readdir(join(rootDir, '.storage-tmp')).catch(() => [] as string[])
    expect(tmpFiles).toEqual([])
  })

  it('включает и выключает солёную проверку HMAC-SHA-256 индивидуально на каждую загрузку (включая imageCheck headCache)', async () => {
    const storage = createStorage({ servers: { local: localDriver({ rootDir }) } })
    const valid1x1Png = Uint8Array.from(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    )

    const form = defineForm({
      id: 'ws_per_upload_integrity',
      fields: {
        verify_integrity: field.checkbox({ defaultValue: true }),
        photo: field.file({ validate: [v.required(), v.accept(['image/png']), image()] }),
      },
    })

    const checks = new CheckRegistry()
    registerImageCheck(checks)

    registerComponentForm({
      description: form,
      checks,
      integrity: (_event, rawForm) => rawForm.get('verify_integrity') === 'on',
      async execute({ values, commit }) {
        const file = values.photo as File
        const stored = await storage.put({
          path: `salted/${file.name}`,
          body: file.stream(),
          contentType: file.type,
          size: file.size,
        })
        commit()
        return { data: { path: stored.path, size: stored.size } }
      },
    })

    // PNG ~600 КБ (3 сегмента: сегмент 0 проверяется в imageCheck, кэшируется в headCache и догружается в execute)
    const bigPng = new Uint8Array(600 * 1024)
    bigPng.set(valid1x1Png, 0)
    for (let i = valid1x1Png.byteLength; i < bigPng.byteLength; i++) {
      bigPng[i] = (i * 29 + 11) & 0xff
    }

    const transport = wsFormTransport(() => '/upload-demo', {
      wsUrl: wsEndpoint,
      WebSocketImpl: NodeWsWithOrigin,
    })

    const submitOnce = async (salted: boolean, filename: string) => {
      const submissionId = randomUUID()
      const instance = `${form.id}:main` as `${string}:${string}`
      const env = buildEnvelope({
        formId: form.id,
        revision: form.revision,
        instance,
        submissionId,
      })
      const fd = new FormData()
      for (const [k, val] of Object.entries(env)) fd.set(k, val)
      fd.set(form.policy.envelopeKeys.intent, 'submit')
      if (salted) fd.set('verify_integrity', 'on')
      fd.set('photo', new File([bigPng], filename, { type: 'image/png' }))

      const snapshots: FormUploadProgress[] = []
      const res = await transport({
        envelope: {
          formId: form.id,
          revision: form.revision,
          instance,
          submissionId,
          intent: 'submit',
        },
        data: fd,
        accept: ['application/json'],
        signal: new AbortController().signal,
        report: (p) => snapshots.push(p as FormUploadProgress),
      })
      return { res, snapshots }
    }

    // Загрузка №1: с одноразовой серверной солью и потоковым HMAC-SHA-256
    const runSalted = await submitOnce(true, 'salted.png')
    expect(runSalted.res.kind).toBe('result')
    if (runSalted.res.kind === 'result') {
      expect(runSalted.res.result.ok).toBe(true)
    }
    expect(runSalted.snapshots.at(-1)?.salted).toBe(true)
    const savedSalted = await storage.lazy('salted/salted.png')
    expect(Buffer.compare(Buffer.from(await savedSalted!.bytes()), Buffer.from(bigPng))).toBe(0)

    // Загрузка №2 в ту же форму: без соли и без вычисления HMAC
    const runPlain = await submitOnce(false, 'plain.png')
    expect(runPlain.res.kind).toBe('result')
    if (runPlain.res.kind === 'result') {
      expect(runPlain.res.result.ok).toBe(true)
    }
    expect(runPlain.snapshots.at(-1)?.salted).toBe(false)
    const savedPlain = await storage.lazy('salted/plain.png')
    expect(Buffer.compare(Buffer.from(await savedPlain!.bytes()), Buffer.from(bigPng))).toBe(0)
  })

  it('возвращает ошибку 422 на поле и удаляет .part, если файл на устройстве клиента изменился во время загрузки', async () => {
    const storage = createStorage({ servers: { local: localDriver({ rootDir }) } })
    const form = defineForm({
      id: 'ws_client_file_mutated',
      fields: {
        archive: field.file({ validate: [v.required()] }),
      },
    })

    registerComponentForm({
      description: form,
      integrity: true,
      async execute({ values, commit }) {
        const file = values.archive as File
        await storage.put({
          path: `mutated/${file.name}`,
          body: file.stream(),
          size: file.size,
        })
        commit()
        return { data: { ok: true } }
      },
    })

    const initialSize = 700 * 1024
    const file = new File([new Uint8Array(initialSize)], 'live-log.bin', {
      type: 'application/octet-stream',
      lastModified: 1_700_000_000_000,
    })
    let mutatedSize = initialSize
    Object.defineProperty(file, 'size', {
      get: () => mutatedSize,
    })

    const submissionId = randomUUID()
    const instance = `${form.id}:main` as `${string}:${string}`
    const env = buildEnvelope({
      formId: form.id,
      revision: form.revision,
      instance,
      submissionId,
    })
    const fd = new FormData()
    for (const [k, val] of Object.entries(env)) fd.set(k, val)
    fd.set(form.policy.envelopeKeys.intent, 'submit')
    fd.set('archive', file)

    const transport = wsFormTransport(() => '/upload-demo', {
      wsUrl: wsEndpoint,
      WebSocketImpl: NodeWsWithOrigin,
    })

    const outcome = await transport({
      envelope: {
        formId: form.id,
        revision: form.revision,
        instance,
        submissionId,
        intent: 'submit',
      },
      data: fd,
      accept: ['application/json'],
      signal: new AbortController().signal,
      report: (progress) => {
        const p = progress as FormUploadProgress
        // Как только первый сегмент (256 КБ) ушёл, имитируем дозапись файла на диске пользователя
        if (p.phase === 'uploading' && p.sentBytes >= 256 * 1024) {
          mutatedSize = initialSize + 4096
        }
      },
    })

    expect(outcome.kind).toBe('result')
    if (outcome.kind === 'result') {
      expect(outcome.result.ok).toBe(false)
      expect(outcome.result.status).toBe(422)
      expect(outcome.result.outcome).toBe('not-applied')
      expect(outcome.result.errors[0]).toMatchObject({
        path: 'archive',
        code: 'file.changed',
      })
    }

    expect(await storage.head('mutated/live-log.bin')).toBeNull()
    const tmpFiles = await readdir(join(rootDir, '.storage-tmp')).catch(() => [] as string[])
    expect(tmpFiles).toEqual([])
  })

  it('конвейерно прокачивает сегменты 512 КБ (WS_UPLOAD_CHUNK_SIZE) с AES-256-GCM, солёным HMAC и живым heartbeat без 5-мин отсечки', async () => {
    sessionOptions = {
      chunkBytes: 512 * 1024,
      windowSize: 4,
      heartbeatMs: 35,
      idleTimeoutMs: 140,
      platform: 'vercel',
      maxDurationMs: 300_000,
    }
    const encryptionKey = '5a'.repeat(32)
    const storage = createStorage({
      servers: {
        local: {
          driver: localDriver({ rootDir }),
          limits: { storageBytes: 1024 * 1024 * 1024, fileBytes: 50 * 1024 * 1024 },
          key: encryptionKey,
          rate: 4 * 1024 * 1024, // для 5.2 МБ хвост после стартового окна занимает ~300 мс (> 2 * idleTimeoutMs)
        },
      },
    })

    const form = defineForm({
      id: 'ws_pipelined_512k',
      fields: {
        bundle: field.file({ validate: [v.required()] }),
      },
    })

    registerComponentForm({
      description: form,
      integrity: true,
      async execute({ values, commit }) {
        const file = values.bundle as File
        const stored = await storage.put({
          path: `pipelined/${file.name}`,
          body: file.stream(),
          size: file.size,
        })
        commit()
        return { data: { path: stored.path, size: stored.size } }
      },
    })

    const rawBytes = new Uint8Array(Math.floor(5.2 * 1024 * 1024))
    for (let i = 0; i < rawBytes.byteLength; i++) {
      rawBytes[i] = (i * 37 + 19) & 0xff
    }

    const submissionId = randomUUID()
    const instance = `${form.id}:main` as `${string}:${string}`
    const env = buildEnvelope({ formId: form.id, revision: form.revision, instance, submissionId })
    const fd = new FormData()
    for (const [k, val] of Object.entries(env)) fd.set(k, val)
    fd.set(form.policy.envelopeKeys.intent, 'submit')
    fd.set('bundle', new File([rawBytes], 'video-chunked.bin', { type: 'application/octet-stream' }))

    const snapshots: FormUploadProgress[] = []
    const transport = wsFormTransport(() => '/upload-demo', {
      wsUrl: wsEndpoint,
      WebSocketImpl: NodeWsWithOrigin,
    })

    const res = await transport({
      envelope: { formId: form.id, revision: form.revision, instance, submissionId, intent: 'submit' },
      data: fd,
      accept: ['application/json'],
      signal: new AbortController().signal,
      report: (p) => snapshots.push(p as FormUploadProgress),
    })

    expect(res.kind).toBe('result')
    if (res.kind === 'result') {
      expect(res.result.ok).toBe(true)
    }

    const readySnap = snapshots.find((s) => s.chunkBytes === 512 * 1024)
    expect(readySnap).toBeDefined()
    expect(readySnap?.platform).toBe('vercel')
    expect(readySnap?.maxDurationMs).toBe(300_000)
    expect(snapshots.some((s) => s.bytesPerSecond > 0)).toBe(true)
    expect(snapshots.at(-1)?.files[0]?.totalSegments).toBe(Math.ceil(rawBytes.byteLength / (512 * 1024)))

    const decrypted = await storage.lazy('pipelined/video-chunked.bin', { key: encryptionKey })
    expect(decrypted).not.toBeNull()
    expect(Buffer.compare(Buffer.from(await decrypted!.bytes()), Buffer.from(rawBytes))).toBe(0)
  })

  it('автоматически дозагружает прерванный поток на мобильном обрыве (resume-ok) и перезапускает с 0 при холодном инстансе (resume-miss)', async () => {
    const encryptionKey = 'a7'.repeat(32)
    const storage = createStorage({
      servers: {
        local: {
          driver: localDriver({ rootDir }),
          limits: { storageBytes: 1024 * 1024 * 1024, fileBytes: 50 * 1024 * 1024 },
          key: encryptionKey,
        },
      },
    })

    const form = defineForm({
      id: 'ws_mobile_autoresume',
      fields: {
        archive: field.file({ validate: [v.required()] }),
      },
    })

    registerComponentForm({
      description: form,
      integrity: true,
      async execute({ values, commit }) {
        const file = values.archive as File
        const stored = await storage.put({
          path: `resumed/${file.name}`,
          body: file.stream(),
          size: file.size,
        })
        commit()
        return { data: { path: stored.path, size: stored.size } }
      },
    })

    const payload = new Uint8Array(1.5 * 1024 * 1024) // 6 сегментов по 256 КБ
    for (let i = 0; i < payload.byteLength; i++) {
      payload[i] = (i * 53 + 7) & 0xff
    }

    const runWithSimulatedDrop = async (filename: string, warmInstance: boolean) => {
      sessionOptions = {
        chunkBytes: 256 * 1024,
        windowSize: 2,
        resumeGraceMs: warmInstance ? 10_000 : 0,
      }
      let openedSockets = 0
      let binaryFramesOnFirstSocket = 0

      class FlakyMobileWs extends NodeWebSocket {
        readonly socketIndex: number
        constructor(url: string) {
          super(url, { headers: { origin: 'http://localhost:5173' } })
          openedSockets += 1
          this.socketIndex = openedSockets
        }
        override send(data: Parameters<NodeWebSocket['send']>[0]): void {
          if (this.socketIndex === 1 && data instanceof Uint8Array) {
            binaryFramesOnFirstSocket += 1
            if (binaryFramesOnFirstSocket === 2) {
              // На 2-м бинарном сегменте имитируем мгновенный обрыв радиоканала (код 1006) ДО его доставки
              this.terminate()
              return
            }
          }
          super.send(data)
        }
      }

      const submissionId = randomUUID()
      const instance = `${form.id}:main` as `${string}:${string}`
      const env = buildEnvelope({ formId: form.id, revision: form.revision, instance, submissionId })
      const fd = new FormData()
      for (const [k, val] of Object.entries(env)) fd.set(k, val)
      fd.set(form.policy.envelopeKeys.intent, 'submit')
      fd.set('archive', new File([payload], filename, { type: 'application/octet-stream' }))

      const snapshots: FormUploadProgress[] = []
      const transport = wsFormTransport(() => '/upload-demo', {
        wsUrl: wsEndpoint,
        WebSocketImpl: FlakyMobileWs as unknown as ClientWebSocketConstructor,
        reconnectBaseDelayMs: 30,
      })

      const out = await transport({
        envelope: { formId: form.id, revision: form.revision, instance, submissionId, intent: 'submit' },
        data: fd,
        accept: ['application/json'],
        signal: new AbortController().signal,
        report: (p) => snapshots.push(p as FormUploadProgress),
      })

      return { out, openedSockets, snapshots }
    }

    // 1) Тёплый инстанс (`resume-ok`): продолжаем без потери уже принятых сегментов
    const warm = await runWithSimulatedDrop('warm-lte.bin', true)
    expect(warm.out.kind).toBe('result')
    if (warm.out.kind === 'result') {
      expect(warm.out.result.ok).toBe(true)
    }
    expect(warm.openedSockets).toBe(2)
    expect(warm.snapshots.some((s) => s.phase === 'reconnecting')).toBe(true)
    expect(warm.snapshots.at(-1)?.resumedCount).toBe(1)
    const savedWarm = await storage.lazy('resumed/warm-lte.bin', { key: encryptionKey })
    expect(Buffer.compare(Buffer.from(await savedWarm!.bytes()), Buffer.from(payload))).toBe(0)

    // 2) Холодный инстанс (`resume-miss`): сервер не знает sessionId, клиент чисто перезапускает с байта 0
    const cold = await runWithSimulatedDrop('cold-vercel.bin', false)
    expect(cold.out.kind).toBe('result')
    if (cold.out.kind === 'result') {
      expect(cold.out.result.ok).toBe(true)
    }
    expect(cold.openedSockets).toBe(2)
    expect(cold.snapshots.at(-1)?.resumedCount).toBe(1)
    const savedCold = await storage.lazy('resumed/cold-vercel.bin', { key: encryptionKey })
    expect(Buffer.compare(Buffer.from(await savedCold!.bytes()), Buffer.from(payload))).toBe(0)
  })

  it('гарантирует новое wss://-соединение и новый серверный таймер после отмены, ошибки и успешного завершения', async () => {
    const storage = createStorage({ servers: { local: localDriver({ rootDir }) } })
    let failNextOnServer = false

    const form = defineForm({
      id: 'ws_fresh_connection_lifecycle',
      fields: {
        doc: field.file({ validate: [v.required()] }),
      },
    })

    registerComponentForm({
      description: form,
      integrity: true,
      async execute({ values, commit, fail }) {
        if (failNextOnServer) {
          return fail(
            [{ id: 'doc:custom', code: 'custom.rejected', message: 'Серверный отказ', path: 'doc', origin: 'server' }],
            'not-applied',
          )
        }
        const file = values.doc as File
        const stored = await storage.put({
          path: `lifecycle/${file.name}`,
          body: file.stream(),
          size: file.size,
        })
        commit()
        return { data: { path: stored.path } }
      },
    })

    let openedSockets = 0
    const readySessionIds: string[] = []

    class CountingWs extends NodeWebSocket {
      constructor(url: string) {
        super(url, { headers: { origin: 'http://localhost:5173' } })
        openedSockets += 1
        this.on('message', (raw, isBinary) => {
          if (isBinary) return
          const parsed = JSON.parse(raw.toString('utf8')) as { type?: string; sessionId?: string }
          if (parsed.type === 'ready' && parsed.sessionId) {
            readySessionIds.push(parsed.sessionId)
          }
        })
      }
    }

    const transport = wsFormTransport(() => '/upload-demo', {
      wsUrl: wsEndpoint,
      WebSocketImpl: CountingWs as unknown as ClientWebSocketConstructor,
    })

    const fileBytes = new Uint8Array(900 * 1024)
    for (let i = 0; i < fileBytes.byteLength; i++) fileBytes[i] = (i * 13) & 0xff

    const buildReq = (filename: string, controller = new AbortController()) => {
      const submissionId = randomUUID()
      const instance = `${form.id}:main` as `${string}:${string}`
      const env = buildEnvelope({ formId: form.id, revision: form.revision, instance, submissionId })
      const fd = new FormData()
      for (const [k, val] of Object.entries(env)) fd.set(k, val)
      fd.set(form.policy.envelopeKeys.intent, 'submit')
      fd.set('doc', new File([fileBytes], filename, { type: 'application/octet-stream' }))
      const snapshots: FormUploadProgress[] = []
      return {
        controller,
        snapshots,
        req: {
          envelope: { formId: form.id, revision: form.revision, instance, submissionId, intent: 'submit' as const },
          data: fd,
          accept: ['application/json'],
          signal: controller.signal,
          report: (p: unknown): void => {
            snapshots.push(p as FormUploadProgress)
          },
        },
      }
    }

    // 1) Отмена активной загрузки пользователем -> abort + уборка `.part`
    const cancelAttempt = buildReq('cancelled.bin')
    cancelAttempt.req.report = (p: unknown) => {
      const snap = p as FormUploadProgress
      cancelAttempt.snapshots.push(snap)
      if (snap.phase === 'uploading' && snap.sentBytes >= 256 * 1024) {
        cancelAttempt.controller.abort('user-cancelled')
      }
    }
    const resCancel = await transport(cancelAttempt.req)
    expect(resCancel.kind).toBe('abort')
    await new Promise((r) => setTimeout(r, 50))
    expect(await storage.head('lifecycle/cancelled.bin')).toBeNull()
    const tmpAfterCancel = await readdir(join(rootDir, '.storage-tmp')).catch(() => [] as string[])
    expect(tmpAfterCancel).toEqual([])

    // 2) Ошибка сервера -> новое соединение + новый таймер
    failNextOnServer = true
    const errorAttempt = buildReq('errored.bin')
    const resError = await transport(errorAttempt.req)
    expect(resError.kind).toBe('result')
    if (resError.kind === 'result') {
      expect(resError.result.ok).toBe(false)
    }

    // 3) Успешная загрузка после ошибки -> новое соединение + новый таймер
    failNextOnServer = false
    const okAttempt1 = buildReq('ok-1.bin')
    const resOk1 = await transport(okAttempt1.req)
    expect(resOk1.kind).toBe('result')
    if (resOk1.kind === 'result') {
      expect(resOk1.result.ok).toBe(true)
    }
    expect(okAttempt1.snapshots[0]?.elapsedMs ?? 0).toBeLessThan(250)

    // 4) Ещё одна успешная загрузка после успеха -> новое соединение + новый таймер
    const okAttempt2 = buildReq('ok-2.bin')
    const resOk2 = await transport(okAttempt2.req)
    expect(resOk2.kind).toBe('result')
    if (resOk2.kind === 'result') {
      expect(resOk2.result.ok).toBe(true)
    }
    expect(okAttempt2.snapshots[0]?.elapsedMs ?? 0).toBeLessThan(250)

    expect(openedSockets).toBe(4)
    expect(new Set(readySessionIds).size).toBe(4)
  })
})

