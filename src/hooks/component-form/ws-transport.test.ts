import { randomUUID } from 'node:crypto'
import { createServer, type Server as HttpServer } from 'node:http'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RequestEvent } from '@sveltejs/kit'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket as NodeWebSocket } from 'ws'
import { buildEnvelope, defineForm, field, v } from '#lib/form/index.js'
import { formTask } from '#lib/form/svelte/index.js'
import { createStorage } from '#lib/storage/index.js'
import { localDriver } from '#lib/storage/local.js'
import { attachNodeWsUpgrade } from '#server/vite-ws.server.js'
import { upgradeWs } from '#server/ws-upgrade.server.js'
import { componentFormRegistry, registerComponentForm } from './registry.js'
import { FORM_UPLOAD_WS_PATH, type FormUploadProgress } from './ws-protocol.js'
import { handleFormUploadWs } from './ws-session.server.js'
import {
  hasUploadableFiles,
  wsFormTransport,
  type ClientWebSocketConstructor,
} from './ws-transport.js'

describe('wsFormTransport + live progress', () => {
  let rootDir = ''
  let httpServer: HttpServer | null = null
  let wsEndpoint = ''

  beforeEach(async () => {
    componentFormRegistry().clear()
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
})
