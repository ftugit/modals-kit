import type { LazyContent } from '@remix-run/lazy-file'
import type { BandwidthLimiter, RateInput } from './bandwidth.js'
import type {
  ConcurrencyConfig,
  ConcurrencyGate,
  ConcurrencyInput,
} from './concurrency.js'
import type { StorageEncryptionKey } from './crypto.js'
import type {
  AdaptedStorageLedger,
  StoredFileRecord,
  StoredFileStatus,
  StoredReplica,
} from './ledger.js'
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
  ConcurrencyGate,
  ConcurrencyInput,
  LazyContent,
  RateInput,
  StorageEncryptionKey,
  StorageRequestMeta,
  StorageStateListener,
  StorageTechConfig,
  StoredFileStatus,
  StoredReplica,
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
  /** Включить расчёт `SHA-256` и дедупликацию по умолчанию для загрузок на этот сервер (`false` по умолчанию). */
  readonly hash?: boolean
  /** Порог уникальных пропавших файлов (`404` при живой записи в `ledger`), после которого сервер переводится в `suspended`. */
  readonly missingThreshold?: number
  /** Инициализировать сервер сразу в отключённом (`suspended`) состоянии до ручной реактивации. */
  readonly suspended?: boolean
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

export type WriteStrategy = 'priority' | 'most-free' | 'round-robin'

/** Стратегия выбора сервера при чтении/раздаче файлов с клонированными репликами. */
export type ReadStrategy = 'primary' | 'round-robin' | 'consistent-hash'

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
  /** Разрешить перезапись существующего файла по тому же `path` (по умолчанию `true`; при `false` бросает `StorageOverwriteError`). */
  readonly overwrite?: boolean
  /**
   * Включить потоковый расчёт `SHA-256` и дедупликацию для этого файла:
   * сравниваются только те файлы, у которых хеш был включён (`hash: true` или передан `expectedHash`).
   */
  readonly hash?: boolean
  /** Ожидаемый 64-символьный hex `SHA-256` открытых байтов (проверяется на потоке и позволяет дедуплицировать до выгрузки в облако). */
  readonly expectedHash?: string
  /**
   * Серверное клонирование при записи: число копий (`2` = основной + 1 реплика из пула)
   * либо явный список имён серверов-реплик. Клиент при этом отправляет поток один раз.
   */
  readonly replicate?: number | readonly string[]
}

/** Параметры чтения (`has` / `head` / `lazy` / `get`). */
export interface StorageReadOptions extends StorageCallOverrides {
  /** Явный сервер или приоритетный список серверов для чтения с авто-фейловером. */
  readonly server?: string | readonly string[]
  /** Стратегия распределения чтения между основным сервером и репликами. */
  readonly readStrategy?: ReadStrategy
  /** Ключ привязки для `consistent-hash` (например `postId`; по умолчанию используется путь файла). */
  readonly affinityKey?: string
}

/** Параметры выборки логических файлов из реестра `storage.list()`. */
export interface StorageListOptions {
  readonly prefix?: string
  readonly limit?: number
  readonly cursor?: string
  /** Оставить только файлы, имеющие физическую часть на указанном сервере. */
  readonly server?: string
  /** При фильтрации по `server` включать также файлы, у которых на этом сервере лежит реплика (`false` по умолчанию). */
  readonly includeReplicas?: boolean
}

/** Результат выборки логических файлов `storage.list()`. */
export interface StorageListResult {
  readonly entries: readonly StoredObject[]
  readonly records: readonly StoredFileRecord[]
  readonly cursor?: string
}

/** Контекст входящего файла в `storage.upload(request, options)`. */
export interface StorageUploadFileContext {
  readonly fieldName: string
  readonly name: string
  readonly contentType: string
  readonly lastModified: number
  readonly index: number
}

/** Параметры потокового приёма `multipart/form-data` / `urlencoded` запроса (`storage.upload`). */
export interface StorageUploadOptions extends StorageCallOverrides {
  /** Целевой сервер (`'auto'` или не указан — выбор по пулу и лимитам). */
  readonly server?: string
  /** Разрешить нарезку между серверами (требует `stageToDisk: true` для потокового multipart). */
  readonly split?: boolean
  readonly splitServers?: readonly string[]
  /** Сохранить входящий multipart-поток во временный спул на диске до раскладки по серверам. */
  readonly stageToDisk?: boolean
  /** Включить потоковый `SHA-256` и дедупликацию для принимаемых файлов. */
  readonly hash?: boolean
  /** Ожидаемый `SHA-256` (для одиночного файла). */
  readonly expectedHash?: string
  /** Серверная репликация при записи (`2` или список серверов-реплик). */
  readonly replicate?: number | readonly string[]
  /** Базовый префикс для автоматически генерируемых путей (по умолчанию `'uploads'`). */
  readonly prefix?: string
  /** Пользовательский генератор пути (`null` / `undefined` — пропустить файл без сохранения). */
  readonly resolvePath?: (
    file: StorageUploadFileContext,
  ) => string | null | undefined | Promise<string | null | undefined>
  /** Допустимые MIME-маски (`'image/*'`, `'application/pdf'`) или расширения (`'.png'`). */
  readonly accept?: readonly string[]
  /** Максимальное число файлов в одном запросе. */
  readonly maxFiles?: number
  /** Максимальный вес одного файла в байтах. */
  readonly maxFileSize?: number
  /** Максимальное число частей multipart-запроса. */
  readonly maxParts?: number
  /** Максимальный размер заголовков одной multipart-части в байтах. */
  readonly maxHeaderSize?: number
  /** Максимальный суммарный вес multipart-тела в байтах. */
  readonly maxTotalSize?: number
  /** Удалять уже записанные файлы запроса при ошибке на последующих частях (по умолчанию `true`). */
  readonly atomic?: boolean
}

/** Сохранённый файл из `storage.upload(request, options)`. */
export interface StoredUploadedFile extends StoredObject {
  readonly fieldName: string
  readonly originalName: string
  /** Ленивый `StreamFile` (`0` байт в ОЗУ) поверх сохранённого объекта. */
  readonly file: StreamFile | null
}

/** Итог потокового разбора формы `storage.upload(request, options)`. */
export interface StorageUploadResult {
  readonly files: readonly StoredUploadedFile[]
  readonly fields: Readonly<Record<string, readonly string[]>>
  /** Стандартная `FormData`, где файловые поля содержат ленивые `StreamFile` (`instanceof File`). */
  readonly formData: FormData
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
  /** Вычисленный `SHA-256` открытых байтов (если для файла был включён `hash`). */
  readonly hash?: string
  /** Была ли пропущена повторная физическая запись за счёт совпадения `hash` с живым файлом. */
  readonly deduplicated?: boolean
  /** Список имён серверов, на которых лежат клонированные реплики файла. */
  readonly replicas?: readonly string[]
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
  readonly healthy: boolean
  readonly suspended: boolean
  readonly suspendedReason?: 'missing-files' | 'manual'
  readonly missingCount: number
  readonly cooldownUntil?: number
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
  readonly server?: string | readonly string[]
  /** Стратегия выбора между основным сервером и репликами. */
  readonly readStrategy?: ReadStrategy
  /** Ключ привязки для `consistent-hash` (например `postId`). */
  readonly affinityKey?: string
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

/** Контракт драйвера одного сервера хранения (`memory`, `local`, `s3`, `webdav`). */
export interface StorageDriver {
  readonly kind: string
  readonly publicBaseUrl?: string
  put(input: DriverPutInput): Promise<DriverStoredMeta>
  head(path: string): Promise<DriverStoredMeta | null>
  lazy(path: string): Promise<StreamFile | null>
  del(path: string): Promise<boolean>
  /** Опциональное нативное копирование объекта внутри одного сервера (например WebDAV `COPY`). */
  copyObject?(
    fromPath: string,
    toPath: string,
    options?: { readonly overwrite?: boolean; readonly signal?: AbortSignal },
  ): Promise<DriverStoredMeta>
}

/** Событие автоматической или ручной блокировки сервера хранения (`suspended`). */
export interface StorageServerSuspendedEvent {
  readonly server: string
  readonly reason: 'missing-files' | 'manual'
  readonly missingCount: number
  readonly suspendedAt: number
}

/** Параметры периодической сверки пропавших файлов `storage.reconcile()`. */
export interface StorageReconcileOptions {
  /** Максимальное число проблемных записей за один проход (по умолчанию `50`). */
  readonly limit?: number
  /** Ограничить опрос конкретными серверами (включая находящиеся в `suspended`). */
  readonly servers?: readonly string[]
  /** Автоматически снимать блокировку `missing-files`, когда у сервера больше не осталось пропавших частей (`missingCount === 0`). */
  readonly autoResumeServers?: boolean
  readonly signal?: AbortSignal
}

/** Отчёт одного прохода сверки `storage.reconcile()`. */
export interface StorageReconcileReport {
  readonly checkedFiles: number
  readonly restoredFiles: readonly string[]
  readonly restoredParts: number
  readonly stillMissingFiles: readonly string[]
  readonly resumedServers: readonly string[]
  readonly serverMissingCounts: Readonly<Record<string, number>>
}

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
  /** Стратегия параллельного чтения между основным сервером и репликами (по умолчанию `'primary'`). */
  readonly readStrategy?: ReadStrategy
  /** Карантин (мс) для сервера при сетевом/драйверном сбое автозаписи или чтения (по умолчанию `0`). */
  readonly cooldownMs?: number
  /** Порог уникальных пропавших файлов (`404` при живой записи в `ledger`), после которого сервер переводится в `suspended` до реактивации. */
  readonly missingThreshold?: number
  /** Хук уведомления о переводе сервера в `suspended` (например для сохранения блокировки в БД). */
  readonly onServerSuspended?: (
    event: StorageServerSuspendedEvent,
  ) => void | Promise<void>
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

/** Допустимые цели раздачи `storage.serve(target, request, options)` (§1.3.4 плана). */
export type StorageServeTarget = string | File | StoredFileRecord

/** Публичный экземпляр хранилища. */
export interface Storage {
  readonly serverNames: readonly string[]
  setServer(name: string, entry: StorageServerEntry): void
  removeServer(name: string): Promise<boolean>
  suspendServer(server: string, reason?: 'manual' | 'missing-files'): Promise<void>
  resumeServer(
    server: string,
    options?: { readonly resetMissingCount?: boolean },
  ): Promise<void>
  isServerSuspended(server: string): boolean
  reconcile(options?: StorageReconcileOptions): Promise<StorageReconcileReport>
  probe(server: string): Promise<StorageProbeResult>
  put(input: StoragePutInput): Promise<StoredObject>
  upload(request: Request, options?: StorageUploadOptions): Promise<StorageUploadResult>
  has(path: string, options?: StorageReadOptions): Promise<boolean>
  head(path: string, options?: StorageReadOptions): Promise<StoredObject | null>
  stat(path: string, options?: StorageReadOptions): Promise<StoredFileRecord | null>
  list(options?: StorageListOptions): Promise<StorageListResult>
  get(path: string, options?: StorageReadOptions): Promise<ReadableStream<Uint8Array> | null>
  lazy(path: string, options?: StorageReadOptions): Promise<StreamFile | null>
  serve(
    target: StorageServeTarget,
    request: Request,
    options?: StorageServeOptions,
  ): Promise<Response>
  del(path: string, options?: { server?: string }): Promise<boolean>
  copy(input: StorageTransferInput): Promise<StoredObject>
  move(input: StorageTransferInput): Promise<StoredObject>
  clone(input: StorageCloneInput): Promise<StorageCloneReport>
  report(): Promise<StorageReport>
}
