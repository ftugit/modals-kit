// Потоковый приём HTTP `multipart/form-data` / `urlencoded` (`storage.upload`, §1.1.1 и §1.3.4 плана).
//
// Построен поверх `@remix-run/form-data-parser/future`: обработчик каждого файла вызывается
// сразу по приходу его заголовков, а `file.stream()` льётся напрямую в `storage.put(...)`
// без буферизации тела файла в оперативной памяти. 0 `node:*`, 0 фреймворков.

import {
  FormDataParseError,
  MaxFilesExceededError,
  MaxFileSizeExceededError,
  MaxHeaderSizeExceededError,
  MaxPartsExceededError,
  MaxTotalSizeExceededError,
  MultipartParseError,
  parseFormData,
} from '@remix-run/form-data-parser/future'
import { StorageConcurrencyError } from './concurrency.js'
import { StorageCryptoError, StorageHashMismatchError } from './crypto.js'
import type { StorageRequestMeta } from './store.js'
import type { StreamFile } from './stream-file.js'
import type {
  StoragePutInput,
  StorageReadOptions,
  StorageUploadFileContext,
  StorageUploadOptions,
  StorageUploadResult,
  StoredObject,
  StoredUploadedFile,
} from './types.js'

export type StorageUploadErrorCode =
  | 'UNSUPPORTED_CONTENT_TYPE'
  | 'ACCEPT_MISMATCH'
  | 'MAX_FILES_EXCEEDED'
  | 'MAX_FILE_SIZE_EXCEEDED'
  | 'PARSE_ERROR'

export class StorageUploadError extends Error {
  readonly code: StorageUploadErrorCode
  readonly status: 400 | 413 | 415 | 422
  readonly fieldName?: string
  readonly fileName?: string

  constructor(
    message: string,
    init: {
      readonly code: StorageUploadErrorCode
      readonly status: 400 | 413 | 415 | 422
      readonly fieldName?: string
      readonly fileName?: string
      readonly cause?: unknown
    },
  ) {
    super(message, init.cause !== undefined ? { cause: init.cause } : undefined)
    this.name = 'StorageUploadError'
    this.code = init.code
    this.status = init.status
    if (init.fieldName !== undefined) this.fieldName = init.fieldName
    if (init.fileName !== undefined) this.fileName = init.fileName
  }
}

export interface StorageUploadRuntimeDeps {
  put(input: StoragePutInput): Promise<StoredObject>
  lazy(path: string, options?: StorageReadOptions): Promise<StreamFile | null>
  del(path: string, options?: { server?: string }): Promise<boolean>
  readonly defaultMaxFileSize?: number
  resolveMeta?: (request: Request) => StorageRequestMeta | Promise<StorageRequestMeta>
}

function normalizeMime(raw: string): string {
  const semi = raw.indexOf(';')
  return (semi === -1 ? raw : raw.slice(0, semi)).trim().toLowerCase()
}

export function matchesUploadAccept(
  fileName: string,
  contentType: string,
  accept: readonly string[],
): boolean {
  if (accept.length === 0) return true
  const mime = normalizeMime(contentType)
  const lowerName = fileName.trim().toLowerCase()

  for (const rawRule of accept) {
    const rule = rawRule.trim().toLowerCase()
    if (!rule || rule === '*/*') return true
    if (rule.startsWith('.')) {
      if (lowerName.endsWith(rule) && lowerName.length > rule.length) return true
      continue
    }
    if (rule.endsWith('/*')) {
      const prefix = rule.slice(0, -1) // например 'image/'
      if (mime.startsWith(prefix)) return true
      continue
    }
    if (mime === rule) return true
  }
  return false
}

export function sanitizeUploadFileName(rawName: string): string {
  const base = rawName
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    ?.replace(/[\u0000-\u001f\u007f]+/g, '')
    .trim()
  if (!base || base === '.' || base === '..') return 'file'
  const cleaned = base
    .replace(/[^a-zA-Z0-9._\-\u0080-\uffff]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120)
  return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : 'file'
}

function randomShortId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  const bytes = new Uint8Array(12)
  globalThis.crypto.getRandomValues(bytes)
  let hex = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0')
  }
  return hex
}

function buildDefaultUploadPath(prefix: string, rawFileName: string): string {
  const cleanPrefix = prefix.trim().replace(/^\/+|\/+$/g, '')
  const safeName = sanitizeUploadFileName(rawFileName)
  const leaf = `${randomShortId()}-${safeName}`
  return cleanPrefix ? `${cleanPrefix}/${leaf}` : leaf
}

function enforceStreamMaxBytes(
  source: ReadableStream<Uint8Array>,
  maxFileSize: number,
  fieldName: string,
  fileName: string,
): ReadableStream<Uint8Array> {
  let seen = 0
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      reader ??= source.getReader()
      try {
        const { done, value } = await reader.read()
        if (done) {
          reader.releaseLock()
          reader = null
          controller.close()
          return
        }
        seen += value.byteLength
        if (seen > maxFileSize) {
          const active = reader
          reader = null
          await active.cancel().catch(() => undefined)
          active.releaseLock()
          controller.error(
            new StorageUploadError(
              `[storage] файл «${fileName}» (поле «${fieldName}») превысил лимит maxFileSize (${maxFileSize} Б)`,
              {
                code: 'MAX_FILE_SIZE_EXCEEDED',
                status: 413,
                fieldName,
                fileName,
              },
            ),
          )
          return
        }
        controller.enqueue(value)
      } catch (err) {
        if (reader) {
          reader.releaseLock()
          reader = null
        }
        controller.error(err)
      }
    },
    async cancel(reason) {
      if (reader) {
        const active = reader
        reader = null
        await active.cancel(reason).catch(() => undefined)
        active.releaseLock()
      }
    },
  })
}

function mapUploadException(err: unknown): unknown {
  if (
    err instanceof StorageUploadError ||
    err instanceof StorageConcurrencyError ||
    err instanceof StorageCryptoError ||
    err instanceof StorageHashMismatchError
  ) {
    return err
  }
  if (
    err instanceof Error &&
    (err.name === 'StorageQuotaError' ||
      err.name === 'StorageReadOnlyError' ||
      err.name === 'StorageServerSuspendedError' ||
      err.name === 'AbortError')
  ) {
    return err
  }
  if (err instanceof MaxFilesExceededError) {
    return new StorageUploadError(`[storage] превышено максимальное число файлов: ${err.message}`, {
      code: 'MAX_FILES_EXCEEDED',
      status: 422,
      cause: err,
    })
  }
  if (err instanceof MaxFileSizeExceededError || err instanceof MaxTotalSizeExceededError) {
    return new StorageUploadError(`[storage] превышен допустимый размер загрузки: ${err.message}`, {
      code: 'MAX_FILE_SIZE_EXCEEDED',
      status: 413,
      cause: err,
    })
  }
  if (
    err instanceof MaxHeaderSizeExceededError ||
    err instanceof MaxPartsExceededError ||
    err instanceof MultipartParseError
  ) {
    return new StorageUploadError(`[storage] ошибка разбора multipart-потока: ${err.message}`, {
      code: 'PARSE_ERROR',
      status: 400,
      cause: err,
    })
  }
  if (err instanceof FormDataParseError) {
    const isMediaType = /content-type|media type/i.test(err.message)
    return new StorageUploadError(`[storage] невозможно разобрать форму: ${err.message}`, {
      code: isMediaType ? 'UNSUPPORTED_CONTENT_TYPE' : 'PARSE_ERROR',
      status: isMediaType ? 415 : 400,
      cause: err,
    })
  }
  return err
}

function prependChunkToReader(
  firstChunk: Uint8Array,
  reader: ReadableStreamDefaultReader<Uint8Array>,
): ReadableStream<Uint8Array> {
  let sentFirst = false
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!sentFirst) {
          sentFirst = true
          controller.enqueue(firstChunk)
          return
        }
        const { done, value } = await reader.read()
        if (done) {
          reader.releaseLock()
          controller.close()
          return
        }
        controller.enqueue(value)
      } catch (err) {
        reader.releaseLock()
        controller.error(err)
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined)
      reader.releaseLock()
    },
  })
}

export async function executeStorageUpload(
  request: Request,
  options: StorageUploadOptions | undefined,
  deps: StorageUploadRuntimeDeps,
): Promise<StorageUploadResult> {
  options?.signal?.throwIfAborted()

  let meta = options?.meta
  if (!meta && deps.resolveMeta) {
    meta = await deps.resolveMeta(request)
  }

  const saved: StoredUploadedFile[] = []
  let fileIndex = 0

  const effectiveMaxFileSize = options?.maxFileSize ?? deps.defaultMaxFileSize
  // Запас для пустых `<input type="file">`: точный лимит `options.maxFiles` проверяется по реально непустым файлам
  const parserMaxFiles =
    options?.maxFiles !== undefined ? Math.max(options.maxFiles + 64, 64) : undefined
  const computedMaxTotalSize =
    options?.maxTotalSize ??
    (effectiveMaxFileSize !== undefined
      ? Math.min(
          Number.MAX_SAFE_INTEGER,
          effectiveMaxFileSize * Math.max(options?.maxFiles ?? 20, 1) + 4 * 1024 * 1024,
        )
      : undefined)

  const parserOptions = {
    ...(parserMaxFiles !== undefined ? { maxFiles: parserMaxFiles } : {}),
    ...(effectiveMaxFileSize !== undefined ? { maxFileSize: effectiveMaxFileSize } : {}),
    ...(options?.maxParts !== undefined ? { maxParts: options.maxParts } : {}),
    ...(options?.maxHeaderSize !== undefined ? { maxHeaderSize: options.maxHeaderSize } : {}),
    ...(computedMaxTotalSize !== undefined ? { maxTotalSize: computedMaxTotalSize } : {}),
  }

  try {
    const formData = await parseFormData(request, parserOptions, async (fileUpload) => {
      options?.signal?.throwIfAborted()

      // Пустой `<input type="file">` отправляет `filename=""` (в парсере `'file-upload'`) и 0 байт:
      // пропускаем пустое поле (включая возможные промежуточные 0-байтовые чанки), но сохраняем безымянный Blob, если в потоке есть байты.
      let prefetchedStream: ReadableStream<Uint8Array> | null = null
      const maybeUnnamedInput =
        fileUpload.name === '' ||
        (fileUpload.name === 'file-upload' &&
          (!fileUpload.type || fileUpload.type === 'application/octet-stream'))
      if (maybeUnnamedInput) {
        const probeReader = fileUpload.stream().getReader()
        let firstChunk: Uint8Array | null = null
        try {
          for (;;) {
            const step = await probeReader.read()
            if (step.done) break
            if (step.value.byteLength > 0) {
              firstChunk = step.value
              break
            }
          }
        } catch (err) {
          probeReader.releaseLock()
          throw err
        }
        if (!firstChunk) {
          probeReader.releaseLock()
          return null
        }
        prefetchedStream = prependChunkToReader(firstChunk, probeReader)
      }

      if (options?.maxFiles !== undefined && fileIndex >= options.maxFiles) {
        if (prefetchedStream) {
          await prefetchedStream.cancel().catch(() => undefined)
        }
        throw new StorageUploadError(
          `[storage] превышено максимальное число файлов: максимум ${options.maxFiles}`,
          {
            code: 'MAX_FILES_EXCEEDED',
            status: 422,
            fieldName: fileUpload.fieldName,
            fileName: fileUpload.name,
          },
        )
      }

      const contentType = fileUpload.type || 'application/octet-stream'
      const currentIndex = fileIndex++

      if (
        options?.accept &&
        options.accept.length > 0 &&
        !matchesUploadAccept(fileUpload.name, contentType, options.accept)
      ) {
        if (prefetchedStream) {
          await prefetchedStream.cancel().catch(() => undefined)
        }
        throw new StorageUploadError(
          `[storage] недопустимый тип файла «${fileUpload.name}» (${contentType}) в поле «${fileUpload.fieldName}»`,
          {
            code: 'ACCEPT_MISMATCH',
            status: 415,
            fieldName: fileUpload.fieldName,
            fileName: fileUpload.name,
          },
        )
      }

      const ctx: StorageUploadFileContext = {
        fieldName: fileUpload.fieldName,
        name: fileUpload.name,
        contentType,
        lastModified: fileUpload.lastModified,
        index: currentIndex,
      }

      const resolvedPath = options?.resolvePath
        ? await options.resolvePath(ctx)
        : buildDefaultUploadPath(options?.prefix ?? 'uploads', fileUpload.name)

      if (resolvedPath === null || resolvedPath === undefined) {
        if (prefetchedStream) {
          await prefetchedStream.cancel().catch(() => undefined)
        }
        return null
      }

      let bodyStream: ReadableStream<Uint8Array> = prefetchedStream ?? fileUpload.stream()
      if (options?.maxFileSize !== undefined) {
        bodyStream = enforceStreamMaxBytes(
          bodyStream,
          options.maxFileSize,
          fileUpload.fieldName,
          fileUpload.name,
        )
      }

      const stored = await deps.put({
        path: resolvedPath,
        body: bodyStream,
        contentType,
        lastModified: fileUpload.lastModified,
        ...(options?.server !== undefined ? { server: options.server } : {}),
        ...(options?.split !== undefined ? { split: options.split } : {}),
        ...(options?.splitServers !== undefined ? { splitServers: options.splitServers } : {}),
        ...(options?.stageToDisk !== undefined ? { stageToDisk: options.stageToDisk } : {}),
        ...(options?.hash !== undefined ? { hash: options.hash } : {}),
        ...(options?.expectedHash !== undefined ? { expectedHash: options.expectedHash } : {}),
        ...(options?.replicate !== undefined ? { replicate: options.replicate } : {}),
        ...(options?.key !== undefined ? { key: options.key } : {}),
        ...(options?.rate !== undefined ? { rate: options.rate } : {}),
        ...(options?.concurrency !== undefined ? { concurrency: options.concurrency } : {}),
        ...(meta !== undefined ? { meta } : {}),
        ...(options?.signal !== undefined ? { signal: options.signal } : {}),
      })

      const lazyFile = await deps.lazy(stored.path, {
        server: stored.server,
        ...(options?.key !== undefined ? { key: options.key } : {}),
        ...(options?.rate !== undefined ? { rate: options.rate } : {}),
        ...(options?.concurrency !== undefined ? { concurrency: options.concurrency } : {}),
        ...(meta !== undefined ? { meta } : {}),
        ...(options?.signal !== undefined ? { signal: options.signal } : {}),
      })

      saved.push({
        ...stored,
        fieldName: fileUpload.fieldName,
        originalName: fileUpload.name,
        file: lazyFile,
      })

      return lazyFile ?? stored.path
    })

    const mutableFields = new Map<string, string[]>()
    for (const [key, val] of formData.entries()) {
      if (typeof val === 'string') {
        const list = mutableFields.get(key)
        if (list) list.push(val)
        else mutableFields.set(key, [val])
      }
    }

    const fields: Record<string, readonly string[]> = {}
    for (const [k, v] of mutableFields) {
      fields[k] = v
    }

    return {
      files: saved,
      fields,
      formData,
    }
  } catch (rawErr) {
    if (options?.atomic !== false && saved.length > 0) {
      for (const item of saved) {
        await deps.del(item.path, { server: item.server }).catch(() => undefined)
      }
    }
    throw mapUploadException(rawErr)
  }
}
