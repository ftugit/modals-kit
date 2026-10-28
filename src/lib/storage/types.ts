import type { LazyContent } from '@remix-run/lazy-file'
import type { AdaptedStorageLedger, StoredFileRecord } from './ledger.js'
import type { StreamFile } from './stream-file.js'

export type { LazyContent }

/** Источник байтов для записи в хранилище. */
export type StoragePutBody =
  | ReadableStream<Uint8Array>
  | Blob
  | Uint8Array
  | ArrayBuffer

/** Лимиты конкретного сервера хранения. */
export interface ServerLimits {
  /** Максимальный суммарный объём данных на сервере, байт. */
  readonly storageBytes: number
  /** Максимальный вес одного файла на этом сервере, байт. */
  readonly fileBytes: number
}

/** Конфигурация сервера с явными лимитами и политикой записи поверх готового драйвера. */
export interface ConfiguredStorageServer {
  readonly driver: StorageDriver
  readonly limits: ServerLimits
  readonly readOnly?: boolean
  readonly allowSplit?: boolean
}

/** Декларативная конфигурация сервера по единой DSN-ссылке (`s3://...`, `s3+http://...`, `memory://...`). */
export interface UrlConfiguredStorageServer {
  readonly url: string | URL
  readonly limits: ServerLimits
  readonly readOnly?: boolean
  readonly allowSplit?: boolean
  readonly publicBaseUrl?: string
}

export type StorageServerEntry =
  | StorageDriver
  | ConfiguredStorageServer
  | UrlConfiguredStorageServer

/** Параметры сохранения файла в хранилище. */
export interface StoragePutInput {
  /** Относительный POSIX-путь объекта внутри хранилища (например `uploads/video.mp4`). */
  readonly path: string
  /** Поток или буфер содержимого файла. */
  readonly body: StoragePutBody
  /** Заявленный размер в байтах (проверяется при записи потока и резервировании `ledger`). */
  readonly size?: number
  /** MIME-тип файла. */
  readonly contentType?: string
  /** Метка модификации (мс от эпохи Unix). */
  readonly lastModified?: number
  /** Имя целевого сервера из словаря `servers` (по умолчанию выбирается из `writePool` / `defaultServer`). */
  readonly server?: string
  /** Сигнал отмены записи (обрыв соединения удаляет временный файл и снимает бронь). */
  readonly signal?: AbortSignal
}

/** Параметры потокового переноса (`copy` / `move`) между серверами хранения без буферизации в RAM. */
export interface StorageTransferInput {
  /** Исходный логический путь объекта. */
  readonly path: string
  /** Целевой путь объекта (по умолчанию равен `path`). */
  readonly toPath?: string
  /** Исходный сервер (если не указан — определяется по `ledger` или `defaultServer`). */
  readonly from?: string
  /** Целевой сервер, куда перекачивается поток. */
  readonly to: string
  /** Сигнал отмены переноса. */
  readonly signal?: AbortSignal
}

/** Паспорт сохранённого объекта. */
export interface StoredObject {
  readonly path: string
  readonly server: string
  readonly size: number
  readonly contentType: string
  readonly lastModified: number
  /** Публичный URL объекта, если у драйвера задан `publicBaseUrl`. */
  readonly url?: string
}

/** Сводка состояния одного сервера в `storage.report()`. */
export interface StorageServerReport {
  readonly server: string
  readonly kind: string
  readonly readOnly: boolean
  readonly limits: ServerLimits
  readonly usedBytes: number
  readonly reservedBytes: number
  readonly freeBytes: number
  readonly filesCount: number
}

/** Сводный отчёт по всем серверам хранилища. */
export interface StorageReport {
  readonly servers: readonly StorageServerReport[]
}

/** Настройки HTTP-раздачи файла (`serve`). */
export interface StorageServeOptions {
  readonly server?: string
  readonly cacheControl?: string
  readonly etag?: false | 'weak' | 'strong'
  /** Включить поддержку `Range` (`206 Partial Content`); по умолчанию `true`. */
  readonly acceptRanges?: boolean
  /** Отдать с `Content-Disposition: attachment` (`true` — имя из пути, строка — явное имя). */
  readonly download?: boolean | string
}

/** Внутренний нормализованный запрос к драйверу конкретного сервера. */
export interface DriverPutInput {
  readonly path: string
  readonly stream: ReadableStream<Uint8Array>
  readonly size?: number
  readonly contentType: string
  readonly lastModified: number
  readonly signal?: AbortSignal
}

/** Метаданные объекта, возвращаемые драйвером сервера. */
export interface DriverStoredMeta {
  readonly path: string
  readonly size: number
  readonly contentType: string
  readonly lastModified: number
}

/** Контракт драйвера одного сервера хранения (`memory`, `local`, `s3`, далее `webdav`). */
export interface StorageDriver {
  readonly kind: string
  readonly publicBaseUrl?: string
  put(input: DriverPutInput): Promise<DriverStoredMeta>
  head(path: string): Promise<DriverStoredMeta | null>
  lazy(path: string): Promise<StreamFile | null>
  del(path: string): Promise<boolean>
}

/** Конфигурация `createStorage`. */
export interface StorageConfig {
  /** Словарь подключённых серверов по имени (`{ local: ..., b2: ..., r2: ... }`). */
  readonly servers: Readonly<Record<string, StorageServerEntry>>
  /** Сервер по умолчанию (если не указан — первый пишущий сервер из `servers`). */
  readonly defaultServer?: string
  /** Упорядоченный пул серверов для автовыбора при записи, если `input.server` не указан. */
  readonly writePool?: readonly string[]
  /** Реестр учёта места и манифестов файлов (по умолчанию `memoryLedger()`). */
  readonly ledger?: AdaptedStorageLedger
  /** Срок жизни брони места на время загрузки (по умолчанию `1 час`). */
  readonly reservationTtlMs?: number
}

/** Результат одного шага живой самопроверки `storage.probe(server)`. */
export interface StorageProbeStep {
  readonly step: 'put' | 'head' | 'range' | 'delete' | 'readonly-guard'
  readonly ok: boolean
  readonly durationMs: number
  readonly detail?: string
}

/** Сводный отчёт функциональной проверки сервера хранения `storage.probe(server)`. */
export interface StorageProbeResult {
  readonly server: string
  readonly kind: string
  readonly readOnly: boolean
  readonly ok: boolean
  readonly totalMs: number
  readonly steps: readonly StorageProbeStep[]
  readonly error?: string
}

/** Публичный экземпляр хранилища. */
export interface Storage {
  readonly serverNames: readonly string[]
  setServer(name: string, entry: StorageServerEntry): void
  removeServer(name: string): Promise<boolean>
  probe(server: string): Promise<StorageProbeResult>
  put(input: StoragePutInput): Promise<StoredObject>
  head(path: string, options?: { server?: string }): Promise<StoredObject | null>
  stat(path: string): Promise<StoredFileRecord | null>
  get(path: string, options?: { server?: string }): Promise<ReadableStream<Uint8Array> | null>
  lazy(path: string, options?: { server?: string }): Promise<StreamFile | null>
  serve(path: string, request: Request, options?: StorageServeOptions): Promise<Response>
  del(path: string, options?: { server?: string }): Promise<boolean>
  copy(input: StorageTransferInput): Promise<StoredObject>
  move(input: StorageTransferInput): Promise<StoredObject>
  report(): Promise<StorageReport>
}
