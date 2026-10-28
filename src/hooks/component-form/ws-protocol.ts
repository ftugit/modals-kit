// Изоморфный протокол потоковой отправки форм с файлами по одному закреплённому `wss://`-сокету.
// Не тянет серверных зависимостей — используется и клиентом (`ws-transport.ts`), и сервером (`ws-session.server.ts`).
import type { Result } from '#lib/form/index.js'

/** Единый адрес апгрейда потоковой загрузки форм. */
export const FORM_UPLOAD_WS_PATH = '/api/form-upload'

/**
 * Размер одного файлового сегмента по умолчанию: `256 КБ` (`262 144` байта).
 * Укладывается в лимит кадра Vercel Functions и кратен блоку `64 КБ` потокового AEAD.
 */
export const DEFAULT_WS_CHUNK_BYTES = 256 * 1024

/** Длина префикса `reqId` (`Uint32` big-endian) в начале каждого бинарного кадра от клиента. */
export const WS_BINARY_HEADER_BYTES = 4

/** Паспорт одного выбранного файла в Кадре 0 (`init`). */
export interface WsFileDescriptor {
  readonly id: string
  readonly field: string
  readonly name: string
  readonly size: number
  readonly type: string
  readonly lastModified: number
}

/** Кадр 0 (клиент → сервер): лёгкие текстовые поля формы + паспорта файлов без байтов. */
export interface WsClientInitMessage {
  readonly type: 'init'
  readonly target: string
  readonly fields: readonly (readonly [string, string])[]
  readonly files: readonly WsFileDescriptor[]
}

/** Запись в журнале подтверждённых сервером сегментов. */
export interface WsSegmentLogEntry {
  readonly segmentIndex: number
  readonly offset: number
  readonly bytes: number
}

/** Запрос следующего сегмента с журналом уже принятых частей (сервер → клиент). */
export interface WsServerPullMessage {
  readonly type: 'pull'
  readonly reqId: number
  readonly fileId: string
  readonly field: string
  readonly segmentIndex: number
  readonly totalSegments: number
  readonly sentSegments: number
  readonly receivedBytes: number
  readonly totalFileBytes: number
  readonly offset: number
  readonly length: number
  readonly recentSegments: readonly WsSegmentLogEntry[]
}

/** Итоговый ответ конвейера формы после записи потока и `commit()` (сервер → клиент). */
export interface WsServerResultMessage {
  readonly type: 'result'
  readonly status: number
  readonly result: Result
}

/** Протокольная/транспортная ошибка до разбора конверта формы (сервер → клиент). */
export interface WsServerFaultMessage {
  readonly type: 'fault'
  readonly status: number
  readonly message: string
}

export type WsServerMessage =
  | WsServerPullMessage
  | WsServerResultMessage
  | WsServerFaultMessage

/** Прогресс одного файла для реактивного показа в `FileAttachment`. */
export interface FileUploadProgressEntry {
  readonly fileId: string
  readonly field: string
  readonly name: string
  readonly size: number
  readonly state: 'uploading' | 'processing' | 'done' | 'error'
  readonly receivedBytes: number
  readonly sentSegments: number
  readonly totalSegments: number
  /** Процент `0..100`. */
  readonly progress: number
  readonly recentSegments: readonly WsSegmentLogEntry[]
}

/** Структура, которую `ws-transport` передаёт в `TransportRequest.report(progress)` (`form.state.progress`). */
export interface FormUploadProgress {
  readonly kind: 'ws-upload'
  readonly phase: 'validating' | 'uploading' | 'processing' | 'done'
  readonly sentBytes: number
  readonly totalBytes: number
  readonly percent: number
  readonly files: readonly FileUploadProgressEntry[]
}

/** Упаковать `reqId` (`Uint32` BE) + байты среза файла в один бинарный кадр. */
export function packBinarySegment(reqId: number, payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(WS_BINARY_HEADER_BYTES + payload.byteLength)
  new DataView(frame.buffer, frame.byteOffset, WS_BINARY_HEADER_BYTES).setUint32(0, reqId, false)
  frame.set(payload, WS_BINARY_HEADER_BYTES)
  return frame
}

/** Распаковать бинарный кадр сегмента на `reqId` и полезную нагрузку. */
export function unpackBinarySegment(frame: Uint8Array): {
  readonly reqId: number
  readonly payload: Uint8Array
} | null {
  if (frame.byteLength < WS_BINARY_HEADER_BYTES) return null
  const reqId = new DataView(frame.buffer, frame.byteOffset, WS_BINARY_HEADER_BYTES).getUint32(
    0,
    false,
  )
  const payload = frame.subarray(WS_BINARY_HEADER_BYTES)
  return { reqId, payload }
}
