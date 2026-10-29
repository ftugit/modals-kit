// Серверная сессия приёма формы с файлами по закреплённому `wss://`-соединению.
//
// Инварианты:
// - `src/lib/form` не модифицируется: Кадр 0 (`init`) собирается в лёгкий `URLSearchParams`-запрос,
//   а в `order` сразу после `bodyLayer` и перед `namesLayer` подключается `wsFilesLayer`,
//   подставляющий потоковые `StreamFile extends File` в `ctx.form`;
// - ранний ACL-гейт `authorize` и синхронные правила (`required`, `v.accept`, `v.maxSize`, `namesLayer`)
//   выполняются при `0` прочитанных файловых байтов (даже до `imageCheck`);
// - конвейер сегментов (`windowSize = 4`): сегмент `0` запрашивается одиночно для проверки магических байт
//   (`verifyFirstSegmentSignature`) и `headCache`, после чего сегменты `1..N` подтягиваются скользящим окном
//   и отдаются в `storage.put` строго по порядку без потери потоковой склейки и `AES-256-GCM`;
// - скользящий таймаут неактивности (`90 с`) и серверный `ping` (`25 с`) заменяют фиксированную 5-минутную отсечку;
// - мобильная авто-дозагрузка (`resume`): при аномальном обрыве сети (`code !== 1000 && code !== 1001`)
//   сессия паркуется на `resumeGraceMs` (`60 с`); при возврате клиента на тот же инстанс сервер перепривязывает
//   сокет (`resume-ok`) и переотправляет неподтверждённые `pull`, а при явной отмене (`cancel` / `1001`)
//   немедленно прерывает поток и удаляет `.part` / `AbortMultipartUpload`.
import type { RequestEvent } from '@sveltejs/kit'
import type { LazyContent } from '@remix-run/lazy-file'
import { mergeChecks } from '#lib/form/index.js'
import {
  bodyLayer,
  createFormHandler,
  DEFAULT_LIMITS,
  methodLayer,
  namesLayer,
  reject,
  type Layer,
  type Limits,
} from '#lib/form/server.js'
import { StreamFile } from '#lib/storage/index.js'
import { originGuard } from '#server/form-security.server.js'
import type { ServerWsSocket } from '#server/ws-upgrade.server.js'
import { createAuthorizeGuards } from './authorize.server.js'
import { componentFormRegistry } from './registry.js'
import { ensureComponentFormsLoaded } from './server.server.js'
import {
  createFileIntegrityChain,
  generateUploadSaltHex,
  importUploadSaltKey,
  timingSafeHexEqual,
  timingSafeTagEqual,
  type FileIntegrityChain,
} from './ws-integrity.js'
import { verifyFirstSegmentSignature } from './ws-magic.js'
import {
  clampWsChunkBytes,
  DEFAULT_WS_WINDOW_SIZE,
  unpackBinarySegment,
  type WsClientAbortFileMessage,
  type WsClientInitMessage,
  type WsClientResumeMessage,
  type WsFileDescriptor,
  type WsSegmentLogEntry,
  type WsServerMessage,
  type WsServerPullMessage,
  type WsUploadPlatform,
} from './ws-protocol.js'

/** Скользящий таймаут простоя сокета без входящих кадров/байтов по умолчанию (`90 секунд`). */
export const WS_IDLE_TIMEOUT_MS = 90_000

/** Интервал серверного heartbeat `ping` для удержания прокси/NAT по умолчанию (`25 секунд`). */
export const WS_HEARTBEAT_MS = 25_000

/** Время парковки сессии в памяти инстанса при аномальном обрыве мобильной сети (`60 секунд`). */
export const WS_RESUME_GRACE_MS = 60_000

/** Страховочный потолок для `createFormHandler` на платформах без лимита длительности (`24 часа`). */
const UNBOUNDED_HANDLER_TIMEOUT_MS = 24 * 60 * 60 * 1000

/** Дефолтный потолок длительности функции на Vercel Fluid Compute (`300 секунд`). */
const DEFAULT_VERCEL_MAX_DURATION_MS = 300_000

/** Безопасный потолок суммарного объёма потоковых файлов формы по умолчанию (`256 МБ`, если сама форма не задала `limits.maxBytes`). */
export const WS_FORM_MAX_BYTES = 256 * 1024 * 1024

/** Верхний предел числа файловых дескрипторов в Кадре 0 (`init.files`). */
export const MAX_WS_FILES_COUNT = DEFAULT_LIMITS.maxValuesPerKey

/** Верхний предел текстового JSON Кадра 0 (`256 КБ`). */
const MAX_INIT_TEXT_BYTES = 256 * 1024

/** Сколько последних подтверждённых сегментов прикладывать в лог кадра `pull`. */
const RECENT_SEGMENTS_LIMIT = 8

export interface WsFormSessionOptions {
  readonly chunkBytes?: number
  readonly windowSize?: number
  readonly idleTimeoutMs?: number
  readonly heartbeatMs?: number
  readonly resumeGraceMs?: number
  readonly platform?: WsUploadPlatform
  readonly maxDurationMs?: number | null
  readonly maxBytes?: number
  /** Устаревший синоним `idleTimeoutMs` для совместимости с тестами. */
  readonly timeoutMs?: number
}

/** Доменная ошибка приёма конкретного файлового поля (переводится в штатный `422 Result` на поле). */
class WsUploadFieldError extends Error {
  readonly field: string
  readonly code: string
  readonly userMessage: string

  constructor(field: string, code: string, userMessage: string) {
    super(`[${code}] ${field}: ${userMessage}`)
    this.name = 'WsUploadFieldError'
    this.field = field
    this.code = code
    this.userMessage = userMessage
  }
}

interface PendingSegmentRequest {
  readonly reqId: number
  readonly fileId: string
  readonly field: string
  readonly segmentIndex: number
  readonly offset: number
  readonly expectedLength: number
  readonly chain?: FileIntegrityChain
  readonly pullMessage: WsServerPullMessage
  readonly resolve: (bytes: Uint8Array<ArrayBuffer>) => void
  readonly reject: (reason: Error) => void
}

interface ActiveUploadSession {
  readonly sessionId: string
  readonly resumeToken: string
  readonly startedAt: number
  rebindSocket(newSocket: ServerWsSocket): Promise<void>
}

const PARKED_SESSIONS_SYMBOL = Symbol.for('modals-kit/ws-upload-parked-sessions')
const globalSessionsStore = globalThis as unknown as Record<
  symbol,
  Map<string, ActiveUploadSession> | undefined
>
const activeUploadSessions = (globalSessionsStore[PARKED_SESSIONS_SYMBOL] ??= new Map<
  string,
  ActiveUploadSession
>())

function safeSendJson(socket: ServerWsSocket | null, msg: WsServerMessage): void {
  if (!socket) return
  try {
    socket.sendText(JSON.stringify(msg))
  } catch {
    // Сокет мог закрыться между проверкой и записью — обработает `onClose`.
  }
}

function resolvePlatformMetadata(
  targetUrl: URL,
  options: WsFormSessionOptions,
): { platform: WsUploadPlatform; maxDurationMs: number | null } {
  const basePlatform: WsUploadPlatform = options.platform ?? 'node'
  const baseMaxDurationMs =
    options.maxDurationMs !== undefined
      ? options.maxDurationMs
      : basePlatform === 'vercel'
        ? DEFAULT_VERCEL_MAX_DURATION_MS
        : null

  // На стенде `/upload-demo` разрешаем симулировать лимиты разных платформ через `DemoPanel`
  if (targetUrl.pathname.endsWith('/upload-demo')) {
    const sim = targetUrl.searchParams.get('platform_limit')
    if (sim === 'vercel_300') return { platform: 'vercel', maxDurationMs: 300_000 }
    if (sim === 'vercel_800') return { platform: 'vercel', maxDurationMs: 800_000 }
    if (sim === 'cloudflare') return { platform: 'cloudflare', maxDurationMs: null }
    if (sim === 'node') return { platform: 'node', maxDurationMs: null }
    if (sim === 'demo_20') return { platform: 'vercel', maxDurationMs: 20_000 }
  }

  return { platform: basePlatform, maxDurationMs: baseMaxDurationMs }
}

function isValidDescriptor(raw: unknown): raw is WsFileDescriptor {
  if (!raw || typeof raw !== 'object') return false
  const d = raw as Record<string, unknown>
  return (
    typeof d.id === 'string' &&
    d.id.length > 0 &&
    typeof d.field === 'string' &&
    d.field.length > 0 &&
    typeof d.name === 'string' &&
    typeof d.size === 'number' &&
    Number.isInteger(d.size) &&
    d.size >= 0 &&
    typeof d.type === 'string' &&
    typeof d.lastModified === 'number' &&
    Number.isFinite(d.lastModified)
  )
}

function parseInitFrame(rawText: string): WsClientInitMessage | null {
  if (new TextEncoder().encode(rawText).byteLength > MAX_INIT_TEXT_BYTES) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>
  if (obj.type !== 'init' || typeof obj.target !== 'string') return null
  if (!Array.isArray(obj.fields) || !Array.isArray(obj.files)) return null
  if (obj.files.length > MAX_WS_FILES_COUNT) return null

  const fields: [string, string][] = []
  for (const pair of obj.fields) {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      typeof pair[0] !== 'string' ||
      typeof pair[1] !== 'string'
    ) {
      return null
    }
    fields.push([pair[0], pair[1]])
  }

  const seenIds = new Set<string>()
  const files: WsFileDescriptor[] = []
  for (const item of obj.files) {
    if (!isValidDescriptor(item)) return null
    if (seenIds.has(item.id)) return null
    seenIds.add(item.id)
    files.push(item)
  }

  return { type: 'init', target: obj.target, fields, files }
}

function parseControlTextFrame(
  rawText: string,
): WsClientAbortFileMessage | WsClientResumeMessage | { type: 'pong' } | { type: 'cancel' } | null {
  if (rawText.length > 4096) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>
  if (obj.type === 'pong') return { type: 'pong' }
  if (obj.type === 'cancel') return { type: 'cancel' }
  if (
    obj.type === 'resume' &&
    typeof obj.sessionId === 'string' &&
    obj.sessionId.length > 0 &&
    typeof obj.resumeToken === 'string' &&
    obj.resumeToken.length > 0
  ) {
    return {
      type: 'resume',
      sessionId: obj.sessionId,
      resumeToken: obj.resumeToken,
    }
  }
  if (
    obj.type === 'abort-file' &&
    typeof obj.reqId === 'number' &&
    typeof obj.fileId === 'string' &&
    (obj.code === 'file.changed' || obj.code === 'file.unreadable')
  ) {
    return {
      type: 'abort-file',
      reqId: obj.reqId,
      fileId: obj.fileId,
      code: obj.code,
    }
  }
  return null
}

/**
 * Потоковый `LazyContent` одного файла поверх WebSocket pull-протокола со скользящим конвейерным окном.
 * Сегмент `0` подтягивается одиночно для проверки магических байт и `headCache` (`imageCheck`),
 * а сегменты `1..N` запрашиваются конвейерно (`windowSize`) и выдаются потребителю строго по порядку.
 */
function createWsLazyContent(
  desc: WsFileDescriptor,
  chunkBytes: number,
  windowSize: number,
  chain: FileIntegrityChain | undefined,
  enforceMagicSignature: boolean,
  onFieldUploadError: (err: WsUploadFieldError) => void,
  pullSegment: (
    desc: WsFileDescriptor,
    chain: FileIntegrityChain | undefined,
    segmentIndex: number,
    totalSegments: number,
    sentSegments: number,
    receivedBytes: number,
    offset: number,
    length: number,
    recentSegments: readonly WsSegmentLogEntry[],
  ) => Promise<Uint8Array<ArrayBuffer>>,
  signal: AbortSignal,
): LazyContent {
  const totalSegments = desc.size === 0 ? 0 : Math.ceil(desc.size / chunkBytes)
  let ackedSegments = 0
  let ackedBytes = 0
  let recentSegments: WsSegmentLogEntry[] = []
  let headCache: Uint8Array<ArrayBuffer> | null = null

  const recordSegment = (segmentIndex: number, offset: number, bytes: number): void => {
    ackedSegments += 1
    ackedBytes += bytes
    recentSegments = [
      ...recentSegments.slice(-(RECENT_SEGMENTS_LIMIT - 1)),
      { segmentIndex, offset, bytes },
    ]
  }

  return {
    byteLength: desc.size,
    stream(start = 0, end = desc.size): ReadableStream<Uint8Array<ArrayBuffer>> {
      const boundedStart = Math.max(0, Math.min(start, desc.size))
      const boundedEnd = Math.max(boundedStart, Math.min(end, desc.size))
      const firstSeg = boundedEnd > boundedStart ? Math.floor(boundedStart / chunkBytes) : 0
      const lastSegExclusive = boundedEnd > boundedStart ? Math.ceil(boundedEnd / chunkBytes) : 0
      const isHeadProbe = boundedStart === 0 && boundedEnd <= chunkBytes && boundedEnd < desc.size
      const maxPipelineWindow =
        isHeadProbe || lastSegExclusive - firstSeg <= 1 ? 1 : Math.max(1, windowSize)

      let nextToRequest = firstSeg
      let nextToEmit = firstSeg
      let firstSegVerified = firstSeg > 0 || headCache !== null
      const inFlight = new Map<number, Promise<Uint8Array<ArrayBuffer>>>()

      const fetchSingleSegment = async (segIndex: number): Promise<Uint8Array<ArrayBuffer>> => {
        if (segIndex === 0 && headCache !== null && headCache.byteLength > 0) {
          const cached = headCache
          if (!isHeadProbe) {
            headCache = null
          }
          return cached
        }

        const segOffset = segIndex * chunkBytes
        const segLength = Math.min(chunkBytes, desc.size - segOffset)
        const bytes = await pullSegment(
          desc,
          chain,
          segIndex,
          totalSegments,
          ackedSegments,
          ackedBytes,
          segOffset,
          segLength,
          recentSegments,
        )

        if (enforceMagicSignature && segIndex === 0 && bytes.byteLength > 0) {
          const sigErr = verifyFirstSegmentSignature(desc.type, desc.name, bytes)
          if (sigErr) {
            const err = new WsUploadFieldError(desc.field, 'file.type-mismatch', sigErr)
            onFieldUploadError(err)
            throw err
          }
        }

        if (isHeadProbe && segIndex === 0) {
          const cachedCopy = new Uint8Array(new ArrayBuffer(bytes.byteLength))
          cachedCopy.set(bytes)
          headCache = cachedCopy
        }

        recordSegment(segIndex, segOffset, bytes.byteLength)
        return bytes
      }

      const fillPipelineWindow = (): void => {
        const allowedInFlight = firstSegVerified ? maxPipelineWindow : 1
        while (
          !signal.aborted &&
          inFlight.size < allowedInFlight &&
          nextToRequest < lastSegExclusive
        ) {
          const segIdx = nextToRequest++
          const p = fetchSingleSegment(segIdx)
          // Гасим необработанный rejection у предвыбранных промисов, если ранний сегмент оборвал поток
          p.catch(() => {})
          inFlight.set(segIdx, p)
        }
      }

      return new ReadableStream<Uint8Array<ArrayBuffer>>({
        async pull(controller) {
          if (signal.aborted) {
            controller.error(
              signal.reason instanceof Error
                ? signal.reason
                : new Error('WebSocket upload aborted'),
            )
            return
          }
          if (nextToEmit >= lastSegExclusive) {
            controller.close()
            return
          }

          fillPipelineWindow()
          const currentSeg = nextToEmit
          const pendingSeg = inFlight.get(currentSeg)
          if (!pendingSeg) {
            controller.close()
            return
          }

          try {
            const segBytes = await pendingSeg
            inFlight.delete(currentSeg)
            if (currentSeg === 0) {
              firstSegVerified = true
              // Как только сегмент 0 прошёл проверку сигнатуры — сразу открываем полное окно конвейера
              fillPipelineWindow()
            }

            const segStart = currentSeg * chunkBytes
            const sliceFrom = Math.max(0, boundedStart - segStart)
            const sliceTo = Math.min(segBytes.byteLength, boundedEnd - segStart)
            nextToEmit += 1

            if (sliceTo > sliceFrom) {
              if (sliceFrom === 0 && sliceTo === segBytes.byteLength) {
                controller.enqueue(segBytes)
              } else {
                const sub = new Uint8Array(new ArrayBuffer(sliceTo - sliceFrom))
                sub.set(segBytes.subarray(sliceFrom, sliceTo))
                controller.enqueue(sub)
              }
            }

            if (nextToEmit >= lastSegExclusive) {
              controller.close()
            }
          } catch (cause) {
            inFlight.clear()
            controller.error(cause instanceof Error ? cause : new Error(String(cause)))
          }
        },
        cancel() {
          inFlight.clear()
        },
      })
    },
  }
}

/**
 * Обработать одну потоковую отправку формы (или `resume` существующей сессии) по открытому `ServerWsSocket`.
 */
export async function handleFormUploadWs(
  initialSocket: ServerWsSocket,
  event: RequestEvent,
  options: WsFormSessionOptions = {},
): Promise<void> {
  const chunkBytes = clampWsChunkBytes(options.chunkBytes)
  const windowSize = Math.max(1, Math.min(16, Math.round(options.windowSize ?? DEFAULT_WS_WINDOW_SIZE)))
  const idleTimeoutMs = Math.max(1_000, options.idleTimeoutMs ?? options.timeoutMs ?? WS_IDLE_TIMEOUT_MS)
  const heartbeatMs = Math.max(1_000, options.heartbeatMs ?? WS_HEARTBEAT_MS)
  const resumeGraceMs = Math.max(0, options.resumeGraceMs ?? WS_RESUME_GRACE_MS)
  const maxBytes = options.maxBytes ?? WS_FORM_MAX_BYTES

  const abortController = new AbortController()
  const pendingPulls = new Map<number, PendingSegmentRequest>()
  const fieldUploadErrors = new Map<string, WsUploadFieldError>()
  let activeSocket: ServerWsSocket | null = initialSocket
  let nextReqId = 1
  let initHandled = false
  let reboundToExisting = false
  let sessionFinished = false
  let cancelledByClient = false
  let sessionSaltHex: string | undefined

  const sessionId = generateUploadSaltHex().slice(0, 32)
  const resumeToken = generateUploadSaltHex()
  let sessionStartedAt = Date.now()

  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let graceTimer: ReturnType<typeof setTimeout> | null = null
  let resolveRootSession: (() => void) | null = null

  const clearTimers = (): void => {
    if (idleTimer !== null) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
    if (graceTimer !== null) {
      clearTimeout(graceTimer)
      graceTimer = null
    }
  }

  const failPendingField = (pending: PendingSegmentRequest, err: WsUploadFieldError): void => {
    fieldUploadErrors.set(pending.field, err)
    pending.reject(err)
  }

  const abortAllPending = (reason: Error): void => {
    sessionFinished = true
    activeUploadSessions.delete(sessionId)
    clearTimers()
    if (!abortController.signal.aborted) {
      abortController.abort(reason)
    }
    for (const [, pending] of pendingPulls) {
      pending.reject(reason)
    }
    pendingPulls.clear()
    resolveRootSession?.()
  }

  const touchActivity = (): void => {
    if (sessionFinished || !activeSocket) return
    if (idleTimer !== null) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      if (sessionFinished) return
      const target = activeSocket
      abortAllPending(new Error('Upload inactivity timeout'))
      if (target) {
        safeSendJson(target, {
          type: 'fault',
          status: 408,
          message: 'Превышен интервал ожидания данных загрузки',
        })
        target.close(1008, 'Idle timeout')
      }
    }, idleTimeoutMs)
  }

  const startHeartbeat = (): void => {
    if (heartbeatTimer !== null) clearInterval(heartbeatTimer)
    heartbeatTimer = setInterval(() => {
      if (sessionFinished || !activeSocket) return
      safeSendJson(activeSocket, { type: 'ping', ts: Date.now() })
    }, heartbeatMs)
  }

  // Последовательная очередь разбора входящих бинарных сегментов на сокете сессии
  let binaryQueue = Promise.resolve()

  const handleBinaryFrame = (sock: ServerWsSocket, frame: Uint8Array): void => {
    if (sock !== activeSocket || sessionFinished) return
    touchActivity()
    binaryQueue = binaryQueue.then(async () => {
      if (sessionFinished) return
      const headerProbe = unpackBinarySegment(frame, false)
      if (!headerProbe) {
        safeSendJson(sock, { type: 'fault', status: 400, message: 'Malformed binary segment header' })
        sock.close(1002, 'Malformed binary frame')
        abortAllPending(new Error('Malformed binary segment header'))
        return
      }
      const pending = pendingPulls.get(headerProbe.reqId)
      if (!pending) {
        // При переподключении дубликат уже принятого `reqId` безопасно игнорируем, если `init` уже прошёл
        if (initHandled && headerProbe.reqId < nextReqId) {
          return
        }
        safeSendJson(sock, { type: 'fault', status: 400, message: 'Unexpected segment reqId' })
        sock.close(1002, 'Unexpected reqId')
        abortAllPending(new Error('Unexpected segment reqId'))
        return
      }
      pendingPulls.delete(headerProbe.reqId)

      const expectHmac = Boolean(pending.chain)
      const parsed = unpackBinarySegment(frame, expectHmac)
      if (!parsed) {
        failPendingField(
          pending,
          new WsUploadFieldError(
            pending.field,
            'file.integrity',
            'Отсутствует подпись целостности сегмента файла',
          ),
        )
        return
      }

      if (parsed.payload.byteLength !== pending.expectedLength) {
        failPendingField(
          pending,
          new WsUploadFieldError(
            pending.field,
            'file.size-mismatch',
            `Размер сегмента не совпал с ожидаемым (${parsed.payload.byteLength} Б вместо ${pending.expectedLength} Б) — выберите файл заново`,
          ),
        )
        return
      }

      if (pending.chain) {
        const expectedTag = await pending.chain.nextSegmentTag(
          pending.segmentIndex,
          pending.offset,
          parsed.payload,
        )
        if (!parsed.hmacTag || !timingSafeTagEqual(parsed.hmacTag, expectedTag)) {
          failPendingField(
            pending,
            new WsUploadFieldError(
              pending.field,
              'file.integrity',
              'Контрольная подпись потока не совпала — целостность файла нарушена',
            ),
          )
          return
        }
      }

      const copy = new Uint8Array(new ArrayBuffer(parsed.payload.byteLength))
      copy.set(parsed.payload)
      pending.resolve(copy)
    })
  }

  const handleSocketDisconnect = (sock: ServerWsSocket, code: number, reason: string): void => {
    if (sock !== activeSocket || sessionFinished) return
    activeSocket = null
    if (idleTimer !== null) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }

    // Нормальное закрытие (`1000`), явный уход/отмена клиента (`1001` / `cancel`) или отсутствие `init` —
    // немедленно убираем потоки и временные `.part` без ожидания грейс-периода.
    if (
      !initHandled ||
      cancelledByClient ||
      code === 1000 ||
      code === 1001 ||
      resumeGraceMs <= 0 ||
      !activeUploadSessions.has(sessionId)
    ) {
      abortAllPending(new Error(`WebSocket closed (${code}${reason ? `: ${reason}` : ''})`))
      return
    }

    // Аномальный сетевой обрыв (например `1006` при переключении Wi-Fi ↔ LTE):
    // паркуем сессию на `resumeGraceMs`, удерживая открытый `storage.put` в паузе с 0% CPU.
    if (graceTimer !== null) clearTimeout(graceTimer)
    graceTimer = setTimeout(() => {
      graceTimer = null
      if (!activeSocket && !sessionFinished) {
        abortAllPending(new Error('Upload resume grace window expired'))
      }
    }, resumeGraceMs)
  }

  const bindActiveSocketListeners = (
    sock: ServerWsSocket,
    onReboundSocketClosed?: () => void,
  ): void => {
    sock.onBinary((frame) => handleBinaryFrame(sock, frame))
    sock.onClose((code, reason) => {
      onReboundSocketClosed?.()
      handleSocketDisconnect(sock, code, reason)
    })
    sock.onProblem((cause) => {
      if (sock !== activeSocket || sessionFinished) return
      // Ошибка транспорта на сокете — переводим в ожидание `onClose` / парковку, если не отменено явно
      if (!initHandled || cancelledByClient) {
        abortAllPending(cause instanceof Error ? cause : new Error(String(cause)))
      }
    })
  }

  const attachControlFrameHandler = (sock: ServerWsSocket): void => {
    sock.onText((rawText) => {
      if (reboundToExisting) return
      if (sock !== activeSocket && initHandled) return
      touchActivity()

      const ctrl = parseControlTextFrame(rawText)
      if (ctrl?.type === 'pong') {
        return
      }
      if (ctrl?.type === 'cancel') {
        cancelledByClient = true
        sock.close(1001, 'Cancelled by client')
        abortAllPending(new Error('Upload cancelled by client'))
        return
      }
      if (!initHandled && ctrl?.type === 'resume') {
        const parked = activeUploadSessions.get(ctrl.sessionId)
        if (parked && timingSafeHexEqual(ctrl.resumeToken, parked.resumeToken)) {
          reboundToExisting = true
          activeSocket = null
          clearTimers()
          void parked.rebindSocket(sock).finally(() => {
            resolveRootSession?.()
          })
          return
        }
        // Сессия не найдена на этом инстансе (холодный инстанс Vercel или истёк грейс-период):
        // сообщаем клиенту `resume-miss` и оставляем сокет открытым для нового `init` с байта 0!
        safeSendJson(sock, { type: 'resume-miss' })
        return
      }

      if (initHandled) {
        if (ctrl?.type === 'abort-file') {
          const pending = pendingPulls.get(ctrl.reqId)
          if (pending && pending.fileId === ctrl.fileId) {
            pendingPulls.delete(ctrl.reqId)
            const userText =
              ctrl.code === 'file.changed'
                ? 'Файл изменился на устройстве во время загрузки — выберите его заново'
                : 'Не удалось прочитать выбранный файл с устройства'
            failPendingField(
              pending,
              new WsUploadFieldError(pending.field, ctrl.code, userText),
            )
          }
          return
        }
        safeSendJson(sock, { type: 'fault', status: 400, message: 'Duplicate init frame' })
        sock.close(1002, 'Duplicate init')
        abortAllPending(new Error('Duplicate init frame'))
        return
      }

      initHandled = true
      sessionStartedAt = Date.now()
      startSessionFromInit(sock, rawText)
    })
  }

  const sessionHandle: ActiveUploadSession = {
    sessionId,
    resumeToken,
    get startedAt() {
      return sessionStartedAt
    },
    rebindSocket(newSocket: ServerWsSocket): Promise<void> {
      return new Promise<void>((resolveRebound) => {
        if (sessionFinished) {
          safeSendJson(newSocket, { type: 'resume-miss' })
          newSocket.close(1000, 'Session already finished')
          resolveRebound()
          return
        }
        if (graceTimer !== null) {
          clearTimeout(graceTimer)
          graceTimer = null
        }
        const prevSocket = activeSocket
        activeSocket = newSocket
        if (prevSocket && prevSocket !== newSocket) {
          try {
            prevSocket.close(1001, 'Superseded by resumed socket')
          } catch {
            // Игнорируем ошибку закрытия полуоткрытого старого сокета.
          }
        }

        let reboundClosed = false
        const finishRebound = (): void => {
          if (reboundClosed) return
          reboundClosed = true
          resolveRebound()
        }

        bindActiveSocketListeners(newSocket, finishRebound)
        newSocket.onText((rawText) => {
          if (newSocket !== activeSocket || sessionFinished) return
          touchActivity()
          const ctrl = parseControlTextFrame(rawText)
          if (ctrl?.type === 'pong') return
          if (ctrl?.type === 'cancel') {
            cancelledByClient = true
            newSocket.close(1001, 'Cancelled by client')
            abortAllPending(new Error('Upload cancelled by client'))
            finishRebound()
            return
          }
          if (ctrl?.type === 'abort-file') {
            const pending = pendingPulls.get(ctrl.reqId)
            if (pending && pending.fileId === ctrl.fileId) {
              pendingPulls.delete(ctrl.reqId)
              const userText =
                ctrl.code === 'file.changed'
                  ? 'Файл изменился на устройстве во время загрузки — выберите его заново'
                  : 'Не удалось прочитать выбранный файл с устройства'
              failPendingField(
                pending,
                new WsUploadFieldError(pending.field, ctrl.code, userText),
              )
            }
          }
        })

        touchActivity()
        startHeartbeat()

        safeSendJson(newSocket, {
          type: 'resume-ok',
          sessionId,
          elapsedMs: Math.max(0, Date.now() - sessionStartedAt),
        })

        // Переотправляем все незавершённые `pull`-запросы в строгом порядке возрастания `reqId`
        const orderedPending = [...pendingPulls.values()].sort((a, b) => a.reqId - b.reqId)
        for (const pending of orderedPending) {
          safeSendJson(newSocket, pending.pullMessage)
        }
      })
    },
  }

  const pullSegment = (
    desc: WsFileDescriptor,
    chain: FileIntegrityChain | undefined,
    segmentIndex: number,
    totalSegments: number,
    sentSegments: number,
    receivedBytes: number,
    offset: number,
    length: number,
    recentSegments: readonly WsSegmentLogEntry[],
  ): Promise<Uint8Array<ArrayBuffer>> => {
    if (abortController.signal.aborted) {
      return Promise.reject(
        abortController.signal.reason instanceof Error
          ? abortController.signal.reason
          : new Error('WebSocket session closed'),
      )
    }
    const reqId = nextReqId++
    const pullMessage: WsServerPullMessage = {
      type: 'pull',
      reqId,
      fileId: desc.id,
      field: desc.field,
      segmentIndex,
      totalSegments,
      sentSegments,
      receivedBytes,
      totalFileBytes: desc.size,
      offset,
      length,
      recentSegments,
      ...(sessionSaltHex ? { salt: sessionSaltHex } : {}),
    }
    return new Promise<Uint8Array<ArrayBuffer>>((resolve, rejectPromise) => {
      pendingPulls.set(reqId, {
        reqId,
        fileId: desc.id,
        field: desc.field,
        segmentIndex,
        offset,
        expectedLength: length,
        chain,
        pullMessage,
        resolve,
        reject: rejectPromise,
      })
      safeSendJson(activeSocket, pullMessage)
    })
  }

  function startSessionFromInit(sock: ServerWsSocket, rawText: string): void {
    void (async () => {
      try {
        const init = parseInitFrame(rawText)
        if (!init) {
          safeSendJson(sock, { type: 'fault', status: 400, message: 'Invalid init frame' })
          sock.close(1002, 'Invalid init')
          abortAllPending(new Error('Invalid init frame'))
          return
        }

        await ensureComponentFormsLoaded()
        const registry = componentFormRegistry()

        const textForm = new FormData()
        for (const [k, v] of init.fields) textForm.append(k, v)

        let matchedId: string | undefined
        let matchedInstance: string | undefined
        for (const [id, reg] of registry) {
          const desc =
            typeof reg.description === 'function' ? reg.description(event) : reg.description
          if (textForm.get(desc.policy.envelopeKeys.id) === id) {
            matchedId = id
            const instVal = textForm.get(desc.policy.envelopeKeys.instance)
            matchedInstance = typeof instVal === 'string' && instVal ? instVal : undefined
            break
          }
        }

        if (!matchedId) {
          safeSendJson(sock, { type: 'fault', status: 404, message: 'Unknown component form' })
          sock.close(1008, 'Unknown form')
          abortAllPending(new Error('Unknown component form'))
          return
        }

        const reg = registry.get(matchedId)!
        const description =
          typeof reg.description === 'function' ? reg.description(event) : reg.description

        const targetUrl = new URL(init.target || '/', event.url)
        const { platform, maxDurationMs } = resolvePlatformMetadata(targetUrl, options)

        if (init.files.length > 0 && resumeGraceMs > 0) {
          activeUploadSessions.set(sessionId, sessionHandle)
        }
        if (init.files.length > 0) {
          safeSendJson(activeSocket, {
            type: 'ready',
            sessionId,
            resumeToken,
            chunkBytes,
            windowSize,
            platform,
            maxDurationMs,
          })
        }

        const params = new URLSearchParams()
        for (const [k, v] of init.fields) params.append(k, v)

        const synthHeaders = new Headers()
        for (const headerName of ['origin', 'referer', 'cookie', 'user-agent', 'accept-language']) {
          const val = event.request.headers.get(headerName)
          if (val) synthHeaders.set(headerName, val)
        }
        synthHeaders.set('content-type', 'application/x-www-form-urlencoded;charset=UTF-8')

        const synthRequest = new Request(targetUrl.href, {
          method: 'POST',
          headers: synthHeaders,
          body: params.toString(),
        })

        const routeEvent: RequestEvent = {
          ...event,
          request: synthRequest,
          url: targetUrl,
        }

        const rawChecks = typeof reg.checks === 'function' ? await reg.checks(routeEvent) : reg.checks
        const checks = mergeChecks(description.checks, rawChecks)

        const useIntegrity =
          typeof reg.integrity === 'function'
            ? await reg.integrity(routeEvent, textForm)
            : Boolean(reg.integrity)

        let saltKey: CryptoKey | null = null
        if (useIntegrity && init.files.length > 0) {
          sessionSaltHex = generateUploadSaltHex()
          saltKey = await importUploadSaltKey(sessionSaltHex)
        }

        const streamFiles: Array<{ field: string; file: StreamFile }> = []
        for (const desc of init.files) {
          const chain = saltKey
            ? await createFileIntegrityChain(saltKey, desc.id, desc.size)
            : undefined
          const fieldDef = description.byName[desc.field]
          const hasDedicatedImageCheck = Boolean(
            checks &&
              fieldDef?.validators.some((ref) => {
                try {
                  return description.registry.validators
                    .resolve(ref)
                    .describe?.()
                    .some((c) => c.kind === 'custom' && (c as { name?: string }).name === 'image')
                } catch {
                  return false
                }
              }),
          )
          streamFiles.push({
            field: desc.field,
            file: new StreamFile(
              createWsLazyContent(
                desc,
                chunkBytes,
                windowSize,
                chain,
                !hasDedicatedImageCheck,
                (err) => fieldUploadErrors.set(err.field, err),
                pullSegment,
                abortController.signal,
              ),
              desc.name,
              { type: desc.type, lastModified: desc.lastModified },
            ),
          })
        }

        const totalDeclaredBytes = init.files.reduce((acc, f) => acc + f.size, 0)
        let capturedForm: FormData | undefined
        const wsFilesLayer: Layer = (ctx) => {
          if (!ctx.form) return undefined
          if (totalDeclaredBytes > ctx.limits.budget) {
            return reject(413, 'body.too-large')
          }
          for (const entry of streamFiles) {
            ctx.form.append(entry.field, entry.file)
          }
          capturedForm = ctx.form
          const keys = [...new Set(ctx.form.keys())]
          if (keys.length > ctx.limits.maxKeys) return reject(413, 'body.too-many-keys')
          for (const key of keys) {
            if (ctx.form.getAll(key).length > ctx.limits.maxValuesPerKey) {
              return reject(413, 'request.too-many', { name: key })
            }
          }
          return undefined
        }

        const authGuards = createAuthorizeGuards(
          reg,
          routeEvent,
          () => capturedForm ?? textForm,
        )

        const handlerDeadlineMs = maxDurationMs ?? UNBOUNDED_HANDLER_TIMEOUT_MS
        const effectiveLimits: Partial<Limits> = {
          ...(reg.limits ?? {}),
          budget: reg.limits?.budget ?? maxBytes,
          timeoutMs: Math.max(reg.limits?.timeoutMs ?? description.intake?.timeoutMs ?? 0, handlerDeadlineMs),
        }

        const baseLayers: Layer[] = [
          methodLayer(),
          originGuard,
          bodyLayer,
          wsFilesLayer,
          namesLayer,
        ]
        const layers = authGuards.layer ? [...baseLayers, authGuards.layer] : baseLayers

        const handler = createFormHandler({
          description,
          instance: matchedInstance,
          source: reg.source,
          ...(authGuards.schema ? { schema: authGuards.schema } : {}),
          checks,
          prepare: reg.prepare,
          idempotency: reg.idempotency,
          throttle: reg.throttle,
          limits: effectiveLimits,
          order: layers,
          execute: async (execCtx) => {
            touchActivity()
            try {
              return await reg.execute(execCtx, routeEvent, capturedForm)
            } catch (err) {
              if (err instanceof WsUploadFieldError) {
                return execCtx.fail(
                  [
                    {
                      id: `${err.field}:${err.code}`,
                      code: err.code,
                      message: err.userMessage,
                      path: err.field,
                      origin: 'server',
                      retryable: true,
                    },
                  ],
                  'not-applied',
                )
              }
              if (err instanceof RangeError && init.files.length > 0) {
                const fallbackField = init.files[0]!.field
                return execCtx.fail(
                  [
                    {
                      id: `${fallbackField}:file.size-mismatch`,
                      code: 'file.size-mismatch',
                      message:
                        'Итоговый размер полученного потока не совпал с заявленным весом файла',
                      path: fallbackField,
                      origin: 'server',
                      retryable: true,
                    },
                  ],
                  'not-applied',
                )
              }
              throw err
            }
          },
        })

        const handled = await handler(synthRequest, 'fetch', routeEvent)

        const refinedResult =
          fieldUploadErrors.size > 0 && !handled.result.ok
            ? {
                ...handled.result,
                errors: handled.result.errors.map((e) => {
                  const uploadErr = e.path ? fieldUploadErrors.get(e.path) : undefined
                  return uploadErr && e.code === 'check.failed'
                    ? {
                        ...e,
                        code: uploadErr.code,
                        message: uploadErr.userMessage,
                        retryable: true,
                      }
                    : e
                }),
              }
            : handled.result

        sessionFinished = true
        activeUploadSessions.delete(sessionId)
        clearTimers()

        if (!abortController.signal.aborted && activeSocket) {
          const target = activeSocket
          safeSendJson(target, {
            type: 'result',
            status: handled.status,
            result: refinedResult,
          })
          target.close(1000, 'Done')
        }
      } catch (err) {
        sessionFinished = true
        activeUploadSessions.delete(sessionId)
        clearTimers()
        if (!abortController.signal.aborted && activeSocket) {
          console.error('[ws-session] непредвиденный сбой потоковой формы:', err)
          const target = activeSocket
          safeSendJson(target, {
            type: 'fault',
            status: 500,
            message: 'Internal upload handler error',
          })
          target.close(1011, 'Internal failure')
        }
      } finally {
        sessionFinished = true
        activeUploadSessions.delete(sessionId)
        clearTimers()
        resolveRootSession?.()
      }
    })()
  }

  await new Promise<void>((resolveSession) => {
    resolveRootSession = resolveSession
    bindActiveSocketListeners(initialSocket)
    attachControlFrameHandler(initialSocket)
    touchActivity()
    startHeartbeat()
  })
}
