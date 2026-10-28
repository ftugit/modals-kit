import { createFileResponse } from '@remix-run/response/file'
import { basenameOfStoragePath, memoryDriver, type MemoryDriverOptions } from './memory.js'
import { StreamFile } from './stream-file.js'
import type {
  DriverStoredMeta,
  Storage,
  StorageConfig,
  StorageDriver,
  StoragePutBody,
  StoragePutInput,
  StorageServeOptions,
  StoredObject,
} from './types.js'

export { memoryDriver, StreamFile }
export type {
  LazyContent,
  DriverPutInput,
  DriverStoredMeta,
  Storage,
  StorageConfig,
  StorageDriver,
  StoragePutBody,
  StoragePutInput,
  StorageServeOptions,
  StoredObject,
} from './types.js'
export type { MemoryDriverOptions }

const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/

/**
 * Проверить и нормализовать относительный POSIX-путь объекта хранилища.
 * Отклоняет пустые сегменты, `\`, управляющие символы, `.`, `..` и системный префикс `.storage-`.
 */
export function normalizeStoragePath(raw: string): string {
  if (typeof raw !== 'string') {
    throw new TypeError('[storage] путь объекта обязан быть строкой')
  }
  const trimmed = raw.replace(/^\/+/, '')
  if (!trimmed || trimmed.endsWith('/')) {
    throw new RangeError(`[storage] недопустимый пустой путь объекта: «${raw}»`)
  }
  if (trimmed.includes('\\') || CONTROL_CHAR_RE.test(trimmed)) {
    throw new RangeError(`[storage] недопустимые символы в пути объекта: «${raw}»`)
  }
  const parts = trimmed.split('/')
  for (const part of parts) {
    if (!part || part === '.' || part === '..') {
      throw new RangeError(`[storage] запрещённый сегмент пути объекта: «${raw}»`)
    }
  }
  if (parts[0]!.startsWith('.storage-')) {
    throw new RangeError(`[storage] зарезервированный служебный префикс пути: «${raw}»`)
  }
  return parts.join('/')
}

function bodyToStream(body: StoragePutBody): {
  stream: ReadableStream<Uint8Array>
  knownSize?: number
  inferredType?: string
} {
  if (body instanceof ReadableStream) {
    return { stream: body }
  }
  if (body instanceof Blob) {
    return {
      stream: body.stream() as ReadableStream<Uint8Array>,
      knownSize: body.size,
      ...(body.type ? { inferredType: body.type } : {}),
    }
  }
  const view =
    body instanceof Uint8Array
      ? body
      : body instanceof ArrayBuffer
        ? new Uint8Array(body)
        : null
  if (!view) {
    throw new TypeError('[storage] неподдерживаемый тип body в put()')
  }
  return {
    knownSize: view.byteLength,
    stream: new ReadableStream<Uint8Array>({
      start(controller) {
        if (view.byteLength > 0) controller.enqueue(view)
        controller.close()
      },
    }),
  }
}

function buildPublicUrl(baseUrl: string | undefined, path: string): string | undefined {
  if (!baseUrl) return undefined
  const cleanBase = baseUrl.replace(/\/+$/, '')
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  return `${cleanBase}/${encodedPath}`
}

function toStoredObject(
  meta: DriverStoredMeta,
  serverName: string,
  driver: StorageDriver,
): StoredObject {
  const url = buildPublicUrl(driver.publicBaseUrl, meta.path)
  return {
    path: meta.path,
    server: serverName,
    size: meta.size,
    contentType: meta.contentType,
    lastModified: meta.lastModified,
    ...(url !== undefined ? { url } : {}),
  }
}

const ACTIVE_SERVE_MIME_PREFIXES = [
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'text/xml',
  'application/xml',
  'text/javascript',
  'application/javascript',
  'application/ecmascript',
  'application/x-msdownload',
  'application/x-dosexec',
  'application/x-executable',
  'application/x-sh',
] as const

function isPotentiallyActiveMime(contentType: string): boolean {
  const mime = contentType.split(';')[0]!.trim().toLowerCase()
  return ACTIVE_SERVE_MIME_PREFIXES.some((p) => mime === p)
}

function contentDispositionAttachment(filename: string): string {
  const asciiFallback = filename.replace(/[^\x20-\x7e]|["\\]/g, '_') || 'download'
  const encoded = encodeURIComponent(filename)
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`
}

/**
 * Создать экземпляр хранилища поверх словаря серверов.
 * Не зависит от фреймворков, `#lib/db` и `#lib/cache`.
 */
export function createStorage(config: StorageConfig): Storage {
  const names = Object.keys(config.servers)
  if (names.length === 0) {
    throw new TypeError('[storage] createStorage: укажите хотя бы один сервер в servers')
  }
  const defaultName = config.defaultServer ?? names[0]!
  if (!config.servers[defaultName]) {
    throw new TypeError(`[storage] defaultServer «${defaultName}» отсутствует в servers`)
  }

  function resolveServer(name?: string): { name: string; driver: StorageDriver } {
    const target = name ?? defaultName
    const driver = config.servers[target]
    if (!driver) {
      throw new RangeError(`[storage] неизвестный сервер «${target}»`)
    }
    return { name: target, driver }
  }

  return {
    async put(input: StoragePutInput): Promise<StoredObject> {
      const path = normalizeStoragePath(input.path)
      const { name, driver } = resolveServer(input.server)
      const { stream, knownSize, inferredType } = bodyToStream(input.body)
      const expectedSize = input.size ?? knownSize
      if (expectedSize !== undefined && (!Number.isInteger(expectedSize) || expectedSize < 0)) {
        throw new RangeError(`[storage] некорректный размер файла: ${expectedSize}`)
      }
      const contentType =
        (input.contentType ?? inferredType ?? '').trim() || 'application/octet-stream'
      const lastModified = input.lastModified ?? Date.now()
      const meta = await driver.put({
        path,
        stream,
        ...(expectedSize !== undefined ? { size: expectedSize } : {}),
        contentType,
        lastModified,
        ...(input.signal ? { signal: input.signal } : {}),
      })
      return toStoredObject(meta, name, driver)
    },

    async head(path: string, options?: { server?: string }): Promise<StoredObject | null> {
      const clean = normalizeStoragePath(path)
      const { name, driver } = resolveServer(options?.server)
      const meta = await driver.head(clean)
      return meta ? toStoredObject(meta, name, driver) : null
    },

    async lazy(path: string, options?: { server?: string }): Promise<StreamFile | null> {
      const clean = normalizeStoragePath(path)
      const { driver } = resolveServer(options?.server)
      return driver.lazy(clean)
    },

    async get(
      path: string,
      options?: { server?: string },
    ): Promise<ReadableStream<Uint8Array> | null> {
      const file = await this.lazy(path, options)
      return file ? file.stream() : null
    },

    async serve(
      path: string,
      request: Request,
      options?: StorageServeOptions,
    ): Promise<Response> {
      const file = await this.lazy(path, options)
      if (!file) {
        return new Response('Not Found', {
          status: 404,
          headers: { 'cache-control': 'no-store' },
        })
      }
      const res = await createFileResponse(file, request, {
        acceptRanges: options?.acceptRanges ?? true,
        ...(options?.cacheControl !== undefined ? { cacheControl: options.cacheControl } : {}),
        ...(options?.etag !== undefined ? { etag: options.etag } : {}),
      })
      const headers = new Headers(res.headers)
      headers.set('x-content-type-options', 'nosniff')
      headers.set('cross-origin-resource-policy', 'same-origin')
      headers.set('content-security-policy', "default-src 'none'; sandbox")

      const forceAttachment = Boolean(options?.download) || isPotentiallyActiveMime(file.type)
      if (forceAttachment) {
        const downloadName =
          typeof options?.download === 'string' && options.download.trim()
            ? options.download.trim()
            : basenameOfStoragePath(normalizeStoragePath(path))
        headers.set('content-disposition', contentDispositionAttachment(downloadName))
      }
      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers,
      })
    },

    async del(path: string, options?: { server?: string }): Promise<boolean> {
      const clean = normalizeStoragePath(path)
      const { driver } = resolveServer(options?.server)
      return driver.del(clean)
    },
  }
}
