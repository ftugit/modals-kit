// Клиентский потоковый `wss://`-транспорт форм с файлами.
//
// Отправляет Кадр 0 (`init` с текстовыми полями + паспортами файлов без байтов),
// по командам сервера `pull` проверяет неизменность файла на диске (`size` / `lastModified`),
// вырезает ровно запрошенный срез `file.slice(offset, offset + length)` (пик в памяти — `256 КБ`),
// при наличии одноразовой серверной соли `salt` считает zero-copy шаг цепочки `HMAC-SHA-256`,
// контролирует `bufferedAmount` сокета, обновляет `req.report(progress)` для `FileAttachment`
// и `formTask`, и возвращает штатный `Result` формы после серверного `commit()`.
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
}

const WS_OPEN = 1
const WS_CONNECTING = 0

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

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildSnapshot(
  phase: FormUploadProgress['phase'],
  salted: boolean,
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
      : phase === 'done' || phase === 'processing'
        ? 100
        : 0

  const label =
    phase === 'validating'
      ? 'Проверка полей…'
      : phase === 'processing'
        ? 'Сохранение файла…'
        : phase === 'uploading'
          ? `Загрузка ${percent}%`
          : undefined

  return {
    status: 'pending',
    scope: 'local',
    ...(label ? { label } : {}),
    progress: { kind: 'bytes', loaded: sentBytes, total: totalBytes },
    kind: 'ws-upload',
    phase,
    sentBytes,
    totalBytes,
    percent,
    salted,
    files: entries.map((e) => ({ ...e, salted, recentSegments: [...e.recentSegments] })),
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
 * Построить потоковый `Transport` для форм с файлами поверх одного `wss://`-соединения.
 */
export function wsFormTransport(
  resolveTarget: () => string,
  options: WsFormTransportOptions = {},
): Transport {
  const highWaterMark = options.highWaterMarkBytes ?? 2 * DEFAULT_WS_CHUNK_BYTES

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

    let fileCounter = 0
    for (const [key, value] of req.data.entries()) {
      if (value instanceof File) {
        // Невыбранный `<input type="file">` в браузере даёт пустой `File("", 0)` — пропускаем
        if (value.name === '' && value.size === 0) continue
        const id = `f${fileCounter++}`
        const totalSegments =
          value.size === 0 ? 0 : Math.ceil(value.size / DEFAULT_WS_CHUNK_BYTES)
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
        progressById.set(id, {
          fileId: id,
          field: key,
          name: value.name,
          size: value.size,
          state: 'uploading',
          receivedBytes: 0,
          sentSegments: 0,
          totalSegments,
          progress: value.size === 0 ? 100 : 0,
          recentSegments: [],
        })
      } else {
        fields.push([key, value])
      }
    }

    let saltedSession = false
    let saltKeyPromise: Promise<CryptoKey | null> | null = null
    const chainsById = new Map<string, Promise<FileIntegrityChain>>()

    const getChainForFile = (
      saltHex: string,
      desc: WsFileDescriptor,
    ): Promise<FileIntegrityChain | null> => {
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

    const emitProgress = (phase: FormUploadProgress['phase']): void => {
      req.report?.(buildSnapshot(phase, saltedSession, [...progressById.values()]))
    }

    const endpoint =
      typeof options.wsUrl === 'function'
        ? options.wsUrl()
        : (options.wsUrl ?? defaultWsUrl())

    return new Promise((resolve) => {
      let settled = false
      let allBytesSent = false
      let pullQueue = Promise.resolve()
      const ws = new WsCtor(endpoint)
      ws.binaryType = 'arraybuffer'

      const finish = (out: Awaited<ReturnType<Transport>>): void => {
        if (settled) return
        settled = true
        req.signal?.removeEventListener('abort', onAbort)
        resolve(out)
      }

      const onAbort = (): void => {
        if (ws.readyState === WS_OPEN || ws.readyState === WS_CONNECTING) {
          ws.close(1001, 'Aborted')
        }
        finish({ kind: 'abort', reason: 'aborted' })
      }
      req.signal?.addEventListener('abort', onAbort, { once: true })

      ws.addEventListener('open', () => {
        const initMsg: WsClientInitMessage = {
          type: 'init',
          target: resolveTarget(),
          fields,
          files: descriptors,
        }
        emitProgress('validating')
        ws.send(JSON.stringify(initMsg))
      })

      ws.addEventListener('message', (ev) => {
        const raw = ev.data
        if (typeof raw !== 'string') return
        let msg: WsServerMessage
        try {
          msg = JSON.parse(raw) as WsServerMessage
        } catch {
          return
        }

        if (msg.type === 'pull') {
          pullQueue = pullQueue.then(async () => {
            const file = filesById.get(msg.fileId)
            const desc = descriptorsById.get(msg.fileId)
            const current = progressById.get(msg.fileId)
            if (!file || !desc || !current || settled) return

            if (msg.salt) saltedSession = true

            // Проверяем, что файл на диске пользователя не вырос и не уменьшился с момента Кадра 0
            if (
              file.size !== desc.size ||
              (desc.lastModified > 0 && file.lastModified !== desc.lastModified)
            ) {
              if (ws.readyState === WS_OPEN) {
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

            // Фиксируем подтверждённый сервером прогресс предыдущих сегментов
            const ackPct =
              msg.totalFileBytes > 0
                ? Math.min(99, Math.round((msg.receivedBytes / msg.totalFileBytes) * 100))
                : 100
            progressById.set(msg.fileId, {
              ...current,
              state: 'uploading',
              receivedBytes: msg.receivedBytes,
              sentSegments: msg.sentSegments,
              totalSegments: msg.totalSegments,
              progress: ackPct,
              recentSegments: msg.recentSegments,
            })
            emitProgress('uploading')

            try {
              const sliceBuf = await file.slice(msg.offset, msg.offset + msg.length).arrayBuffer()
              if (settled || ws.readyState !== WS_OPEN) return

              // Повторно сверяем длину реально вычитанного среза и метаданные файла
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

              while (ws.bufferedAmount > highWaterMark && ws.readyState === WS_OPEN && !settled) {
                await waitMs(10)
              }
              if (settled || ws.readyState !== WS_OPEN) return

              const frame = packBinarySegment(msg.reqId, sliceBytes, hmacTag)
              ws.send(frame)

              const newReceived = msg.offset + msg.length
              const newSentSegments = msg.sentSegments + 1
              const updatedLog: WsSegmentLogEntry[] = [
                ...msg.recentSegments.slice(-7),
                { segmentIndex: msg.segmentIndex, offset: msg.offset, bytes: msg.length },
              ]
              const fileCompleted = newReceived >= file.size
              progressById.set(msg.fileId, {
                ...current,
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
                emitProgress('processing')
              } else {
                emitProgress('uploading')
              }
            } catch {
              if (ws.readyState === WS_OPEN) {
                const abortMsg: WsClientAbortFileMessage = {
                  type: 'abort-file',
                  reqId: msg.reqId,
                  fileId: msg.fileId,
                  code: 'file.unreadable',
                }
                ws.send(JSON.stringify(abortMsg))
              }
            }
          })
          return
        }

        if (msg.type === 'result') {
          if (msg.result.ok) {
            for (const [id, entry] of progressById) {
              progressById.set(id, { ...entry, state: 'done', progress: 100 })
            }
            emitProgress('done')
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
        // Итоговое решение вынесет `close`, если `result`/`fault` не успели прийти
      })

      ws.addEventListener('close', (ev) => {
        if (settled) return
        if (req.signal?.aborted) {
          finish({ kind: 'abort', reason: 'aborted' })
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
    })
  }
}
