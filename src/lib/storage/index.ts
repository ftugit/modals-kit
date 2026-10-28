import { createFileResponse } from '@remix-run/response/file'
import {
  defineStorageLedger,
  memoryLedger,
  type AdaptedStorageLedger,
  type LedgerReservation,
  type ServerAllocation,
  type ServerUsageSnapshot,
  type StorageLedgerSpec,
  type StoredFileRecord,
  type StoredPart,
} from './ledger.js'
import { basenameOfStoragePath, memoryDriver, type MemoryDriverOptions } from './memory.js'
import { s3Driver } from './s3.js'
import { StreamFile } from './stream-file.js'
import type {
  ConfiguredStorageServer,
  DriverPutInput,
  DriverStoredMeta,
  LazyContent,
  ServerLimits,
  Storage,
  StorageConfig,
  StorageDriver,
  StorageProbeResult,
  StorageProbeStep,
  StoragePutBody,
  StoragePutInput,
  StorageReport,
  StorageServeOptions,
  StorageServerEntry,
  StorageServerReport,
  StorageTransferInput,
  StoredObject,
  UrlConfiguredStorageServer,
} from './types.js'

export { defineStorageLedger, memoryDriver, memoryLedger, StreamFile }
export type {
  AdaptedStorageLedger,
  ConfiguredStorageServer,
  DriverPutInput,
  DriverStoredMeta,
  LazyContent,
  LedgerReservation,
  MemoryDriverOptions,
  ServerAllocation,
  ServerLimits,
  ServerUsageSnapshot,
  Storage,
  StorageConfig,
  StorageDriver,
  StorageLedgerSpec,
  StorageProbeResult,
  StorageProbeStep,
  StoragePutBody,
  StoragePutInput,
  StorageReport,
  StorageServeOptions,
  StorageServerEntry,
  StorageServerReport,
  StorageTransferInput,
  StoredFileRecord,
  StoredObject,
  StoredPart,
  UrlConfiguredStorageServer,
}

const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/

const DEFAULT_UNBOUNDED_LIMITS: ServerLimits = {
  storageBytes: Number.MAX_SAFE_INTEGER,
  fileBytes: Number.MAX_SAFE_INTEGER,
}

const DEFAULT_RESERVATION_TTL_MS = 60 * 60 * 1000

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

export class StorageQuotaError extends Error {
  readonly code = 'storage.quota-exceeded'
  readonly server: string

  constructor(server: string, message: string) {
    super(message)
    this.name = 'StorageQuotaError'
    this.server = server
  }
}

export class StorageReadOnlyError extends Error {
  readonly code = 'storage.read-only'
  readonly server: string

  constructor(server: string) {
    super(`[storage] сервер «${server}» открыт только для чтения (readOnly: true)`)
    this.name = 'StorageReadOnlyError'
    this.server = server
  }
}

function isConfiguredEntry(entry: StorageServerEntry): entry is ConfiguredStorageServer {
  return typeof (entry as ConfiguredStorageServer).driver === 'object' && 'limits' in entry
}

function isUrlConfiguredEntry(entry: StorageServerEntry): entry is UrlConfiguredStorageServer {
  return (
    (typeof (entry as UrlConfiguredStorageServer).url === 'string' ||
      (entry as UrlConfiguredStorageServer).url instanceof URL) &&
    'limits' in entry
  )
}

function driverFromUrl(rawUrl: string | URL, publicBaseUrl?: string): StorageDriver {
  const u = rawUrl instanceof URL ? rawUrl : new URL(String(rawUrl).trim())
  const proto = u.protocol.toLowerCase()
  if (proto === 'memory:') {
    return memoryDriver({
      ...(publicBaseUrl ? { publicBaseUrl } : {}),
    })
  }
  if (proto === 's3:' || proto === 's3s:' || proto === 's3+http:' || proto === 's3+https:') {
    return s3Driver(u, {
      ...(publicBaseUrl ? { publicBaseUrl } : {}),
    })
  }
  throw new TypeError(
    `[storage] неподдерживаемая схема URL хранилища «${u.protocol}» (ожидалась s3://, s3+http:// или memory://)`,
  )
}

interface NormalizedServerSlot {
  readonly name: string
  readonly driver: StorageDriver
  readonly limits: ServerLimits
  readonly readOnly: boolean
  readonly allowSplit: boolean
}

function validateServerLimits(name: string, limits: ServerLimits): ServerLimits {
  const { storageBytes, fileBytes } = limits
  if (!Number.isFinite(storageBytes) || storageBytes <= 0) {
    throw new RangeError(`[storage] сервер «${name}»: limits.storageBytes обязан быть > 0`)
  }
  if (!Number.isFinite(fileBytes) || fileBytes <= 0) {
    throw new RangeError(`[storage] сервер «${name}»: limits.fileBytes обязан быть > 0`)
  }
  return { storageBytes, fileBytes }
}

function normalizeSlot(name: string, entry: StorageServerEntry): NormalizedServerSlot {
  if (isUrlConfiguredEntry(entry)) {
    return {
      name,
      driver: driverFromUrl(entry.url, entry.publicBaseUrl),
      limits: validateServerLimits(name, entry.limits),
      readOnly: Boolean(entry.readOnly),
      allowSplit: entry.allowSplit !== false,
    }
  }
  if (isConfiguredEntry(entry)) {
    return {
      name,
      driver: entry.driver,
      limits: validateServerLimits(name, entry.limits),
      readOnly: Boolean(entry.readOnly),
      allowSplit: entry.allowSplit !== false,
    }
  }
  return {
    name,
    driver: entry,
    limits: DEFAULT_UNBOUNDED_LIMITS,
    readOnly: false,
    allowSplit: true,
  }
}

function isPotentiallyActiveMime(contentType: string): boolean {
  const mime = contentType.split(';')[0]!.trim().toLowerCase()
  return ACTIVE_SERVE_MIME_PREFIXES.some((p) => mime === p)
}

let reservationSeq = 0
function nextReservationId(): string {
  reservationSeq = (reservationSeq + 1) % 1_000_000_000
  return `resv-${Date.now().toString(36)}-${reservationSeq.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

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

function buildPublicUrl(
  baseUrl: string | undefined,
  path: string,
  serverName: string,
  isDefaultServer: boolean,
): string | undefined {
  if (!baseUrl) return undefined
  const cleanBase = baseUrl.replace(/\/+$/, '')
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  const suffix = isDefaultServer ? '' : `?server=${encodeURIComponent(serverName)}`
  return `${cleanBase}/${encodedPath}${suffix}`
}

function contentDispositionAttachment(filename: string): string {
  const asciiFallback = filename.replace(/[^\x20-\x7e]|["\\]/g, '_') || 'download'
  const encoded = encodeURIComponent(filename)
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`
}

/**
 * Создать экземпляр мультисерверного хранилища поверх словаря серверов и реестра `ledger`.
 * Не зависит от фреймворков, `#lib/db` и `#lib/cache`.
 */
export function createStorage(config: StorageConfig): Storage {
  const initialNames = Object.keys(config.servers)
  if (initialNames.length === 0) {
    throw new TypeError('[storage] createStorage: укажите хотя бы один сервер в servers')
  }

  const slots = new Map<string, NormalizedServerSlot>()
  for (const name of initialNames) {
    slots.set(name, normalizeSlot(name, config.servers[name]!))
  }

  const defaultName =
    config.defaultServer ??
    initialNames.find((n) => !slots.get(n)!.readOnly) ??
    initialNames[0]!
  if (!slots.has(defaultName)) {
    throw new TypeError(`[storage] defaultServer «${defaultName}» отсутствует в servers`)
  }

  const customWritePool =
    config.writePool && config.writePool.length > 0 ? [...config.writePool] : null

  function currentWritePool(): readonly string[] {
    if (customWritePool) return customWritePool.filter((n) => slots.has(n))
    return [...slots.keys()].filter((n) => !slots.get(n)!.readOnly)
  }

  const ledger = config.ledger ?? memoryLedger()
  const reservationTtlMs = config.reservationTtlMs ?? DEFAULT_RESERVATION_TTL_MS

  function getSlot(name: string): NormalizedServerSlot {
    const slot = slots.get(name)
    if (!slot) {
      throw new RangeError(`[storage] неизвестный сервер «${name}»`)
    }
    return slot
  }

  async function resolveReadSlot(
    cleanPath: string,
    explicitServer?: string,
  ): Promise<NormalizedServerSlot> {
    if (explicitServer && explicitServer !== 'auto') return getSlot(explicitServer)
    const rec = await ledger.getFile(cleanPath)
    const recordedServer = rec?.parts[0]?.server
    if (recordedServer && slots.has(recordedServer)) {
      return slots.get(recordedServer)!
    }
    return getSlot(defaultName)
  }

  function toStoredObject(meta: DriverStoredMeta, slot: NormalizedServerSlot): StoredObject {
    const url = buildPublicUrl(
      slot.driver.publicBaseUrl,
      meta.path,
      slot.name,
      slot.name === defaultName,
    )
    return {
      path: meta.path,
      server: slot.name,
      size: meta.size,
      contentType: meta.contentType,
      lastModified: meta.lastModified,
      ...(url !== undefined ? { url } : {}),
    }
  }

  async function selectAndReserveSlot(
    explicitServer: string | undefined,
    reserveBytes: number,
  ): Promise<{ slot: NormalizedServerSlot; reservationId: string }> {
    const candidates =
      explicitServer && explicitServer !== 'auto'
        ? [explicitServer]
        : currentWritePool()
    if (candidates.length === 0) {
      throw new StorageReadOnlyError(defaultName)
    }

    let lastReadOnly: string | null = null
    let lastOverFileLimit: { server: string; max: number } | null = null
    let lastQuotaServer: string | null = null

    for (const candidateName of candidates) {
      const slot = getSlot(candidateName)
      if (slot.readOnly) {
        lastReadOnly = slot.name
        continue
      }
      if (reserveBytes > slot.limits.fileBytes) {
        lastOverFileLimit = { server: slot.name, max: slot.limits.fileBytes }
        continue
      }
      const resvId = nextReservationId()
      const reserved = await ledger.reserve({
        id: resvId,
        allocations: [
          {
            server: slot.name,
            bytes: reserveBytes,
            maxStorageBytes: slot.limits.storageBytes,
          },
        ],
        ttlMs: reservationTtlMs,
      })
      if (reserved) {
        return { slot, reservationId: resvId }
      }
      lastQuotaServer = slot.name
    }

    if (lastReadOnly && !lastOverFileLimit && !lastQuotaServer) {
      throw new StorageReadOnlyError(lastReadOnly)
    }
    if (lastOverFileLimit) {
      throw new RangeError(
        `[storage] размер файла (${reserveBytes} Б) превышает лимит файла сервера «${lastOverFileLimit.server}» (${lastOverFileLimit.max} Б)`,
      )
    }
    throw new StorageQuotaError(
      lastQuotaServer ?? defaultName,
      `[storage] недостаточно свободного места на сервере «${lastQuotaServer ?? defaultName}» для ${reserveBytes} Б`,
    )
  }

  return {
    get serverNames(): readonly string[] {
      return [...slots.keys()]
    },

    setServer(name: string, entry: StorageServerEntry): void {
      const cleanName = name.trim()
      if (!cleanName || cleanName === 'auto') {
        throw new RangeError(`[storage] недопустимое имя сервера «${name}»`)
      }
      slots.set(cleanName, normalizeSlot(cleanName, entry))
    },

    async removeServer(name: string): Promise<boolean> {
      if (name === defaultName) {
        throw new RangeError(`[storage] нельзя удалить сервер по умолчанию «${defaultName}»`)
      }
      if (!slots.has(name)) return false
      const snap = await ledger.usage([name])
      if ((snap[name]?.reservedBytes ?? 0) > 0) {
        throw new RangeError(
          `[storage] нельзя удалить сервер «${name}» во время активной загрузки (reservedBytes > 0)`,
        )
      }
      return slots.delete(name)
    },

    async probe(serverName: string): Promise<StorageProbeResult> {
      const slot = getSlot(serverName)
      const steps: StorageProbeStep[] = []
      const startedAt = performance.now()

      if (slot.readOnly) {
        const g0 = performance.now()
        let blocked = false
        try {
          await this.put({
            path: `_probe/ro-${Date.now().toString(36)}.bin`,
            body: new Uint8Array([1, 2, 3, 4]),
            server: slot.name,
          })
        } catch (err) {
          blocked = err instanceof StorageReadOnlyError
        }
        steps.push({
          step: 'readonly-guard',
          ok: blocked,
          durationMs: Math.round(performance.now() - g0),
          detail: blocked ? 'запись штатно отклонена (readOnly)' : 'ожидался StorageReadOnlyError',
        })

        const h0 = performance.now()
        try {
          await slot.driver.head(`_probe/ping-${Date.now().toString(36)}.bin`)
          steps.push({
            step: 'head',
            ok: true,
            durationMs: Math.round(performance.now() - h0),
            detail: 'соединение и чтение метаданных доступны',
          })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          steps.push({
            step: 'head',
            ok: false,
            durationMs: Math.round(performance.now() - h0),
            detail: msg,
          })
          return {
            server: slot.name,
            kind: slot.driver.kind,
            readOnly: true,
            ok: false,
            totalMs: Math.round(performance.now() - startedAt),
            steps,
            error: msg,
          }
        }

        const allOk = steps.every((s) => s.ok)
        return {
          server: slot.name,
          kind: slot.driver.kind,
          readOnly: true,
          ok: allOk,
          totalMs: Math.round(performance.now() - startedAt),
          steps,
          ...(allOk ? {} : { error: 'проверка readOnly не пройдена' }),
        }
      }

      const probePath = `_probe/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}.bin`
      const expected = new Uint8Array(96)
      for (let i = 0; i < expected.byteLength; i++) expected[i] = (i * 29 + 11) & 0xff

      let probeError: string | undefined
      try {
        // 1. Потоковый PUT
        const p0 = performance.now()
        await this.put({
          path: probePath,
          body: new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(expected.subarray(0, 48))
              c.enqueue(expected.subarray(48))
              c.close()
            },
          }),
          size: expected.byteLength,
          contentType: 'application/octet-stream',
          server: slot.name,
        })
        steps.push({
          step: 'put',
          ok: true,
          durationMs: Math.round(performance.now() - p0),
          detail: `${expected.byteLength} Б записано потоком`,
        })

        // 2. HEAD
        const h0 = performance.now()
        const meta = await this.head(probePath, { server: slot.name })
        const headOk = Boolean(meta && meta.size === expected.byteLength)
        steps.push({
          step: 'head',
          ok: headOk,
          durationMs: Math.round(performance.now() - h0),
          detail: headOk ? `размер подтверждён (${meta!.size} Б)` : 'объект не найден или размер искажён',
        })
        if (!headOk) throw new Error('HEAD вернул некорректные метаданные после PUT')

        // 3. Range 206 (байты 16..47)
        const r0 = performance.now()
        const res = await this.serve(
          probePath,
          new Request('http://probe.local/_probe', {
            headers: { range: 'bytes=16-47' },
          }),
          { server: slot.name },
        )
        const slice = new Uint8Array(await res.arrayBuffer())
        const want = expected.subarray(16, 48)
        let bytesMatch = res.status === 206 && slice.byteLength === want.byteLength
        if (bytesMatch) {
          for (let i = 0; i < want.byteLength; i++) {
            if (slice[i] !== want[i]) {
              bytesMatch = false
              break
            }
          }
        }
        steps.push({
          step: 'range',
          ok: bytesMatch,
          durationMs: Math.round(performance.now() - r0),
          detail: bytesMatch ? `HTTP 206 (${slice.byteLength} Б побайтно совпали)` : `статус ${res.status}`,
        })
        if (!bytesMatch) throw new Error(`Range GET не совпал (HTTP ${res.status})`)
      } catch (err) {
        probeError = err instanceof Error ? err.message : String(err)
        if (!steps.some((s) => !s.ok)) {
          steps.push({
            step: 'put',
            ok: false,
            durationMs: Math.round(performance.now() - startedAt),
            detail: probeError,
          })
        }
      } finally {
        const d0 = performance.now()
        try {
          await this.del(probePath, { server: slot.name })
          steps.push({
            step: 'delete',
            ok: true,
            durationMs: Math.round(performance.now() - d0),
            detail: 'пробный объект удалён',
          })
        } catch (delErr) {
          const msg = delErr instanceof Error ? delErr.message : String(delErr)
          probeError = probeError ?? msg
          steps.push({
            step: 'delete',
            ok: false,
            durationMs: Math.round(performance.now() - d0),
            detail: msg,
          })
        }
      }

      const ok = !probeError && steps.every((s) => s.ok)
      return {
        server: slot.name,
        kind: slot.driver.kind,
        readOnly: false,
        ok,
        totalMs: Math.round(performance.now() - startedAt),
        steps,
        ...(probeError ? { error: probeError } : {}),
      }
    },

    async put(input: StoragePutInput): Promise<StoredObject> {
      const path = normalizeStoragePath(input.path)
      const { stream, knownSize, inferredType } = bodyToStream(input.body)
      const expectedSize = input.size ?? knownSize
      if (expectedSize !== undefined && (!Number.isInteger(expectedSize) || expectedSize < 0)) {
        throw new RangeError(`[storage] некорректный размер файла: ${expectedSize}`)
      }

      const reserveBytes = expectedSize ?? 0
      const { slot, reservationId } = await selectAndReserveSlot(input.server, reserveBytes)

      const contentType =
        (input.contentType ?? inferredType ?? '').trim() || 'application/octet-stream'
      const lastModified = input.lastModified ?? Date.now()

      try {
        const meta = await slot.driver.put({
          path,
          stream,
          ...(expectedSize !== undefined ? { size: expectedSize } : {}),
          contentType,
          lastModified,
          ...(input.signal ? { signal: input.signal } : {}),
        })

        if (meta.size > slot.limits.fileBytes) {
          await slot.driver.del(path).catch(() => undefined)
          throw new RangeError(
            `[storage] записанный поток (${meta.size} Б) превысил лимит файла сервера «${slot.name}» (${slot.limits.fileBytes} Б)`,
          )
        }

        const record: StoredFileRecord = {
          path: meta.path,
          name: basenameOfStoragePath(meta.path),
          size: meta.size,
          storedBytes: meta.size,
          type: meta.contentType,
          lastModified: meta.lastModified,
          createdAt: Date.now(),
          parts: [
            {
              index: 0,
              server: slot.name,
              path: meta.path,
              plainBytes: meta.size,
              storedBytes: meta.size,
              encrypted: false,
            },
          ],
        }
        const { replaced } = await ledger.commit({ reservationId, file: record })
        // Если перезаписанный файл раньше лежал на ДРУГОМ сервере — убираем старую физическую копию
        if (replaced) {
          for (const oldPart of replaced.parts) {
            if (oldPart.server !== slot.name || oldPart.path !== meta.path) {
              const oldSlot = slots.get(oldPart.server)
              if (oldSlot && !oldSlot.readOnly) {
                await oldSlot.driver.del(oldPart.path).catch(() => undefined)
              }
            }
          }
        }

        return toStoredObject(meta, slot)
      } catch (err) {
        await ledger.release(reservationId).catch(() => undefined)
        throw err
      }
    },

    async stat(path: string): Promise<StoredFileRecord | null> {
      const clean = normalizeStoragePath(path)
      return ledger.getFile(clean)
    },

    async head(path: string, options?: { server?: string }): Promise<StoredObject | null> {
      const clean = normalizeStoragePath(path)
      const slot = await resolveReadSlot(clean, options?.server)
      const meta = await slot.driver.head(clean)
      return meta ? toStoredObject(meta, slot) : null
    },

    async lazy(path: string, options?: { server?: string }): Promise<StreamFile | null> {
      const clean = normalizeStoragePath(path)
      const slot = await resolveReadSlot(clean, options?.server)
      return slot.driver.lazy(clean)
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
      const clean = normalizeStoragePath(path)
      const file = await this.lazy(clean, options)
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
            : basenameOfStoragePath(clean)
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
      const slot = await resolveReadSlot(clean, options?.server)
      if (slot.readOnly) {
        throw new StorageReadOnlyError(slot.name)
      }
      const removed = await slot.driver.del(clean)
      const recorded = await ledger.getFile(clean)
      if (recorded && (!options?.server || recorded.parts[0]?.server === slot.name)) {
        await ledger.deleteFile(clean)
      }
      return removed
    },

    async copy(input: StorageTransferInput): Promise<StoredObject> {
      const srcPath = normalizeStoragePath(input.path)
      const dstPath = input.toPath ? normalizeStoragePath(input.toPath) : srcPath
      const srcSlot = await resolveReadSlot(srcPath, input.from)
      const dstSlot = getSlot(input.to)
      if (dstSlot.readOnly) {
        throw new StorageReadOnlyError(dstSlot.name)
      }
      if (srcSlot.name === dstSlot.name && srcPath === dstPath) {
        const meta = await srcSlot.driver.head(srcPath)
        if (!meta) throw new RangeError(`[storage] исходный файл не найден: «${srcPath}»`)
        return toStoredObject(meta, dstSlot)
      }

      const sourceFile = await srcSlot.driver.lazy(srcPath)
      if (!sourceFile) {
        throw new RangeError(
          `[storage] исходный файл «${srcPath}» не найден на сервере «${srcSlot.name}»`,
        )
      }

      return this.put({
        path: dstPath,
        body: sourceFile.stream(),
        size: sourceFile.size,
        contentType: sourceFile.type || 'application/octet-stream',
        lastModified: sourceFile.lastModified,
        server: dstSlot.name,
        ...(input.signal ? { signal: input.signal } : {}),
      })
    },

    async move(input: StorageTransferInput): Promise<StoredObject> {
      const srcPath = normalizeStoragePath(input.path)
      const dstPath = input.toPath ? normalizeStoragePath(input.toPath) : srcPath
      const srcSlot = await resolveReadSlot(srcPath, input.from)
      if (srcSlot.readOnly) {
        throw new StorageReadOnlyError(srcSlot.name)
      }
      if (srcSlot.name === input.to && srcPath === dstPath) {
        const meta = await srcSlot.driver.head(srcPath)
        if (!meta) throw new RangeError(`[storage] исходный файл не найден: «${srcPath}»`)
        return toStoredObject(meta, srcSlot)
      }

      // Если переносим тот же логический путь на другой сервер, put() уже перезапишет
      // запись в ledger и сам удалит старую физическую часть на srcSlot!
      const copied = await this.copy({
        path: srcPath,
        toPath: dstPath,
        from: srcSlot.name,
        to: input.to,
        ...(input.signal ? { signal: input.signal } : {}),
      })
      if (srcPath !== dstPath) {
        await srcSlot.driver.del(srcPath).catch(() => undefined)
        await ledger.deleteFile(srcPath)
      }
      return copied
    },

    async report(): Promise<StorageReport> {
      const currentNames = [...slots.keys()]
      const snap = await ledger.usage(currentNames)
      const serverReports: StorageServerReport[] = currentNames.map((name) => {
        const slot = slots.get(name)!
        const u = snap[name] ?? {
          usedBytes: 0,
          reservedBytes: 0,
          filesCount: 0,
          partsCount: 0,
        }
        const freeBytes = Math.max(
          0,
          slot.limits.storageBytes - u.usedBytes - u.reservedBytes,
        )
        return {
          server: name,
          kind: slot.driver.kind,
          readOnly: slot.readOnly,
          limits: slot.limits,
          usedBytes: u.usedBytes,
          reservedBytes: u.reservedBytes,
          freeBytes,
          filesCount: u.filesCount,
        }
      })
      return { servers: serverReports }
    },
  }
}
