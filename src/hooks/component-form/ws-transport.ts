// Клиентский потоковый `wss://`-транспорт форм с файлами.
//
// Инварианты:
// - отправляет Кадр 0 (`init` с текстовыми полями + паспортами файлов без байтов);
// - по командам сервера `pull` конвейерно вырезает срезы `file.slice(offset, offset + length)`,
//   проверяя неизменность файла на диске (`size` / `lastModified`), и при наличии одноразовой
//   серверной соли `salt` считает детерминированный позиционный `HMAC-SHA-256`;
// - контролирует `bufferedAmount` сокета и считает сглаженную скорость отдачи (`bytesPerSecond`)
//   за вычетом ещё не ушедшего в сеть `ws.bufferedAmount`;
// - при кратковременном обрыве мобильной сети автоматически открывает новый сокет и отправляет
//   `resume` (с бесшовным продолжением при `resume-ok` или чистым перезапуском с байта 0 при `resume-miss`);
// - каждая новая отправка (после отмены, ошибки или успеха) гарантированно открывает свежее
//   `wss://`-соединение и получает новый серверный таймер.
import type { Result, Transport } from '#lib/form/index.js'
import {
  createFileIntegrityChain,
  importUploadSaltKey,
  type FileIntegrityChain,
} from './ws-integrity.js'
import {
  DEFAULT_WS_CHUNK_BYTES,
  FORM_UPLOAD_WS_PATH,
  packBinarySegment,
  type FileUploadProgressEntry,
  type FormUploadProgress,
  type WsClientAbortFileMessage,
  type WsClientInitMessage,
  type WsFileDescriptor,
  type WsSegmentLogEntry,
  type WsServerMessage,
  type WsServerPullMessage,
  type WsUploadPlatform,
} from './ws-protocol.js'

/** Минимальный структурный интерфейс WebSocket (совместим с браузерным `WebSocket` и `ws` в тестах). */
export interface ClientWebSocketLike {
  binaryType: string
  readonly readyState: number
  readonly bufferedAmount: number
  send(data: string | Uint8Array | ArrayBuffer): void
  close(code?: number, reason?: string): void
  addEventListener(type: string, listener: (event: Record<string, unknown>) => void): void
}

export type ClientWebSocketConstructor = new (url: string) => ClientWebSocketLike

export interface WsFormTransportOptions {
  /** Явный адрес WS-эндпоинта (в браузере по умолчанию выводится из `location.origin` + `/api/form-upload`). */
  readonly wsUrl?: string | (() => string)
  /** Подмена конструктора `WebSocket` для Node/Vitest интеграционных тестов. */
  readonly WebSocketImpl?: ClientWebSocketConstructor
  /** Порог `bufferedAmount` (байт) для ожидания опустошения буфера отправки. */
  readonly highWaterMarkBytes?: number
  /** Максимум автоматических попыток восстановления сессии при обрыве связи (по умолчанию `4`). */
  readonly maxAutoResumeAttempts?: number
  /** Базовая задержка первой попытки переподключения в мс (по умолчанию `350`). */
  readonly reconnectBaseDelayMs?: number
}

const WS_OPEN = 1
const WS_CONNECTING = 0
const SPEED_WINDOW_MS = 5_000
const PROGRESS_TICK_MS = 400
const EMA_TAU_SECONDS = 1.2

interface SpeedSample {
  readonly ts: number
  readonly flushedBytes: number
}

/** Есть ли в `FormData` хотя бы один выбранный непустой `File` (`size > 0` или явное имя). */
export function hasUploadableFiles(data: unknown): data is FormData {
  if (!(data instanceof FormData)) return false
  for (const [, value] of data.entries()) {
    if (value instanceof File && (value.size > 0 || value.name.length > 0)) {
      return true
    }
  }
  return false
}

function defaultWsUrl(): string {
  if (typeof location !== 'undefined' && location.origin) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${location.host}${FORM_UPLOAD_WS_PATH}`
  }
  return `ws://localhost:5173${FORM_UPLOAD_WS_PATH}`
}

function waitAbortableMs(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer)
      resolve(false)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve(true)
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function formatRateLabelRu(bytesPerSecond: number): string {
  if (bytesPerSecond <= 0) return ''
  if (bytesPerSecond < 1024 * 1024) {
    return ` · ${(bytesPerSecond / 1024).toFixed(0)} КБ/с`
  }
  return ` · ${(bytesPerSecond / (1024 * 1024)).toFixed(1)} МБ/с`
}

interface SnapshotMeta {
  readonly phase: FormUploadProgress['phase']
  readonly salted: boolean
  readonly bytesPerSecond: number
  readonly elapsedMs: number
  readonly platform: WsUploadPlatform
  readonly maxDurationMs: number | null
  readonly chunkBytes: number
  readonly resumedCount: number
}

function buildSnapshot(
  meta: SnapshotMeta,
  entries: readonly FileUploadProgressEntry[],
): FormUploadProgress {
  let sentBytes = 0
  let totalBytes = 0
  for (const item of entries) {
    sentBytes += item.receivedBytes
    totalBytes += item.size
  }
  const percent =
    totalBytes > 0
      ? Math.min(100, Math.round((sentBytes / totalBytes) * 100))
      : meta.phase === 'done' || meta.phase === 'processing'
        ? 100
        : 0

  const label =
    meta.phase === 'validating'
      ? 'Проверка полей…'
      : meta.phase === 'reconnecting'
        ? 'Восстановление связи…'
        : meta.phase === 'processing'
          ? 'Сохранение файла…'
          : meta.phase === 'uploading'
            ? `Загрузка ${percent}%${formatRateLabelRu(meta.bytesPerSecond)}`
            : undefined

  return {
    status: 'pending',
    scope: 'local',
    ...(label ? { label } : {}),
    progress: { kind: 'bytes', loaded: sentBytes, total: totalBytes },
    kind: 'ws-upload',
    phase: meta.phase,
    sentBytes,
    totalBytes,
    percent,
    bytesPerSecond: meta.bytesPerSecond,
    elapsedMs: meta.elapsedMs,
    platform: meta.platform,
    maxDurationMs: meta.maxDurationMs,
    chunkBytes: meta.chunkBytes,
    resumedCount: meta.resumedCount,
    salted: meta.salted,
    files: entries.map((e) => ({
      ...e,
      bytesPerSecond: meta.bytesPerSecond,
      salted: meta.salted,
      recentSegments: [...e.recentSegments],
    })),
  }
}

function externalFailureResult(
  envelope: Parameters<Transport>[0]['envelope'],
  status: number,
  code: string,
  message: string,
  outcome: 'not-applied' | 'unknown',
): Result {
  return {
    v: 1,
    formId: envelope.formId,
    instance: envelope.instance,
    submissionId: envelope.submissionId,
    revision: envelope.revision,
    values: {},
    ok: false,
    status,
    outcome,
    errors: [
      {
        id: `*:${code}:0`,
        code,
        message,
        origin: 'external',
      },
    ],
    from: 'fetch',
  }
}

/**
 * Построить потоковый `Transport` для форм с файлами поверх `wss://`.
 */
export function wsFormTransport(
  resolveTarget: () => string,
  options: WsFormTransportOptions = {},
): Transport {
  const maxAutoResumeAttempts = options.maxAutoResumeAttempts ?? 4
  const reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? 350

  return async (req) => {
    if (!(req.data instanceof FormData)) {
      return { kind: 'network', code: 'ws.unsupported-body', detail: 'Expected FormData' }
    }
    if (req.signal?.aborted) {
      return { kind: 'abort', reason: 'aborted' }
    }

    const WsCtor: ClientWebSocketConstructor | undefined =
      options.WebSocketImpl ??
      (typeof WebSocket === 'function' ? (WebSocket as unknown as ClientWebSocketConstructor) : undefined)
    if (!WsCtor) {
      return { kind: 'network', code: 'ws.unavailable', detail: 'WebSocket is not available' }
    }

    const fields: [string, string][] = []
    const descriptors: WsFileDescriptor[] = []
    const descriptorsById = new Map<string, WsFileDescriptor>()
    const filesById = new Map<string, File>()
    const progressById = new Map<string, FileUploadProgressEntry>()

    let activeChunkBytes = DEFAULT_WS_CHUNK_BYTES
    let activePlatform: WsUploadPlatform = 'node'
    let activeMaxDurationMs: number | null = null
    let sessionId: string | null = null
    let resumeToken: string | null = null
    let resumedCount = 0

    let sessionClockOriginMs = Date.now()
    let smoothedBps = 0
    let lastSpeedSampleTs = 0
    const speedSamples: SpeedSample[] = []

    const resetProgressEntries = (chunkSize: number): void => {
      activeChunkBytes = chunkSize
      speedSamples.length = 0
      smoothedBps = 0
      lastSpeedSampleTs = 0
      for (const desc of descriptors) {
        const totalSegments = desc.size === 0 ? 0 : Math.ceil(desc.size / chunkSize)
        progressById.set(desc.id, {
          fileId: desc.id,
          field: desc.field,
          name: desc.name,
          size: desc.size,
          state: 'uploading',
          receivedBytes: 0,
          sentSegments: 0,
          totalSegments,
          progress: desc.size === 0 ? 100 : 0,
          recentSegments: [],
        })
      }
    }

    let fileCounter = 0
    for (const [key, value] of req.data.entries()) {
      if (value instanceof File) {
        if (value.name === '' && value.size === 0) continue
        const id = `f${fileCounter++}`
        const desc: WsFileDescriptor = {
          id,
          field: key,
          name: value.name,
          size: value.size,
          type: value.type || 'application/octet-stream',
          lastModified: value.lastModified || 0,
        }
        descriptors.push(desc)
        descriptorsById.set(id, desc)
        filesById.set(id, value)
      } else {
        fields.push([key, value])
      }
    }
    resetProgressEntries(DEFAULT_WS_CHUNK_BYTES)

    let saltedSession = false
    let currentSaltHex: string | null = null
    let saltKeyPromise: Promise<CryptoKey | null> | null = null
    const chainsById = new Map<string, Promise<FileIntegrityChain>>()

    const resetSaltState = (): void => {
      saltedSession = false
      currentSaltHex = null
      saltKeyPromise = null
      chainsById.clear()
    }

    const getChainForFile = (
      saltHex: string,
      desc: WsFileDescriptor,
    ): Promise<FileIntegrityChain | null> => {
      if (currentSaltHex !== saltHex) {
        resetSaltState()
        currentSaltHex = saltHex
      }
      saltedSession = true
      saltKeyPromise ??= importUploadSaltKey(saltHex)
      let existing = chainsById.get(desc.id)
      if (!existing) {
        existing = saltKeyPromise.then(async (k) => {
          if (!k) throw new Error('Invalid upload salt from server')
          return createFileIntegrityChain(k, desc.id, desc.size)
        })
        chainsById.set(desc.id, existing)
      }
      return existing
    }

    const updateSpeedSample = (ws: ClientWebSocketLike | null): number => {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
      let totalQueuedBytes = 0
      for (const item of progressById.values()) {
        totalQueuedBytes += item.receivedBytes
      }
      const buffered = ws && ws.readyState === WS_OPEN ? Math.max(0, ws.bufferedAmount) : 0
      const flushedBytes = Math.max(0, totalQueuedBytes - buffered)

      const prevSampleTs = lastSpeedSampleTs
      lastSpeedSampleTs = now
      speedSamples.push({ ts: now, flushedBytes })
      while (speedSamples.length > 2 && now - speedSamples[1]!.ts > SPEED_WINDOW_MS) {
        speedSamples.shift()
      }
      if (speedSamples.length >= 2) {
        const first = speedSamples[0]!
        const dtSec = (now - first.ts) / 1000
        const dBytes = Math.max(0, flushedBytes - first.flushedBytes)
        if ((dBytes > 0 && dtSec >= 0.002) || dtSec >= 0.25) {
          const effectiveDtSec = Math.max(dtSec, 0.025)
          const windowBps = dBytes / effectiveDtSec
          const dtStepSec = prevSampleTs > 0 ? Math.max(0.01, (now - prevSampleTs) / 1000) : 0
          const alpha =
            smoothedBps > 0 && dtStepSec > 0
              ? Math.min(1, 1 - Math.exp(-dtStepSec / EMA_TAU_SECONDS))
              : 0.35
          smoothedBps =
            smoothedBps > 0 ? smoothedBps * (1 - alpha) + windowBps * alpha : windowBps
        }
      }
      return Math.round(smoothedBps)
    }

    let activePhase: FormUploadProgress['phase'] = 'validating'

    const emitProgress = (
      phase: FormUploadProgress['phase'],
      ws: ClientWebSocketLike | null,
    ): void => {
      activePhase = phase
      const bps = phase === 'uploading' || phase === 'processing' ? updateSpeedSample(ws) : Math.round(smoothedBps)
      const elapsedMs = Math.max(0, Date.now() - sessionClockOriginMs)
      req.report?.(
        buildSnapshot(
          {
            phase,
            salted: saltedSession,
            bytesPerSecond: bps,
            elapsedMs,
            platform: activePlatform,
            maxDurationMs: activeMaxDurationMs,
            chunkBytes: activeChunkBytes,
            resumedCount,
          },
          [...progressById.values()],
        ),
      )
    }

    const endpoint =
      typeof options.wsUrl === 'function'
        ? options.wsUrl()
        : (options.wsUrl ?? defaultWsUrl())

    return new Promise((resolve) => {
      let settled = false
      let allBytesSent = false
      let currentWs: ClientWebSocketLike | null = null
      let reconnectAttempts = 0
      let sendGate = Promise.resolve()

      const progressTimer = setInterval(() => {
        if (settled || !currentWs) return
        if (activePhase === 'uploading' || activePhase === 'processing') {
          emitProgress(activePhase, currentWs)
        }
      }, PROGRESS_TICK_MS)
      ;(progressTimer as unknown as { unref?: () => void }).unref?.()

      const finish = (out: Awaited<ReturnType<Transport>>): void => {
        if (settled) return
        settled = true
        clearInterval(progressTimer)
        req.signal?.removeEventListener('abort', onAbort)
        resolve(out)
      }

      const onAbort = (): void => {
        const ws = currentWs
        currentWs = null
        if (ws) {
          try {
            if (ws.readyState === WS_OPEN) {
              ws.send(JSON.stringify({ type: 'cancel' }))
            }
            if (ws.readyState === WS_OPEN || ws.readyState === WS_CONNECTING) {
              ws.close(1001, 'Aborted')
            }
          } catch {
            // Игнорируем ошибку закрытия уже рвущегося сокета.
          }
        }
        finish({ kind: 'abort', reason: 'aborted' })
      }
      req.signal?.addEventListener('abort', onAbort, { once: true })

      const sendInitOnSocket = (ws: ClientWebSocketLike): void => {
        sessionClockOriginMs = Date.now()
        allBytesSent = false
        resetSaltState()
        resetProgressEntries(activeChunkBytes)
        const initMsg: WsClientInitMessage = {
          type: 'init',
          target: resolveTarget(),
          fields,
          files: descriptors,
        }
        emitProgress('validating', ws)
        ws.send(JSON.stringify(initMsg))
      }

      const handlePullMessage = async (
        ws: ClientWebSocketLike,
        msg: WsServerPullMessage,
      ): Promise<void> => {
        const file = filesById.get(msg.fileId)
        const desc = descriptorsById.get(msg.fileId)
        const current = progressById.get(msg.fileId)
        if (!file || !desc || !current || settled || ws !== currentWs) return

        if (msg.salt) saltedSession = true

        if (
          file.size !== desc.size ||
          (desc.lastModified > 0 && file.lastModified !== desc.lastModified)
        ) {
          if (ws.readyState === WS_OPEN && ws === currentWs) {
            const abortMsg: WsClientAbortFileMessage = {
              type: 'abort-file',
              reqId: msg.reqId,
              fileId: msg.fileId,
              code: 'file.changed',
            }
            ws.send(JSON.stringify(abortMsg))
          }
          return
        }

        const knownLoaded = Math.max(current.receivedBytes, msg.receivedBytes)
        const ackPct =
          msg.totalFileBytes > 0
            ? Math.min(99, Math.round((knownLoaded / msg.totalFileBytes) * 100))
            : 100
        progressById.set(msg.fileId, {
          ...current,
          state: 'uploading',
          receivedBytes: knownLoaded,
          sentSegments: Math.max(current.sentSegments, msg.sentSegments),
          totalSegments: msg.totalSegments,
          progress: ackPct,
          recentSegments: msg.recentSegments,
        })
        emitProgress('uploading', ws)

        try {
          // Срез файла и вычисление позиционного HMAC выполняются параллельно на всём окне конвейера
          const sliceBuf = await file.slice(msg.offset, msg.offset + msg.length).arrayBuffer()
          if (settled || ws !== currentWs || ws.readyState !== WS_OPEN) return

          if (sliceBuf.byteLength !== msg.length || file.size !== desc.size) {
            const abortMsg: WsClientAbortFileMessage = {
              type: 'abort-file',
              reqId: msg.reqId,
              fileId: msg.fileId,
              code: 'file.changed',
            }
            ws.send(JSON.stringify(abortMsg))
            return
          }

          const sliceBytes = new Uint8Array(sliceBuf)
          let hmacTag: Uint8Array | undefined
          if (msg.salt) {
            const chain = await getChainForFile(msg.salt, desc)
            if (chain) {
              hmacTag = await chain.nextSegmentTag(msg.segmentIndex, msg.offset, sliceBytes)
            }
          }
          if (settled || ws !== currentWs || ws.readyState !== WS_OPEN) return

          const frame = packBinarySegment(msg.reqId, sliceBytes, hmacTag)
          const highWaterMark = options.highWaterMarkBytes ?? Math.max(2 * activeChunkBytes, 512 * 1024)

          // Узкие ворота только вокруг самой отправки в сокет + контроля `bufferedAmount`
          await (sendGate = sendGate.then(async () => {
            while (
              ws === currentWs &&
              ws.readyState === WS_OPEN &&
              ws.bufferedAmount > highWaterMark &&
              !settled
            ) {
              const ok = await waitAbortableMs(10, req.signal)
              if (!ok) return
            }
            if (settled || ws !== currentWs || ws.readyState !== WS_OPEN) return
            ws.send(frame)

            const latest = progressById.get(msg.fileId) ?? current
            const newReceived = Math.max(latest.receivedBytes, msg.offset + msg.length)
            const newSentSegments = Math.max(latest.sentSegments, msg.segmentIndex + 1)
            const updatedLog: WsSegmentLogEntry[] = [
              ...latest.recentSegments.slice(-7),
              { segmentIndex: msg.segmentIndex, offset: msg.offset, bytes: msg.length },
            ]
            const fileCompleted = newReceived >= file.size
            progressById.set(msg.fileId, {
              ...latest,
              state: fileCompleted ? 'processing' : 'uploading',
              receivedBytes: Math.min(file.size, newReceived),
              sentSegments: newSentSegments,
              totalSegments: msg.totalSegments,
              progress: fileCompleted
                ? 100
                : Math.min(99, Math.round((newReceived / file.size) * 100)),
              recentSegments: updatedLog,
            })

            const everyDone = [...progressById.values()].every(
              (item) => item.receivedBytes >= item.size,
            )
            if (everyDone) {
              allBytesSent = true
              emitProgress('processing', ws)
            } else {
              emitProgress('uploading', ws)
            }
          }))
        } catch {
          if (ws === currentWs && ws.readyState === WS_OPEN) {
            const abortMsg: WsClientAbortFileMessage = {
              type: 'abort-file',
              reqId: msg.reqId,
              fileId: msg.fileId,
              code: 'file.unreadable',
            }
            ws.send(JSON.stringify(abortMsg))
          }
        }
      }

      const openSocket = (mode: 'init' | 'resume'): void => {
        if (settled || req.signal?.aborted) return
        const ws = new WsCtor(endpoint)
        ws.binaryType = 'arraybuffer'
        currentWs = ws

        ws.addEventListener('open', () => {
          if (settled || ws !== currentWs) return
          if (mode === 'resume' && sessionId && resumeToken) {
            emitProgress('reconnecting', ws)
            ws.send(
              JSON.stringify({
                type: 'resume',
                sessionId,
                resumeToken,
              }),
            )
            return
          }
          sendInitOnSocket(ws)
        })

        ws.addEventListener('message', (ev) => {
          if (settled || ws !== currentWs) return
          const raw = ev.data
          if (typeof raw !== 'string') return
          let msg: WsServerMessage
          try {
            msg = JSON.parse(raw) as WsServerMessage
          } catch {
            return
          }

          if (msg.type === 'ping') {
            if (ws.readyState === WS_OPEN) {
              ws.send(JSON.stringify({ type: 'pong', ts: msg.ts }))
            }
            return
          }

          if (msg.type === 'ready') {
            sessionId = msg.sessionId
            resumeToken = msg.resumeToken
            activeChunkBytes = msg.chunkBytes
            activePlatform = msg.platform
            activeMaxDurationMs = msg.maxDurationMs
            sessionClockOriginMs = Date.now()
            reconnectAttempts = 0
            for (const [id, entry] of progressById) {
              const totalSegments = entry.size === 0 ? 0 : Math.ceil(entry.size / activeChunkBytes)
              progressById.set(id, { ...entry, totalSegments })
            }
            emitProgress('validating', ws)
            return
          }

          if (msg.type === 'resume-ok') {
            resumedCount += 1
            reconnectAttempts = 0
            sessionClockOriginMs = Date.now() - msg.elapsedMs
            speedSamples.length = 0
            emitProgress(allBytesSent ? 'processing' : 'uploading', ws)
            return
          }

          if (msg.type === 'resume-miss') {
            // Холодный инстанс или истёк грейс-период: начинаем чистую загрузку с байта 0 и новым таймером
            resumedCount += 1
            reconnectAttempts = 0
            sessionId = null
            resumeToken = null
            sendInitOnSocket(ws)
            return
          }

          if (msg.type === 'pull') {
            void handlePullMessage(ws, msg)
            return
          }

          if (msg.type === 'result') {
            if (msg.result.ok) {
              for (const [id, entry] of progressById) {
                progressById.set(id, { ...entry, state: 'done', progress: 100 })
              }
              emitProgress('done', ws)
            }
            if (ws.readyState === WS_OPEN) ws.close(1000, 'Complete')
            finish({ kind: 'result', result: msg.result })
            return
          }

          if (msg.type === 'fault') {
            if (ws.readyState === WS_OPEN) ws.close(1002, 'Server fault')
            finish({
              kind: 'result',
              result: externalFailureResult(
                req.envelope,
                msg.status,
                `transport.${msg.status}`,
                msg.message,
                allBytesSent ? 'unknown' : 'not-applied',
              ),
            })
          }
        })

        ws.addEventListener('error', () => {
          // Итоговое решение (`resume` или возврат ошибки) принимает обработчик `close`
        })

        ws.addEventListener('close', (ev) => {
          if (settled || ws !== currentWs) return
          if (req.signal?.aborted) {
            finish({ kind: 'abort', reason: 'aborted' })
            return
          }

          const code = typeof ev.code === 'number' ? ev.code : 1006
          const canAutoResume =
            descriptors.length > 0 &&
            sessionId !== null &&
            resumeToken !== null &&
            code !== 1000 &&
            code !== 1001 &&
            code !== 1002 &&
            code !== 1008 &&
            reconnectAttempts < maxAutoResumeAttempts

          if (canAutoResume) {
            reconnectAttempts += 1
            emitProgress('reconnecting', null)
            const delay = reconnectBaseDelayMs * Math.pow(2, reconnectAttempts - 1)
            void waitAbortableMs(delay, req.signal).then((stillActive) => {
              if (!stillActive || settled) return
              openSocket('resume')
            })
            return
          }

          const reason = typeof ev.reason === 'string' && ev.reason ? ` (${ev.reason})` : ''
          finish({
            kind: 'result',
            result: externalFailureResult(
              req.envelope,
              502,
              'ws.disconnected',
              `Соединение загрузки прервалось до ответа сервера${reason}`,
              allBytesSent ? 'unknown' : 'not-applied',
            ),
          })
        })
      }

      openSocket('init')
    })
  }
}
