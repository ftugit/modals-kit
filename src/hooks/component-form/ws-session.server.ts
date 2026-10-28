// Серверная сессия приёма формы с файлами по одному закреплённому `wss://`-соединению.
//
// Инварианты:
// - `src/lib/form` не модифицируется: Кадр 0 (`init`) собирается в лёгкий `URLSearchParams`-запрос,
//   а в `order` сразу после `bodyLayer` и перед `namesLayer` подключается `wsFilesLayer`,
//   подставляющий потоковые `StreamFile extends File` в `ctx.form`;
// - ранний ACL-гейт `authorize` и синхронные правила (`required`, `v.accept`, `v.maxSize`, `namesLayer`)
//   выполняются при `0` прочитанных файловых байтов (даже до `imageCheck`);
// - опциональная на отдельную загрузку (`integrity`) одноразовая 32-байтная соль проверяет
//   потоковую цепочку `HMAC-SHA-256` на каждом сегменте `256 КБ` ДО записи байтов в `storage.put`;
// - расхождение размера, мутация файла на диске клиента и нарушение подписи возвращаются
//   штатным `422 Result` (`not-applied`) прямо на соответствующем файловом поле с очисткой `.part`.
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
import { createAuthorizeGuards } from './authorize.server.js'
import { componentFormRegistry } from './registry.js'
import { ensureComponentFormsLoaded } from './server.server.js'
import {
  createFileIntegrityChain,
  generateUploadSaltHex,
  importUploadSaltKey,
  timingSafeTagEqual,
  type FileIntegrityChain,
} from './ws-integrity.js'
import { verifyFirstSegmentSignature } from './ws-magic.js'
import {
  DEFAULT_WS_CHUNK_BYTES,
  unpackBinarySegment,
  type WsClientAbortFileMessage,
  type WsClientInitMessage,
  type WsFileDescriptor,
  type WsSegmentLogEntry,
  type WsServerFaultMessage,
  type WsServerPullMessage,
  type WsServerResultMessage,
} from './ws-protocol.js'

/** Таймаут приёма потоковой сессии по умолчанию (`5 минут` — под Fluid Compute / длинные загрузки). */
export const WS_FORM_TIMEOUT_MS = 5 * 60 * 1000

/** Безопасный потолок суммарного объёма потоковых файлов формы по умолчанию (`256 МБ`, если сама форма не задала `limits.maxBytes`). */
export const WS_FORM_MAX_BYTES = 256 * 1024 * 1024

/** Верхний предел числа файловых дескрипторов в Кадре 0 (`init.files`), отсекающий дескрипторный флуд до создания `StreamFile`. */
export const MAX_WS_FILES_COUNT = DEFAULT_LIMITS.maxValuesPerKey

/** Верхний предел текстового JSON Кадра 0 (`256 КБ`). */
const MAX_INIT_TEXT_BYTES = 256 * 1024

/** Сколько последних подтверждённых сегментов прикладывать в лог кадра `pull`. */
const RECENT_SEGMENTS_LIMIT = 8

export interface WsFormSessionOptions {
  readonly chunkBytes?: number
  readonly timeoutMs?: number
  readonly maxBytes?: number
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
  readonly fileId: string
  readonly field: string
  readonly segmentIndex: number
  readonly offset: number
  readonly expectedLength: number
  readonly chain?: FileIntegrityChain
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

function parseAbortFileFrame(rawText: string): WsClientAbortFileMessage | null {
  if (rawText.length > 4096) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>
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
 * Потоковый `LazyContent` одного файла поверх WebSocket pull-протокола.
 * Хранит максимум первый срез `<= chunkBytes` (`headCache`) для бесшовной работы `imageCheck`.
 */
function createWsLazyContent(
  desc: WsFileDescriptor,
  chunkBytes: number,
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

          // Переиспользуем `headCache`, если `imageCheck` уже подтянул и проверил заголовок `[0, <= chunkBytes)`
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
              chain,
              segmentIndex,
              totalSegments,
              sentSegments,
              receivedBytes,
              offset,
              length,
              recentSegments,
            )

            // На первом сегменте сверяем реальную сигнатуру (magic bytes) с заявленным типом/расширением
            if (enforceMagicSignature && offset === 0 && bytes.byteLength > 0) {
              const sigErr = verifyFirstSegmentSignature(desc.type, desc.name, bytes)
              if (sigErr) {
                const err = new WsUploadFieldError(desc.field, 'file.type-mismatch', sigErr)
                onFieldUploadError(err)
                controller.error(err)
                return
              }
            }

            const isHeadProbe =
              boundedStart === 0 && boundedEnd <= chunkBytes && boundedEnd < desc.size
            if (isHeadProbe && offset === 0) {
              const cachedCopy = new Uint8Array(new ArrayBuffer(bytes.byteLength))
              cachedCopy.set(bytes)
              headCache = cachedCopy
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
  const fieldUploadErrors = new Map<string, WsUploadFieldError>()
  let nextReqId = 1
  let initHandled = false
  let sessionSaltHex: string | undefined

  const failPendingField = (pending: PendingSegmentRequest, err: WsUploadFieldError): void => {
    fieldUploadErrors.set(pending.field, err)
    pending.reject(err)
  }

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

  // Очередь обработки бинарных кадров: гарантирует строгий порядок шагов цепочки `HMAC-SHA-256`
  let binaryQueue = Promise.resolve()
  socket.onBinary((frame) => {
    binaryQueue = binaryQueue.then(async () => {
      // Сначала читаем `reqId` (первые 4 байта), чтобы узнать, требовался ли `HMAC` для этого запроса
      const headerProbe = unpackBinarySegment(frame, false)
      if (!headerProbe) {
        sendJson(socket, { type: 'fault', status: 400, message: 'Malformed binary segment header' })
        socket.close(1002, 'Malformed binary frame')
        return
      }
      const pending = pendingPulls.get(headerProbe.reqId)
      if (!pending) {
        sendJson(socket, { type: 'fault', status: 400, message: 'Unexpected segment reqId' })
        socket.close(1002, 'Unexpected reqId')
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

      // Копируем срез буфера кадра в чистый ArrayBuffer, чтобы владение не зависело от пула `ws`
      const copy = new Uint8Array(new ArrayBuffer(parsed.payload.byteLength))
      copy.set(parsed.payload)
      pending.resolve(copy)
    })
  })

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
    return new Promise<Uint8Array<ArrayBuffer>>((resolve, rejectPromise) => {
      pendingPulls.set(reqId, {
        fileId: desc.id,
        field: desc.field,
        segmentIndex,
        offset,
        expectedLength: length,
        chain,
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
        ...(sessionSaltHex ? { salt: sessionSaltHex } : {}),
      })
    })
  }

  await new Promise<void>((resolveSession) => {
    socket.onClose(() => resolveSession())

    socket.onText((rawText) => {
      if (initHandled) {
        const abortMsg = parseAbortFileFrame(rawText)
        if (abortMsg) {
          const pending = pendingPulls.get(abortMsg.reqId)
          if (pending && pending.fileId === abortMsg.fileId) {
            pendingPulls.delete(abortMsg.reqId)
            const userText =
              abortMsg.code === 'file.changed'
                ? 'Файл изменился на устройстве во время загрузки — выберите его заново'
                : 'Не удалось прочитать выбранный файл с устройства'
            failPendingField(
              pending,
              new WsUploadFieldError(pending.field, abortMsg.code, userText),
            )
          }
          return
        }
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

          const routeEvent: RequestEvent = {
            ...event,
            request: synthRequest,
            url: targetUrl,
          }

          const checks = typeof reg.checks === 'function' ? await reg.checks(routeEvent) : reg.checks

          // Вычисляем настройку солёной целостности именно для ЭТОЙ отдельной загрузки
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

          // Слой между `bodyLayer` и `namesLayer`: добавляет ленивые `StreamFile` в `ctx.form`
          // и сразу проверяет суммарный заявленный вес файлов против `ctx.limits.maxBytes` при 0 прочитанных байт
          const totalDeclaredBytes = init.files.reduce((acc, f) => acc + f.size, 0)
          let capturedForm: FormData | undefined
          const wsFilesLayer: Layer = (ctx) => {
            if (!ctx.form) return undefined
            if (totalDeclaredBytes > ctx.limits.maxBytes) {
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

          const effectiveLimits = {
            ...DEFAULT_LIMITS,
            ...(reg.limits ?? {}),
            maxBytes: reg.limits?.maxBytes ?? maxBytes,
            timeoutMs: Math.max(reg.limits?.timeoutMs ?? 0, timeoutMs),
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

          // Если доменный сбой потока произошёл внутри `checks` (`imageCheck`),
          // подменяем обобщённый `check.failed` на точный русский текст причины
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

          if (!abortController.signal.aborted) {
            sendJson(socket, {
              type: 'result',
              status: handled.status,
              result: refinedResult,
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
