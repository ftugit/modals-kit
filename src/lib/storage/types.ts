import type { LazyContent } from '@remix-run/lazy-file'
import type { StreamFile } from './stream-file.js'

export type { LazyContent }

/** Источник байтов для записи в хранилище. */
export type StoragePutBody =
  | ReadableStream<Uint8Array>
  | Blob
  | Uint8Array
  | ArrayBuffer

/** Параметры сохранения файла в хранилище. */
export interface StoragePutInput {
  /** Относительный POSIX-путь объекта внутри хранилища (например `uploads/video.mp4`). */
  readonly path: string
  /** Поток или буфер содержимого файла. */
  readonly body: StoragePutBody
  /** Заявленный размер в байтах (проверяется при записи потока). */
  readonly size?: number
  /** MIME-тип файла. */
  readonly contentType?: string
  /** Метка модификации (мс от эпохи Unix). */
  readonly lastModified?: number
  /** Имя целевого сервера из словаря `servers` (по умолчанию `defaultServer`). */
  readonly server?: string
  /** Сигнал отмены записи (обрыв соединения удаляет временный файл). */
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

/** Контракт драйвера одного сервера хранения (`memory`, `local`, далее `webdav`/`r2`). */
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
  /** Словарь подключённых серверов по имени (`{ local: localDriver(...), ... }`). */
  readonly servers: Readonly<Record<string, StorageDriver>>
  /** Сервер по умолчанию (если не указан — первый ключ из `servers`). */
  readonly defaultServer?: string
}

/** Публичный экземпляр хранилища. */
export interface Storage {
  put(input: StoragePutInput): Promise<StoredObject>
  head(path: string, options?: { server?: string }): Promise<StoredObject | null>
  get(path: string, options?: { server?: string }): Promise<ReadableStream<Uint8Array> | null>
  lazy(path: string, options?: { server?: string }): Promise<StreamFile | null>
  serve(path: string, request: Request, options?: StorageServeOptions): Promise<Response>
  del(path: string, options?: { server?: string }): Promise<boolean>
}
