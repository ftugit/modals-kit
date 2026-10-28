// Серверная сессия приёма формы с файлами по одному закреплённому `wss://`-соединению.
//
// Инварианты:
// - `src/lib/form` не модифицируется: Кадр 0 (`init`) собирается в лёгкий `URLSearchParams`-запрос,
//   а в `order` сразу после `bodyLayer` и перед `namesLayer` подключается `wsFilesLayer`,
//   подставляющий потоковые `StreamFile extends File` в `ctx.form`;
// - синхронные правила (`required`, `v.accept`, `v.maxSize`, `namesLayer`) выполняются при `0`
//   прочитанных файловых байтов;
// - `imageCheck` читает только первые `256 КБ` (`file.slice(0, 262_144)`), которые кешируются
//   в `headCache` и при успехе переиспользуются в начале `file.stream()` без повторной пересылки;
// - `execute` стримит сегменты по `256 КБ` под backpressure в `storage.put` (`*.part` → `rename`)
//   и фиксирует данные формы + URL файла атомарно в `commit()`.
import type { RequestEvent } from '@sveltejs/kit'
import type { LazyContent } from '@remix-run/lazy-file'
import {
  bodyLayer,
  createFormHandler,
  DEFAULT_LIMITS,
  methodLayer,
  namesLayer,
  reject,
  type Layer,
} from '#lib/form/server.js'
import { StreamFile } from '#lib/storage/index.js'
import { originGuard } from '#server/form-security.server.js'
import type { ServerWsSocket } from '#server/ws-upgrade.server.js'
import { componentFormRegistry } from './registry.js'
import { ensureComponentFormsLoaded } from './server.server.js'
import {
  DEFAULT_WS_CHUNK_BYTES,
  unpackBinarySegment,
  type WsClientInitMessage,
  type WsFileDescriptor,
  type WsSegmentLogEntry,
  type WsServerFaultMessage,
  type WsServerPullMessage,
  type WsServerResultMessage,
} from './ws-protocol.js'

/** Таймаут приёма потоковой сессии по умолчанию (`5 минут` — под Fluid Compute / длинные загрузки). */
export const WS_FORM_TIMEOUT_MS = 5 * 60 * 1000

/** Потолок суммарного объёма потоковых файлов по умолчанию (`10 ГиБ`, если сама форма не задала меньше). */
export const WS_FORM_MAX_BYTES = 10 * 1024 * 1024 * 1024

/** Верхний предел текстового JSON Кадра 0 (`256 КБ`). */
const MAX_INIT_TEXT_BYTES = 256 * 1024

/** Сколько последних подтверждённых сегментов прикладывать в лог кадра `pull`. */
const RECENT_SEGMENTS_LIMIT = 8

export interface WsFormSessionOptions {
  readonly chunkBytes?: number
  readonly timeoutMs?: number
  readonly maxBytes?: number
}

interface PendingSegmentRequest {
  readonly expectedLength: number
  readonly resolve: (bytes: Uint8Array<ArrayBuffer>) => void
  readonly reject: (reason: Error) => void
}

function sendJson(
  socket: ServerWsSocket,
  msg: WsServerPullMessage | WsServerResultMessage | WsServerFaultMessage,
): void {
  socket.sendText(JSON.stringify(msg))
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

  const files: WsFileDescriptor[] = []
  for (const item of obj.files) {
    if (!isValidDescriptor(item)) return null
    files.push(item)
  }

  return { type: 'init', target: obj.target, fields, files }
}

/**
 * Потоковый `LazyContent` одного файла поверх WebSocket pull-протокола.
 * Хранит максимум первый срез `<= chunkBytes` (`headCache`) для бесшовной работы `imageCheck`.
 */
function createWsLazyContent(
  desc: WsFileDescriptor,
  chunkBytes: number,
  pullSegment: (
    desc: WsFileDescriptor,
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
  let sentSegments = 0
  let receivedBytes = 0
  let recentSegments: WsSegmentLogEntry[] = []
  let headCache: Uint8Array<ArrayBuffer> | null = null

  const recordSegment = (segmentIndex: number, offset: number, bytes: number): void => {
    sentSegments += 1
    receivedBytes += bytes
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
      let offset = boundedStart

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
          if (offset >= boundedEnd) {
            controller.close()
            return
          }

          // Переиспользуем `headCache`, если `imageCheck` уже подтянул заголовок `[0, <= chunkBytes)`
          if (offset === 0 && headCache !== null && headCache.byteLength > 0) {
            if (boundedEnd <= headCache.byteLength) {
              controller.enqueue(headCache.subarray(0, boundedEnd))
              offset = boundedEnd
              controller.close()
              return
            }
            const cached = headCache
            headCache = null
            offset = cached.byteLength
            controller.enqueue(cached)
            return
          }

          const length = Math.min(chunkBytes, boundedEnd - offset)
          const segmentIndex = Math.floor(offset / chunkBytes)
          try {
            const bytes = await pullSegment(
              desc,
              segmentIndex,
              totalSegments,
              sentSegments,
              receivedBytes,
              offset,
              length,
              recentSegments,
            )

            // Если это чтение только шапки файла (`imageCheck`), сохраняем в `headCache`
            // для последующего полного `file.stream()` в `execute`
            const isHeadProbe = boundedStart === 0 && boundedEnd <= chunkBytes && boundedEnd < desc.size
            if (isHeadProbe && offset === 0) {
              headCache = bytes.slice()
            }

            const currentOffset = offset
            offset += bytes.byteLength
            recordSegment(segmentIndex, currentOffset, bytes.byteLength)
            controller.enqueue(bytes)
            if (offset >= boundedEnd) {
              controller.close()
            }
          } catch (cause) {
            controller.error(cause instanceof Error ? cause : new Error(String(cause)))
          }
        },
      })
    },
  }
}

/**
 * Обработать одну потоковую отправку формы по открытому серверному сокету `ServerWsSocket`.
 */
export async function handleFormUploadWs(
  socket: ServerWsSocket,
  event: RequestEvent,
  options: WsFormSessionOptions = {},
): Promise<void> {
  const chunkBytes = options.chunkBytes ?? DEFAULT_WS_CHUNK_BYTES
  const timeoutMs = options.timeoutMs ?? WS_FORM_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? WS_FORM_MAX_BYTES

  const abortController = new AbortController()
  const pendingPulls = new Map<number, PendingSegmentRequest>()
  let nextReqId = 1
  let initHandled = false

  const abortAllPending = (reason: Error): void => {
    if (!abortController.signal.aborted) {
      abortController.abort(reason)
    }
    for (const [, pending] of pendingPulls) {
      pending.reject(reason)
    }
    pendingPulls.clear()
  }

  socket.onClose((code, reason) => {
    abortAllPending(new Error(`WebSocket closed (${code}${reason ? `: ${reason}` : ''})`))
  })

  socket.onProblem((cause) => {
    abortAllPending(cause instanceof Error ? cause : new Error(String(cause)))
  })

  socket.onBinary((frame) => {
    const parsed = unpackBinarySegment(frame)
    if (!parsed) {
      sendJson(socket, { type: 'fault', status: 400, message: 'Malformed binary segment header' })
      socket.close(1002, 'Malformed binary frame')
      return
    }
    const pending = pendingPulls.get(parsed.reqId)
    if (!pending) {
      sendJson(socket, { type: 'fault', status: 400, message: 'Unexpected segment reqId' })
      socket.close(1002, 'Unexpected reqId')
      return
    }
    pendingPulls.delete(parsed.reqId)
    if (parsed.payload.byteLength !== pending.expectedLength) {
      const mismatch = new Error(
        `Segment length mismatch: expected ${pending.expectedLength}, received ${parsed.payload.byteLength}`,
      )
      pending.reject(mismatch)
      sendJson(socket, { type: 'fault', status: 400, message: mismatch.message })
      socket.close(1002, 'Segment length mismatch')
      return
    }
    // Копируем срез буфера кадра в чистый ArrayBuffer, чтобы владение не зависело от пула `ws`
    const copy = new Uint8Array(new ArrayBuffer(parsed.payload.byteLength))
    copy.set(parsed.payload)
    pending.resolve(copy)
  })

  const pullSegment = (
    desc: WsFileDescriptor,
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
    return new Promise<Uint8Array<ArrayBuffer>>((resolve, rejectPromise) => {
      pendingPulls.set(reqId, {
        expectedLength: length,
        resolve,
        reject: rejectPromise,
      })
      sendJson(socket, {
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
      })
    })
  }

  await new Promise<void>((resolveSession) => {
    socket.onClose(() => resolveSession())

    socket.onText((rawText) => {
      if (initHandled) {
        sendJson(socket, { type: 'fault', status: 400, message: 'Duplicate init frame' })
        socket.close(1002, 'Duplicate init')
        return
      }
      initHandled = true

      void (async () => {
        try {
          const init = parseInitFrame(rawText)
          if (!init) {
            sendJson(socket, { type: 'fault', status: 400, message: 'Invalid init frame' })
            socket.close(1002, 'Invalid init')
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
            sendJson(socket, { type: 'fault', status: 404, message: 'Unknown component form' })
            socket.close(1008, 'Unknown form')
            return
          }

          const reg = registry.get(matchedId)!
          const description =
            typeof reg.description === 'function' ? reg.description(event) : reg.description
          const checks = typeof reg.checks === 'function' ? await reg.checks(event) : reg.checks

          // Строим синтетический POST-запрос только из лёгких текстовых пар Кадра 0
          const targetUrl = new URL(init.target || '/', event.url)
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

          const streamFiles = init.files.map((desc) => ({
            field: desc.field,
            file: new StreamFile(
              createWsLazyContent(desc, chunkBytes, pullSegment, abortController.signal),
              desc.name,
              { type: desc.type, lastModified: desc.lastModified },
            ),
          }))

          // Слой между `bodyLayer` и `namesLayer`: добавляет ленивые `StreamFile` в `ctx.form`
          let capturedForm: FormData | undefined
          const wsFilesLayer: Layer = (ctx) => {
            if (!ctx.form) return undefined
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

          const effectiveLimits = {
            ...DEFAULT_LIMITS,
            ...(reg.limits ?? {}),
            maxBytes: reg.limits?.maxBytes ?? maxBytes,
            timeoutMs: Math.max(reg.limits?.timeoutMs ?? 0, timeoutMs),
          }

          const routeEvent: RequestEvent = {
            ...event,
            request: synthRequest,
            url: targetUrl,
          }

          const handler = createFormHandler({
            description,
            instance: matchedInstance,
            source: reg.source,
            checks,
            prepare: reg.prepare,
            idempotency: reg.idempotency,
            throttle: reg.throttle,
            limits: effectiveLimits,
            order: [methodLayer(), originGuard, bodyLayer, wsFilesLayer, namesLayer],
            execute: (execCtx) => reg.execute(execCtx, routeEvent, capturedForm),
          })

          const handled = await handler(synthRequest, 'fetch', routeEvent)
          if (!abortController.signal.aborted) {
            sendJson(socket, {
              type: 'result',
              status: handled.status,
              result: handled.result,
            })
            socket.close(1000, 'Done')
          }
        } catch (err) {
          if (!abortController.signal.aborted) {
            console.error('[ws-session] непредвиденный сбой потоковой формы:', err)
            sendJson(socket, {
              type: 'fault',
              status: 500,
              message: 'Internal upload handler error',
            })
            socket.close(1011, 'Internal failure')
          }
        } finally {
          resolveSession()
        }
      })()
    })
  })
}
