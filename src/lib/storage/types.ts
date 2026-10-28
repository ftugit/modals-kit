import type { LazyContent } from '@remix-run/lazy-file'
import type { BandwidthLimiter, RateInput } from './bandwidth.js'
import type { ConcurrencyConfig, ConcurrencyInput } from './concurrency.js'
import type { StorageEncryptionKey } from './crypto.js'
import type { AdaptedStorageLedger, StoredFileRecord } from './ledger.js'
import type { StorageStateListener } from './state.js'
import type {
  AdaptedStorageStore,
  StorageRequestMeta,
  StorageTechConfig,
} from './store.js'
import type { StreamFile } from './stream-file.js'

export type {
  AdaptedStorageStore,
  BandwidthLimiter,
  ConcurrencyConfig,
  ConcurrencyInput,
  LazyContent,
  RateInput,
  StorageEncryptionKey,
  StorageRequestMeta,
  StorageStateListener,
  StorageTechConfig,
}

/** Источник байтов для записи в хранилище. */
export type StoragePutBody =
  | ReadableStream<Uint8Array>
  | Blob
  | Uint8Array
  | ArrayBuffer

/** Дисковый спул временного сохранения потока перед отправкой (`stageToDisk: true`). */
export interface StagedSpoolFile {
  readonly size: number
  readonly file: StreamFile
  cleanup(): Promise<void>
}

export interface StorageSpool {
  stage(
    stream: ReadableStream<Uint8Array>,
    signal?: AbortSignal,
  ): Promise<StagedSpoolFile>
}

/** Лимиты конкретного сервера хранения. */
export interface ServerLimits {
  /** Максимальный суммарный объём данных на сервере, байт. */
  readonly storageBytes: number
  /** Максимальный вес одного физического файла на этом сервере, байт. */
  readonly fileBytes: number
}

/** Общие политики конкретного сервера хранения. */
export interface StorageServerPolicy {
  readonly limits: ServerLimits
  readonly readOnly?: boolean
  /** Разрешено ли хранить на сервере куски нарезанных файлов (`split`); по умолчанию `true`. */
  readonly allowSplit?: boolean
  /** Ключ потокового шифрования `AES-256-GCM` для этого сервера (`null`/`undefined` — без шифрования). */
  readonly key?: StorageEncryptionKey | null
  /** Лимит скорости в байтах/сек или общий `BandwidthLimiter` (`0`/`null` — без ограничения). */
  readonly rate?: RateInput
  /** Лимит параллельных потоков (`0`/`null` — без ограничения). */
  readonly concurrency?: ConcurrencyInput
  /** Базовый URL CDN для редиректа при `serve(..., { cdn: true })`. */
  readonly cdnUrl?: string
  /** TTL кэширования `head`/`stat` в мс (требует переданного `store`, иначе пишет в `console.error`). */
  readonly statTtlMs?: number
}

/** Конфигурация сервера с явными лимитами и политикой поверх готового драйвера. */
export interface ConfiguredStorageServer extends StorageServerPolicy {
  readonly driver: StorageDriver
}

/** Декларативная конфигурация сервера по единой DSN-ссылке (`s3://...`, `s3+http://...`, `memory://...`). */
export interface UrlConfiguredStorageServer extends StorageServerPolicy {
  readonly url: string | URL
  readonly publicBaseUrl?: string
}

export type StorageServerEntry =
  | StorageDriver
  | ConfiguredStorageServer
  | UrlConfiguredStorageServer

/** Переопределения политик на конкретный вызов (`null` / `0` принудительно снимают настройку сервера). */
export interface StorageCallOverrides {
  readonly signal?: AbortSignal
  readonly meta?: StorageRequestMeta
  readonly key?: StorageEncryptionKey | null
  readonly rate?: RateInput
  readonly concurrency?: ConcurrencyInput
}

/** Параметры сохранения файла в хранилище. */
export interface StoragePutInput extends StorageCallOverrides {
  /** Относительный POSIX-путь объекта внутри хранилища (например `uploads/video.mp4`). */
  readonly path: string
  /** Поток или буфер содержимого файла. */
  readonly body: StoragePutBody
  /** Заявленный открытый размер в байтах. */
  readonly size?: number
  /** MIME-тип файла. */
  readonly contentType?: string
  /** Метка модификации (мс от эпохи Unix). */
  readonly lastModified?: number
  /** Имя целевого сервера (`'auto'` или не указан — выбор по стратегии и лимитам). */
  readonly server?: string
  /** Разрешить нарезку файла по серверам, если он не помещается на один сервер (по умолчанию `true` для sliceable-источников). */
  readonly split?: boolean
  /** Явный список серверов, между которыми разрешено нарезать файл. */
  readonly splitServers?: readonly string[]
  /** Сначала сохранить поток во временный спул на диске (даёт точный `size` и возможность `split` для обычного `ReadableStream`). */
  readonly stageToDisk?: boolean
}

/** Параметры чтения (`head` / `lazy` / `get`). */
export interface StorageReadOptions extends StorageCallOverrides {
  readonly server?: string
}

/** Параметры потокового переноса (`copy` / `move`) между серверами хранения без буферизации в RAM. */
export interface StorageTransferInput extends StorageCallOverrides {
  /** Исходный логический путь объекта. */
  readonly path: string
  /** Целевой путь объекта (по умолчанию равен `path`). */
  readonly toPath?: string
  /** Исходный сервер (если не указан — определяется по `ledger` или `defaultServer`). */
  readonly from?: string
  /** Целевой сервер, куда перекачивается поток. */
  readonly to: string
}

/** Параметры пакетного клонирования файлов между серверами (`storage.clone`). */
export interface StorageCloneInput extends StorageCallOverrides {
  readonly from: string
  readonly to: string
  readonly prefix?: string
  readonly overwrite?: boolean
}

export interface StorageCloneReport {
  readonly from: string
  readonly to: string
  readonly clonedPaths: readonly string[]
  readonly skippedPaths: readonly string[]
  readonly bytesTransferred: number
}

/** Паспорт сохранённого объекта. */
export interface StoredObject {
  readonly path: string
  readonly server: string
  readonly size: number
  readonly storedBytes?: number
  readonly encrypted?: boolean
  readonly partsCount?: number
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
  readonly encrypted: boolean
  readonly allowSplit: boolean
  readonly limits: ServerLimits
  readonly usedBytes: number
  readonly reservedBytes: number
  readonly freeBytes: number
  readonly filesCount: number
  readonly partsCount: number
}

/** Сводный отчёт по всем серверам хранилища. */
export interface StorageReport {
  readonly servers: readonly StorageServerReport[]
}

/** Настройки HTTP-раздачи файла (`serve`). */
export interface StorageServeOptions extends StorageCallOverrides {
  readonly server?: string
  readonly cacheControl?: string
  readonly etag?: false | 'weak' | 'strong'
  /** Включить поддержку `Range` (`206 Partial Content`); по умолчанию `true`. */
  readonly acceptRanges?: boolean
  /** Отдать с `Content-Disposition: attachment` (`true` — имя из пути, строка — явное имя). */
  readonly download?: boolean | string
  /** Отдать `302`-редирект на `cdnUrl` сервера (если не задан `cdnUrl` — игнорируется с `console.error`). */
  readonly cdn?: boolean
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

export type WriteStrategy = 'priority' | 'most-free' | 'round-robin'

/** Конфигурация `createStorage`. */
export interface StorageConfig {
  /** Словарь подключённых серверов по имени (`{ local: ..., b2: ..., r2: ... }`). */
  readonly servers: Readonly<Record<string, StorageServerEntry>>
  /** Сервер по умолчанию (если не указан — первый пишущий сервер из `servers`). */
  readonly defaultServer?: string
  /** Упорядоченный пул серверов для автовыбора при записи, если `input.server` не указан. */
  readonly writePool?: readonly string[]
  /** Стратегия выбора сервера при `server: 'auto'` (по умолчанию `'priority'`). */
  readonly writeStrategy?: WriteStrategy
  /** Реестр учёта места и манифестов файлов (по умолчанию `memoryLedger()`). */
  readonly ledger?: AdaptedStorageLedger
  /** Срок жизни брони места на время загрузки (по умолчанию `1 час`). */
  readonly reservationTtlMs?: number
  /** Дисковый спул для вызовов с `stageToDisk: true` (`localSpool` из `#lib/storage/local.js`). */
  readonly spool?: StorageSpool
  /** Опциональный кэш-стор (`defineStorageStore` / `memoryStore`). */
  readonly store?: AdaptedStorageStore
  /** Опциональные технические резолверы запроса (`publicOrigin`, `resolveMeta`). */
  readonly tech?: StorageTechConfig
  /** Опциональный слушатель телеметрии (`createStorageState().onEvent`). */
  readonly state?: StorageStateListener
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
  head(path: string, options?: StorageReadOptions): Promise<StoredObject | null>
  stat(path: string): Promise<StoredFileRecord | null>
  get(path: string, options?: StorageReadOptions): Promise<ReadableStream<Uint8Array> | null>
  lazy(path: string, options?: StorageReadOptions): Promise<StreamFile | null>
  serve(path: string, request: Request, options?: StorageServeOptions): Promise<Response>
  del(path: string, options?: { server?: string }): Promise<boolean>
  copy(input: StorageTransferInput): Promise<StoredObject>
  move(input: StorageTransferInput): Promise<StoredObject>
  clone(input: StorageCloneInput): Promise<StorageCloneReport>
  report(): Promise<StorageReport>
}
