import { createFileResponse } from '@remix-run/response/file'
import {
  createBandwidthLimiter,
  normalizeServerRate,
  resolveCallRate,
  type BandwidthLimiter,
  type RateInput,
} from './bandwidth.js'
import {
  bindStreamLease,
  createConcurrencyGate,
  normalizeConcurrencyConfig,
  resolveCallConcurrency,
  StorageConcurrencyError,
  type ConcurrencyConfig,
  type ConcurrencyGate,
  type ConcurrencyInput,
} from './concurrency.js'
import {
  createDecryptedStreamFile,
  CRYPTO_CHUNK_PLAIN_BYTES,
  CRYPTO_CHUNK_STORED_BYTES,
  CRYPTO_HEADER_BYTES,
  CRYPTO_TAG_BYTES,
  decryptedSize,
  encryptedSize,
  encryptStream,
  StorageCryptoError,
  type StorageEncryptionKey,
} from './crypto.js'
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
import { isWebdavDsn, webdavDriver } from './webdav.js'
import type { StorageStateListener } from './state.js'
import {
  defineStorageStore,
  memoryStore,
  reportDegradedOption,
  type AdaptedStorageStore,
  type StorageRequestMeta,
  type StorageStoreSpec,
  type StorageTechConfig,
} from './store.js'
import { StreamFile } from './stream-file.js'
import type {
  ConfiguredStorageServer,
  DriverPutInput,
  DriverStoredMeta,
  LazyContent,
  ServerLimits,
  StagedSpoolFile,
  Storage,
  StorageCallOverrides,
  StorageCloneInput,
  StorageCloneReport,
  StorageConfig,
  StorageDriver,
  StorageProbeResult,
  StorageProbeStep,
  StoragePutBody,
  StoragePutInput,
  StorageReadOptions,
  StorageReport,
  StorageServeOptions,
  StorageServerEntry,
  StorageServerPolicy,
  StorageServerReport,
  StorageSpool,
  StorageTransferInput,
  StoredObject,
  UrlConfiguredStorageServer,
  WriteStrategy,
} from './types.js'

export {
  createBandwidthLimiter,
  decryptedSize,
  defineStorageLedger,
  defineStorageStore,
  encryptedSize,
  memoryDriver,
  memoryLedger,
  memoryStore,
  StorageConcurrencyError,
  StorageCryptoError,
  StreamFile,
}

export type {
  AdaptedStorageLedger,
  AdaptedStorageStore,
  BandwidthLimiter,
  ConcurrencyConfig,
  ConcurrencyInput,
  ConfiguredStorageServer,
  DriverPutInput,
  DriverStoredMeta,
  LazyContent,
  LedgerReservation,
  MemoryDriverOptions,
  RateInput,
  ServerAllocation,
  ServerLimits,
  ServerUsageSnapshot,
  StagedSpoolFile,
  Storage,
  StorageCallOverrides,
  StorageCloneInput,
  StorageCloneReport,
  StorageConfig,
  StorageDriver,
  StorageEncryptionKey,
  StorageLedgerSpec,
  StorageProbeResult,
  StorageProbeStep,
  StoragePutBody,
  StoragePutInput,
  StorageReadOptions,
  StorageReport,
  StorageRequestMeta,
  StorageServeOptions,
  StorageServerEntry,
  StorageServerPolicy,
  StorageServerReport,
  StorageSpool,
  StorageStateListener,
  StorageStoreSpec,
  StorageTechConfig,
  StorageTransferInput,
  StoredFileRecord,
  StoredObject,
  StoredPart,
  UrlConfiguredStorageServer,
  WriteStrategy,
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
  if (isWebdavDsn(rawUrl)) {
    return webdavDriver(rawUrl, {
      ...(publicBaseUrl ? { publicBaseUrl } : {}),
    })
  }
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
    `[storage] неподдерживаемая схема URL хранилища «${u.protocol}» (ожидалась s3://, webdav:// или memory://)`,
  )
}

interface NormalizedServerSlot {
  readonly name: string
  readonly driver: StorageDriver
  readonly limits: ServerLimits
  readonly readOnly: boolean
  readonly allowSplit: boolean
  readonly key: StorageEncryptionKey | null
  readonly rateLimiter: BandwidthLimiter | null
  readonly concurrencyGate: ConcurrencyGate | null
  readonly cdnUrl?: string
  readonly statTtlMs?: number
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

function normalizeSlot(
  name: string,
  entry: StorageServerEntry,
  hasStore: boolean,
): NormalizedServerSlot {
  if (isUrlConfiguredEntry(entry) || isConfiguredEntry(entry)) {
    const driver = isUrlConfiguredEntry(entry)
      ? driverFromUrl(entry.url, entry.publicBaseUrl)
      : entry.driver
    const concCfg = normalizeConcurrencyConfig(entry.concurrency)
    let statTtlMs: number | undefined
    if (entry.statTtlMs !== undefined && entry.statTtlMs > 0) {
      if (!hasStore) {
        reportDegradedOption(
          `statTtlMs (сервер «${name}»)`,
          'config.store (defineStorageStore / memoryStore)',
        )
      } else {
        statTtlMs = entry.statTtlMs
      }
    }
    const driverReadOnly = Boolean((driver as { readonly readOnly?: boolean }).readOnly)
    return {
      name,
      driver,
      limits: validateServerLimits(name, entry.limits),
      readOnly: Boolean(entry.readOnly || driverReadOnly),
      allowSplit: entry.allowSplit !== false,
      key: entry.key ?? null,
      rateLimiter: normalizeServerRate(entry.rate),
      concurrencyGate: concCfg ? createConcurrencyGate(name, concCfg) : null,
      ...(entry.cdnUrl?.trim() ? { cdnUrl: entry.cdnUrl.trim() } : {}),
      ...(statTtlMs !== undefined ? { statTtlMs } : {}),
    }
  }
  return {
    name,
    driver: entry,
    limits: DEFAULT_UNBOUNDED_LIMITS,
    readOnly: Boolean((entry as { readonly readOnly?: boolean }).readOnly),
    allowSplit: true,
    key: null,
    rateLimiter: null,
    concurrencyGate: null,
  }
}

function resolveCallKey(
  slotKey: StorageEncryptionKey | null,
  callKey: StorageEncryptionKey | null | undefined,
): StorageEncryptionKey | null {
  if (callKey === undefined) return slotKey
  return callKey
}

function sameEncryptionKey(
  a: StorageEncryptionKey | null,
  b: StorageEncryptionKey | null,
): boolean {
  if (a === null && b === null) return true
  if (a === null || b === null) return false
  if (typeof a === 'string' && typeof b === 'string') return a === b
  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    if (a.byteLength !== b.byteLength) return false
    let diff = 0
    for (let i = 0; i < a.byteLength; i++) diff |= a[i]! ^ b[i]!
    return diff === 0
  }
  return false
}

/**
 * Точный максимум открытых байт, которые поместятся в бюджет `maxStoredBytes` на сервере
 * с учётом заголовка (32 Б) и 16-байтных тегов `AES-256-GCM` каждые 64 КиБ.
 */
function maxPlainBytesForStoredBudget(maxStoredBytes: number, encrypted: boolean): number {
  if (!encrypted) return Math.max(0, Math.floor(maxStoredBytes))
  const minBytes = CRYPTO_HEADER_BYTES + CRYPTO_TAG_BYTES
  if (maxStoredBytes < minBytes) return -1
  if (maxStoredBytes === minBytes) return 0
  const body = Math.floor(maxStoredBytes) - CRYPTO_HEADER_BYTES
  const fullChunks = Math.floor(body / CRYPTO_CHUNK_STORED_BYTES)
  const rem = body % CRYPTO_CHUNK_STORED_BYTES
  const tailPlain = rem > CRYPTO_TAG_BYTES ? rem - CRYPTO_TAG_BYTES : 0
  return fullChunks * CRYPTO_CHUNK_PLAIN_BYTES + tailPlain
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

interface NormalizedInputBody {
  stream: ReadableStream<Uint8Array>
  knownSize?: number
  inferredType?: string
  sliceable?: (start: number, end: number) => ReadableStream<Uint8Array>
}

function bodyToNormalized(body: StoragePutBody): NormalizedInputBody {
  if (body instanceof ReadableStream) {
    return { stream: body }
  }
  if (body instanceof Blob) {
    return {
      stream: body.stream() as ReadableStream<Uint8Array>,
      knownSize: body.size,
      ...(body.type ? { inferredType: body.type } : {}),
      sliceable: (start, end) => body.slice(start, end).stream() as ReadableStream<Uint8Array>,
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
  const makeSliceStream = (sub: Uint8Array) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        if (sub.byteLength > 0) controller.enqueue(sub)
        controller.close()
      },
    })
  return {
    knownSize: view.byteLength,
    stream: makeSliceStream(view),
    sliceable: (start, end) => makeSliceStream(view.subarray(start, end)),
  }
}

function buildPublicUrl(
  baseUrl: string | undefined,
  path: string,
  serverName: string,
  useBarePath: boolean,
): string | undefined {
  if (!baseUrl) return undefined
  const cleanBase = baseUrl.replace(/\/+$/, '')
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  const suffix = useBarePath ? '' : `?server=${encodeURIComponent(serverName)}`
  return `${cleanBase}/${encodedPath}${suffix}`
}

function contentDispositionAttachment(filename: string): string {
  const asciiFallback = filename.replace(/[^\x20-\x7e]|["\\]/g, '_') || 'download'
  const encoded = encodeURIComponent(filename)
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`
}

function wrapDownloadTelemetry(
  stream: ReadableStream<Uint8Array>,
  stateListener: StorageStateListener | undefined,
  serverName: string,
  path: string,
): ReadableStream<Uint8Array<ArrayBuffer>> {
  if (!stateListener) {
    return stream as ReadableStream<Uint8Array<ArrayBuffer>>
  }
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  let bytes = 0
  let started = false
  let closed = false

  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    async pull(controller) {
      try {
        if (!started) {
          started = true
          stateListener({ type: 'download:start', server: serverName, path })
          reader = stream.getReader()
        }
        const { done, value } = await reader!.read()
        if (done) {
          reader!.releaseLock()
          reader = null
          if (!closed) {
            closed = true
            stateListener({ type: 'download:done', server: serverName, path, bytes })
          }
          controller.close()
          return
        }
        bytes += value.byteLength
        const copy = new Uint8Array(new ArrayBuffer(value.byteLength))
        copy.set(value)
        controller.enqueue(copy)
      } catch (err) {
        if (reader) {
          await reader.cancel(err).catch(() => undefined)
          reader.releaseLock()
          reader = null
        }
        if (!closed) {
          closed = true
          stateListener({
            type: 'download:error',
            server: serverName,
            path,
            error: err instanceof Error ? err.message : String(err),
          })
        }
        controller.error(err)
      }
    },
    async cancel(reason) {
      if (reader) {
        await reader.cancel(reason).catch(() => undefined)
        reader.releaseLock()
        reader = null
      }
      if (started && !closed) {
        closed = true
        stateListener({ type: 'download:done', server: serverName, path, bytes })
      }
    },
  })
}

/**
 * Создать экземляр мультисерверного хранилища поверх словаря серверов и реестра `ledger`.
 * Не зависит от фреймворков, `#lib/db` и `#lib/cache`.
 */
export function createStorage(config: StorageConfig): Storage {
  const initialNames = Object.keys(config.servers)
  if (initialNames.length === 0) {
    throw new TypeError('[storage] createStorage: укажите хотя бы один сервер в servers')
  }

  const store = config.store
  const tech = config.tech
  const stateListener = config.state
  const spool = config.spool
  const writeStrategy: WriteStrategy = config.writeStrategy ?? 'priority'
  let roundRobinCursor = 0

  const slots = new Map<string, NormalizedServerSlot>()
  for (const name of initialNames) {
    slots.set(name, normalizeSlot(name, config.servers[name]!, Boolean(store)))
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

  async function invalidateStatCache(cleanPath: string): Promise<void> {
    if (!store) return
    await store.delete(`stat:${cleanPath}`).catch(() => undefined)
    for (const sName of slots.keys()) {
      await store.delete(`head:${sName}:${cleanPath}`).catch(() => undefined)
    }
  }

  async function orderAutoCandidates(pool: readonly string[]): Promise<readonly string[]> {
    if (pool.length <= 1 || writeStrategy === 'priority') return pool
    if (writeStrategy === 'round-robin') {
      const start = roundRobinCursor % pool.length
      roundRobinCursor = (roundRobinCursor + 1) % 1_000_000_000
      return [...pool.slice(start), ...pool.slice(0, start)]
    }
    // writeStrategy === 'most-free'
    const snap = await ledger.usage(pool)
    return [...pool].sort((a, b) => {
      const freeA =
        getSlot(a).limits.storageBytes -
        (snap[a]?.usedBytes ?? 0) -
        (snap[a]?.reservedBytes ?? 0)
      const freeB =
        getSlot(b).limits.storageBytes -
        (snap[b]?.usedBytes ?? 0) -
        (snap[b]?.reservedBytes ?? 0)
      return freeB - freeA
    })
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

  function recordToStoredObject(record: StoredFileRecord): StoredObject {
    const primaryServer = record.parts[0]?.server ?? defaultName
    const primarySlot = slots.get(primaryServer)
    const isMultiPart = record.parts.length > 1
    const url = buildPublicUrl(
      primarySlot?.driver.publicBaseUrl,
      record.path,
      primaryServer,
      isMultiPart || primaryServer === defaultName,
    )
    return {
      path: record.path,
      server: primaryServer,
      size: record.size,
      storedBytes: record.storedBytes,
      encrypted: record.parts.some((p) => p.encrypted),
      partsCount: record.parts.length,
      contentType: record.type,
      lastModified: record.lastModified,
      ...(url !== undefined ? { url } : {}),
    }
  }

  function toStoredObject(
    meta: DriverStoredMeta,
    slot: NormalizedServerSlot,
    plainSize?: number,
    encrypted?: boolean,
  ): StoredObject {
    const url = buildPublicUrl(
      slot.driver.publicBaseUrl,
      meta.path,
      slot.name,
      slot.name === defaultName,
    )
    return {
      path: meta.path,
      server: slot.name,
      size: plainSize ?? meta.size,
      storedBytes: meta.size,
      encrypted: Boolean(encrypted),
      partsCount: 1,
      contentType: meta.contentType,
      lastModified: meta.lastModified,
      ...(url !== undefined ? { url } : {}),
    }
  }

  async function writePhysicalPart(params: {
    slot: NormalizedServerSlot
    partPath: string
    plainStream: ReadableStream<Uint8Array>
    plainSize?: number
    contentType: string
    lastModified: number
    overrides: StorageCallOverrides
  }): Promise<{ meta: DriverStoredMeta; encrypted: boolean; plainBytes: number }> {
    const { slot, partPath, plainSize, contentType, lastModified, overrides } = params
    const effectiveKey = resolveCallKey(slot.key, overrides.key)
    const limiter = resolveCallRate(slot.rateLimiter, overrides.rate)
    const gate = resolveCallConcurrency(slot.name, slot.concurrencyGate, overrides.concurrency)

    const lease = gate
      ? await gate.acquire({ meta: overrides.meta, signal: overrides.signal })
      : null
    const activeSignal = lease ? lease.signal : overrides.signal

    stateListener?.({ type: 'upload:start', server: slot.name, path: partPath })
    try {
      let seenPlain = 0
      const countedPlain = new ReadableStream<Uint8Array>({
        start(c) {
          const r = params.plainStream.getReader()
          ;(async () => {
            try {
              for (;;) {
                const { done, value } = await r.read()
                if (done) {
                  c.close()
                  break
                }
                seenPlain += value.byteLength
                c.enqueue(value)
              }
            } catch (e) {
              c.error(e)
            } finally {
              r.releaseLock()
            }
          })()
        },
      })

      let wireStream: ReadableStream<Uint8Array> =
        effectiveKey !== null
          ? encryptStream(countedPlain, effectiveKey, activeSignal)
          : countedPlain

      if (limiter) {
        wireStream = limiter.throttle(wireStream, activeSignal)
      }

      const expectedStoredSize =
        plainSize !== undefined
          ? effectiveKey !== null
            ? encryptedSize(plainSize)
            : plainSize
          : undefined

      const meta = await slot.driver.put({
        path: partPath,
        stream: wireStream,
        ...(expectedStoredSize !== undefined ? { size: expectedStoredSize } : {}),
        contentType,
        lastModified,
        ...(activeSignal ? { signal: activeSignal } : {}),
      })

      if (meta.size > slot.limits.fileBytes) {
        await slot.driver.del(partPath).catch(() => undefined)
        throw new RangeError(
          `[storage] записанный поток (${meta.size} Б) превысил лимит файла сервера «${slot.name}» (${slot.limits.fileBytes} Б)`,
        )
      }

      stateListener?.({
        type: 'upload:done',
        server: slot.name,
        path: partPath,
        bytes: meta.size,
      })

      return {
        meta,
        encrypted: effectiveKey !== null,
        plainBytes: plainSize ?? seenPlain,
      }
    } catch (err) {
      stateListener?.({
        type: 'upload:error',
        server: slot.name,
        path: partPath,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    } finally {
      lease?.release()
    }
  }

  function wrapSlotReadControls(
    rawStream: ReadableStream<Uint8Array>,
    slot: NormalizedServerSlot,
    partPath: string,
    overrides?: StorageCallOverrides,
  ): ReadableStream<Uint8Array<ArrayBuffer>> {
    const limiter = resolveCallRate(slot.rateLimiter, overrides?.rate)
    const gate = resolveCallConcurrency(
      slot.name,
      slot.concurrencyGate,
      overrides?.concurrency,
    )

    if (!gate && !limiter && !stateListener) {
      return rawStream as ReadableStream<Uint8Array<ArrayBuffer>>
    }

    let initialized: ReadableStreamDefaultReader<Uint8Array> | null = null
    return new ReadableStream<Uint8Array<ArrayBuffer>>({
      async pull(controller) {
        try {
          if (!initialized) {
            let stream: ReadableStream<Uint8Array> = rawStream
            if (gate) {
              const lease = await gate.acquire({
                meta: overrides?.meta,
                signal: overrides?.signal,
              })
              if (limiter) {
                stream = limiter.throttle(stream, lease.signal)
              }
              stream = bindStreamLease(stream, lease)
            } else if (limiter) {
              stream = limiter.throttle(stream, overrides?.signal)
            }
            stream = wrapDownloadTelemetry(stream, stateListener, slot.name, partPath)
            initialized = stream.getReader()
          }

          const { done, value } = await initialized.read()
          if (done) {
            initialized.releaseLock()
            initialized = null
            controller.close()
            return
          }
          const copy = new Uint8Array(new ArrayBuffer(value.byteLength))
          copy.set(value)
          controller.enqueue(copy)
        } catch (err) {
          if (initialized) {
            await initialized.cancel(err).catch(() => undefined)
            initialized.releaseLock()
            initialized = null
          }
          controller.error(err)
        }
      },
      async cancel(reason) {
        if (initialized) {
          await initialized.cancel(reason).catch(() => undefined)
          initialized.releaseLock()
          initialized = null
        }
      },
    })
  }

  async function openPartPlainFile(
    part: StoredPart,
    logicalType: string,
    logicalLastModified: number,
    overrides?: StorageCallOverrides,
  ): Promise<StreamFile | null> {
    const slot = getSlot(part.server)
    const rawFile = await slot.driver.lazy(part.path)
    if (!rawFile) return null

    // Оборачиваем чтение сырого потока в лимитеры rate + concurrency + телеметрию сервера
    const controlledRaw = new StreamFile(
      {
        byteLength: rawFile.size,
        stream(start = 0, end = rawFile.size) {
          return wrapSlotReadControls(
            rawFile.slice(start, end).stream(),
            slot,
            part.path,
            overrides,
          )
        },
      },
      rawFile.name,
      { type: logicalType, lastModified: logicalLastModified },
    )

    if (!part.encrypted) {
      return controlledRaw
    }

    const effectiveKey = resolveCallKey(slot.key, overrides?.key)
    if (effectiveKey === null) {
      throw new StorageCryptoError(
        `[storage/crypto] часть «${part.path}» на сервере «${slot.name}» зашифрована, но ключ расшифровки не задан`,
      )
    }
    return createDecryptedStreamFile(controlledRaw, effectiveKey, {
      plainSize: part.plainBytes,
      fileName: basenameOfStoragePath(part.path),
      contentType: logicalType,
      lastModified: logicalLastModified,
    })
  }

  function assembleMultiPartStreamFile(
    record: StoredFileRecord,
    overrides?: StorageCallOverrides,
  ): StreamFile {
    const totalPlain = record.size
    const partSpans = record.parts.map((part, idx) => {
      const start = record.parts
        .slice(0, idx)
        .reduce((acc, p) => acc + p.plainBytes, 0)
      return { part, start, end: start + part.plainBytes }
    })

    return new StreamFile(
      {
        byteLength: totalPlain,
        stream(reqStart = 0, reqEnd = totalPlain): ReadableStream<Uint8Array<ArrayBuffer>> {
          const boundedStart = Math.max(0, Math.min(reqStart, totalPlain))
          const boundedEnd = Math.max(boundedStart, Math.min(reqEnd, totalPlain))
          if (boundedStart >= boundedEnd) {
            return new ReadableStream<Uint8Array<ArrayBuffer>>({
              start(c) {
                c.close()
              },
            })
          }

          const touched = partSpans.filter(
            (span) => span.end > boundedStart && span.start < boundedEnd,
          )
          let spanIdx = 0
          let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null

          return new ReadableStream<Uint8Array<ArrayBuffer>>({
            async pull(controller) {
              try {
                for (;;) {
                  if (!activeReader) {
                    if (spanIdx >= touched.length) {
                      controller.close()
                      return
                    }
                    const current = touched[spanIdx]!
                    spanIdx += 1
                    const partFile = await openPartPlainFile(
                      current.part,
                      record.type,
                      record.lastModified,
                      overrides,
                    )
                    if (!partFile) {
                      throw new Error(
                        `[storage] физическая часть #${current.part.index} («${current.part.path}») отсутствует на сервере «${current.part.server}»`,
                      )
                    }
                    const localStart = Math.max(0, boundedStart - current.start)
                    const localEnd = Math.min(
                      current.part.plainBytes,
                      boundedEnd - current.start,
                    )
                    activeReader = partFile.slice(localStart, localEnd).stream().getReader()
                  }

                  const { done, value } = await activeReader.read()
                  if (done) {
                    activeReader.releaseLock()
                    activeReader = null
                    continue
                  }
                  const copy = new Uint8Array(new ArrayBuffer(value.byteLength))
                  copy.set(value)
                  controller.enqueue(copy)
                  return
                }
              } catch (err) {
                if (activeReader) {
                  await activeReader.cancel(err).catch(() => undefined)
                  activeReader.releaseLock()
                  activeReader = null
                }
                controller.error(err)
              }
            },
            async cancel(reason) {
              if (activeReader) {
                await activeReader.cancel(reason).catch(() => undefined)
                activeReader.releaseLock()
                activeReader = null
              }
            },
          })
        },
      },
      record.name,
      { type: record.type, lastModified: record.lastModified },
    )
  }

  interface PlannedSplitPart {
    readonly index: number
    readonly slot: NormalizedServerSlot
    readonly partPath: string
    readonly plainOffset: number
    readonly plainBytes: number
    readonly storedBytes: number
    readonly encrypted: boolean
  }

  async function tryPlanAndReserveSplit(params: {
    cleanPath: string
    totalPlainBytes: number
    candidates: readonly string[]
    callKey: StorageEncryptionKey | null | undefined
  }): Promise<{ parts: readonly PlannedSplitPart[]; reservationId: string } | null> {
    const splitPool = params.candidates
      .map((n) => getSlot(n))
      .filter((s) => !s.readOnly && s.allowSplit)
    if (splitPool.length === 0) return null

    const snap = await ledger.usage(splitPool.map((s) => s.name))
    let remainingPlain = params.totalPlainBytes
    let offset = 0
    const planned: PlannedSplitPart[] = []
    const perServerReserved = new Map<string, number>()

    for (const slot of splitPool) {
      if (remainingPlain <= 0) break
      const u = snap[slot.name] ?? {
        usedBytes: 0,
        reservedBytes: 0,
        filesCount: 0,
        partsCount: 0,
      }
      const alreadyPlannedHere = perServerReserved.get(slot.name) ?? 0
      let freeStorage =
        slot.limits.storageBytes - u.usedBytes - u.reservedBytes - alreadyPlannedHere
      const encrypted = resolveCallKey(slot.key, params.callKey) !== null

      // На одном сервере тоже можно разместить несколько частей, если позволяет storageBytes, а упёрлись в fileBytes
      while (remainingPlain > 0 && freeStorage > 0) {
        const storedBudget = Math.min(slot.limits.fileBytes, freeStorage)
        const maxPlain = maxPlainBytesForStoredBudget(storedBudget, encrypted)
        if (maxPlain <= 0) break

        const takePlain = Math.min(remainingPlain, maxPlain)
        const takeStored = encrypted ? encryptedSize(takePlain) : takePlain
        const idx = planned.length
        planned.push({
          index: idx,
          slot,
          partPath: `${params.cleanPath}.part.${idx}`,
          plainOffset: offset,
          plainBytes: takePlain,
          storedBytes: takeStored,
          encrypted,
        })
        offset += takePlain
        remainingPlain -= takePlain
        freeStorage -= takeStored
        perServerReserved.set(
          slot.name,
          (perServerReserved.get(slot.name) ?? 0) + takeStored,
        )
      }
    }

    if (remainingPlain > 0 || planned.length === 0) {
      return null
    }

    const allocations: ServerAllocation[] = [...perServerReserved.entries()].map(
      ([serverName, bytes]) => ({
        server: serverName,
        bytes,
        maxStorageBytes: getSlot(serverName).limits.storageBytes,
      }),
    )

    const resvId = nextReservationId()
    const reserved = await ledger.reserve({
      id: resvId,
      allocations,
      ttlMs: reservationTtlMs,
    })
    if (!reserved) return null
    return { parts: planned, reservationId: resvId }
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
      slots.set(cleanName, normalizeSlot(cleanName, entry, Boolean(store)))
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
          split: false,
        })
        steps.push({
          step: 'put',
          ok: true,
          durationMs: Math.round(performance.now() - p0),
          detail: `${expected.byteLength} Б записано потоком${slot.key ? ' (AES-256-GCM)' : ''}`,
        })

        const h0 = performance.now()
        const meta = await this.head(probePath, { server: slot.name })
        const headOk = Boolean(meta && meta.size === expected.byteLength)
        steps.push({
          step: 'head',
          ok: headOk,
          durationMs: Math.round(performance.now() - h0),
          detail: headOk
            ? `размер подтверждён (${meta!.size} Б)`
            : 'объект не найден или размер искажён',
        })
        if (!headOk) throw new Error('HEAD вернул некорректные метаданные после PUT')

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
          detail: bytesMatch
            ? `HTTP 206 (${slice.byteLength} Б побайтно совпали)`
            : `статус ${res.status}`,
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
      let normalized = bodyToNormalized(input.body)
      let staged: StagedSpoolFile | null = null

      if (input.stageToDisk) {
        if (!spool) {
          reportDegradedOption(
            'stageToDisk: true',
            'config.spool (например localSpool из #lib/storage/local.js)',
          )
        } else {
          staged = await spool.stage(normalized.stream, input.signal)
          normalized = {
            stream: staged.file.stream(),
            knownSize: staged.size,
            ...(normalized.inferredType ? { inferredType: normalized.inferredType } : {}),
            sliceable: (start, end) => staged!.file.slice(start, end).stream(),
          }
        }
      }

      try {
        const expectedPlainSize = input.size ?? normalized.knownSize
        if (
          expectedPlainSize !== undefined &&
          (!Number.isInteger(expectedPlainSize) || expectedPlainSize < 0)
        ) {
          throw new RangeError(`[storage] некорректный размер файла: ${expectedPlainSize}`)
        }

        if (input.split === true) {
          if (expectedPlainSize === undefined) {
            throw new RangeError(
              '[storage] нарезка файла (split) невозможна для потока без известного size — передайте Blob/File или включите stageToDisk: true',
            )
          }
          if (!normalized.sliceable) {
            throw new RangeError(
              '[storage] нарезка файла (split) требует источник с чтением со смещения (Blob/File/StreamFile) или stageToDisk: true',
            )
          }
        }

        const contentType =
          (input.contentType ?? normalized.inferredType ?? '').trim() ||
          'application/octet-stream'
        const lastModified = input.lastModified ?? Date.now()

        const candidates =
          input.server && input.server !== 'auto'
            ? [input.server]
            : await orderAutoCandidates(currentWritePool())

        if (candidates.length === 0) {
          throw new StorageReadOnlyError(defaultName)
        }

        // Проверяем, требуется ли принудительная нарезка (явные splitServers с split: true)
        const forceExplicitSplit =
          input.split === true &&
          input.splitServers !== undefined &&
          input.splitServers.length > 0

        let lastReadOnly: string | null = null
        let lastOverFileLimit: { server: string; max: number; needed: number } | null = null
        let lastQuotaServer: string | null = null

        // 1. Попытка уложить файл целиком на один подходящий сервер (если не запрошен явный splitServers)
        if (!forceExplicitSplit) {
          for (const candidateName of candidates) {
            const slot = getSlot(candidateName)
            if (slot.readOnly) {
              lastReadOnly = slot.name
              continue
            }
            const effectiveKey = resolveCallKey(slot.key, input.key)
            const neededStored =
              expectedPlainSize !== undefined
                ? effectiveKey !== null
                  ? encryptedSize(expectedPlainSize)
                  : expectedPlainSize
                : 0

            if (neededStored > slot.limits.fileBytes) {
              lastOverFileLimit = {
                server: slot.name,
                max: slot.limits.fileBytes,
                needed: neededStored,
              }
              continue
            }

            const reservationId = nextReservationId()
            const reserved = await ledger.reserve({
              id: reservationId,
              allocations: [
                {
                  server: slot.name,
                  bytes: neededStored,
                  maxStorageBytes: slot.limits.storageBytes,
                },
              ],
              ttlMs: reservationTtlMs,
            })
            if (!reserved) {
              lastQuotaServer = slot.name
              continue
            }

            try {
              const written = await writePhysicalPart({
                slot,
                partPath: path,
                plainStream: normalized.stream,
                ...(expectedPlainSize !== undefined ? { plainSize: expectedPlainSize } : {}),
                contentType,
                lastModified,
                overrides: input,
              })

              const record: StoredFileRecord = {
                path: written.meta.path,
                name: basenameOfStoragePath(written.meta.path),
                size: written.plainBytes,
                storedBytes: written.meta.size,
                type: written.meta.contentType,
                lastModified: written.meta.lastModified,
                createdAt: Date.now(),
                parts: [
                  {
                    index: 0,
                    server: slot.name,
                    path: written.meta.path,
                    plainBytes: written.plainBytes,
                    storedBytes: written.meta.size,
                    encrypted: written.encrypted,
                  },
                ],
              }
              const { replaced } = await ledger.commit({ reservationId, file: record })
              await invalidateStatCache(path)
              if (replaced) {
                for (const oldPart of replaced.parts) {
                  if (oldPart.server !== slot.name || oldPart.path !== written.meta.path) {
                    const oldSlot = slots.get(oldPart.server)
                    if (oldSlot && !oldSlot.readOnly) {
                      await oldSlot.driver.del(oldPart.path).catch(() => undefined)
                    }
                  }
                }
              }

              return recordToStoredObject(record)
            } catch (err) {
              await ledger.release(reservationId).catch(() => undefined)
              throw err
            }
          }
        }

        // 2. Файл не поместился на один сервер (или явно запрошена нарезка splitServers):
        //    нарезка разрешена только при известном size и sliceable-источнике (§1.1 п.5)!
        const canSplit =
          input.split !== false &&
          expectedPlainSize !== undefined &&
          normalized.sliceable !== undefined

        if (!canSplit && input.split === true && expectedPlainSize === undefined) {
          throw new RangeError(
            '[storage] нарезка файла (split) невозможна для потока без известного size — передайте Blob/File или включите stageToDisk: true',
          )
        }
        if (!canSplit && input.split === true && !normalized.sliceable) {
          throw new RangeError(
            '[storage] нарезка файла (split) требует источник с чтением со смещения (Blob/File/StreamFile) или stageToDisk: true',
          )
        }

        if (canSplit) {
          const splitCandidates =
            input.splitServers && input.splitServers.length > 0
              ? input.splitServers
              : candidates
          const splitPlan = await tryPlanAndReserveSplit({
            cleanPath: path,
            totalPlainBytes: expectedPlainSize!,
            candidates: splitCandidates,
            callKey: input.key,
          })

          if (splitPlan) {
            const writtenParts: StoredPart[] = []
            try {
              for (const p of splitPlan.parts) {
                const sliceStream = normalized.sliceable!(
                  p.plainOffset,
                  p.plainOffset + p.plainBytes,
                )
                const w = await writePhysicalPart({
                  slot: p.slot,
                  partPath: p.partPath,
                  plainStream: sliceStream,
                  plainSize: p.plainBytes,
                  contentType: 'application/octet-stream',
                  lastModified,
                  overrides: input,
                })
                writtenParts.push({
                  index: p.index,
                  server: p.slot.name,
                  path: w.meta.path,
                  plainBytes: w.plainBytes,
                  storedBytes: w.meta.size,
                  encrypted: w.encrypted,
                })
              }

              const totalStored = writtenParts.reduce((acc, x) => acc + x.storedBytes, 0)
              const record: StoredFileRecord = {
                path,
                name: basenameOfStoragePath(path),
                size: expectedPlainSize!,
                storedBytes: totalStored,
                type: contentType,
                lastModified,
                createdAt: Date.now(),
                parts: writtenParts,
              }
              const { replaced } = await ledger.commit({
                reservationId: splitPlan.reservationId,
                file: record,
              })
              await invalidateStatCache(path)
              if (replaced) {
                const newKeys = new Set(writtenParts.map((wp) => `${wp.server}:${wp.path}`))
                for (const oldPart of replaced.parts) {
                  if (!newKeys.has(`${oldPart.server}:${oldPart.path}`)) {
                    const oldSlot = slots.get(oldPart.server)
                    if (oldSlot && !oldSlot.readOnly) {
                      await oldSlot.driver.del(oldPart.path).catch(() => undefined)
                    }
                  }
                }
              }
              return recordToStoredObject(record)
            } catch (err) {
              for (const wp of writtenParts) {
                const s = slots.get(wp.server)
                if (s && !s.readOnly) {
                  await s.driver.del(wp.path).catch(() => undefined)
                }
              }
              await ledger.release(splitPlan.reservationId).catch(() => undefined)
              throw err
            }
          }
        }

        if (lastReadOnly && !lastOverFileLimit && !lastQuotaServer) {
          throw new StorageReadOnlyError(lastReadOnly)
        }
        if (lastOverFileLimit) {
          throw new RangeError(
            `[storage] размер файла (${lastOverFileLimit.needed} Б) превышает лимит файла сервера «${lastOverFileLimit.server}» (${lastOverFileLimit.max} Б)`,
          )
        }
        throw new StorageQuotaError(
          lastQuotaServer ?? defaultName,
          `[storage] недостаточно свободного места на серверах для сохранения «${path}»`,
        )
      } finally {
        if (staged) {
          await staged.cleanup()
        }
      }
    },

    async stat(path: string): Promise<StoredFileRecord | null> {
      const clean = normalizeStoragePath(path)
      if (store) {
        const cached = await store.get<StoredFileRecord>(`stat:${clean}`)
        if (cached) return cached
      }
      const rec = await ledger.getFile(clean)
      if (rec && store) {
        const slot = slots.get(rec.parts[0]?.server ?? '')
        if (slot?.statTtlMs) {
          await store.set(`stat:${clean}`, rec, { ttlMs: slot.statTtlMs })
        }
      }
      return rec
    },

    async head(path: string, options?: StorageReadOptions): Promise<StoredObject | null> {
      const clean = normalizeStoragePath(path)
      if (!options?.server || options.server === 'auto') {
        const rec = await this.stat(clean)
        if (rec) {
          if (rec.parts.length > 1) return recordToStoredObject(rec)
          const single = rec.parts[0]!
          const s = slots.get(single.server)
          if (s) {
            const exists = await s.driver.head(single.path)
            return exists ? recordToStoredObject(rec) : null
          }
        }
      }

      const slot = await resolveReadSlot(clean, options?.server)
      const replicaRec =
        options?.server && options.server !== 'auto'
          ? await ledger.getFile(`@replica:${slot.name}:${clean}`)
          : null

      if (store && slot.statTtlMs) {
        const cacheKey = `head:${slot.name}:${clean}`
        const cached = await store.get<StoredObject>(cacheKey)
        if (cached) return cached
        const meta = await slot.driver.head(clean)
        if (!meta) return null
        if (replicaRec && replicaRec.parts[0]) {
          const built = toStoredObject(
            meta,
            slot,
            replicaRec.size,
            replicaRec.parts[0].encrypted,
          )
          await store.set(cacheKey, built, { ttlMs: slot.statTtlMs })
          return built
        }
        const effectiveKey = resolveCallKey(slot.key, options?.key)
        const plain = effectiveKey !== null ? decryptedSize(meta.size) : meta.size
        const built = toStoredObject(meta, slot, plain, effectiveKey !== null)
        await store.set(cacheKey, built, { ttlMs: slot.statTtlMs })
        return built
      }

      const meta = await slot.driver.head(clean)
      if (!meta) return null
      if (replicaRec && replicaRec.parts[0]) {
        return toStoredObject(meta, slot, replicaRec.size, replicaRec.parts[0].encrypted)
      }
      const effectiveKey = resolveCallKey(slot.key, options?.key)
      const plain = effectiveKey !== null ? decryptedSize(meta.size) : meta.size
      return toStoredObject(meta, slot, plain, effectiveKey !== null)
    },

    async lazy(path: string, options?: StorageReadOptions): Promise<StreamFile | null> {
      const clean = normalizeStoragePath(path)
      const rec = await ledger.getFile(clean)

      if (rec && (!options?.server || options.server === 'auto')) {
        if (rec.parts.length > 1) {
          return assembleMultiPartStreamFile(rec, options)
        }
        const single = rec.parts[0]
        if (single && slots.has(single.server)) {
          return openPartPlainFile(single, rec.type, rec.lastModified, options)
        }
      }

      const slot = await resolveReadSlot(clean, options?.server)
      if (rec && rec.parts.length === 1 && rec.parts[0]!.server === slot.name) {
        return openPartPlainFile(rec.parts[0]!, rec.type, rec.lastModified, options)
      }
      const replicaRec = await ledger.getFile(`@replica:${slot.name}:${clean}`)
      if (replicaRec && replicaRec.parts[0]) {
        return openPartPlainFile(
          replicaRec.parts[0],
          replicaRec.type,
          replicaRec.lastModified,
          options,
        )
      }

      const raw = await slot.driver.lazy(clean)
      if (!raw) return null

      const controlledRaw = new StreamFile(
        {
          byteLength: raw.size,
          stream(start = 0, end = raw.size) {
            return wrapSlotReadControls(raw.slice(start, end).stream(), slot, clean, options)
          },
        },
        raw.name,
        { type: raw.type, lastModified: raw.lastModified },
      )

      const effectiveKey = resolveCallKey(slot.key, options?.key)
      if (effectiveKey !== null) {
        return createDecryptedStreamFile(controlledRaw, effectiveKey)
      }
      return controlledRaw
    },

    async get(
      path: string,
      options?: StorageReadOptions,
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
      let meta = options?.meta
      if (!meta && tech?.resolveMeta) {
        meta = await tech.resolveMeta(request)
      }
      const effectiveOptions: StorageServeOptions = {
        ...options,
        ...(meta ? { meta } : {}),
      }

      if (effectiveOptions.cdn) {
        const rec = await ledger.getFile(clean)
        const slot = await resolveReadSlot(clean, effectiveOptions.server)
        const isMultiPart = Boolean(rec && rec.parts.length > 1)
        const isEncrypted =
          Boolean(rec?.parts.some((p) => p.encrypted)) ||
          resolveCallKey(slot.key, effectiveOptions.key) !== null

        if (!slot.cdnUrl) {
          reportDegradedOption(
            `cdn: true (сервер «${slot.name}»)`,
            `cdnUrl в конфигурации сервера «${slot.name}»`,
          )
        } else if (isMultiPart || isEncrypted) {
          reportDegradedOption(
            `cdn: true («${clean}»)`,
            'одночастный незашифрованный объект (зашифрованные и нарезанные файлы отдаются напрямую)',
          )
        } else {
          const encodedPath = clean.split('/').map(encodeURIComponent).join('/')
          const targetUrl = `${slot.cdnUrl.replace(/\/+$/, '')}/${encodedPath}`
          return new Response(null, {
            status: 302,
            headers: {
              location: targetUrl,
              'cache-control': effectiveOptions.cacheControl ?? 'private, max-age=60',
            },
          })
        }
      }

      try {
        const file = await this.lazy(clean, effectiveOptions)
        if (!file) {
          return new Response('Not Found', {
            status: 404,
            headers: { 'cache-control': 'no-store' },
          })
        }
        const res = await createFileResponse(file, request, {
          acceptRanges: effectiveOptions.acceptRanges ?? true,
          ...(effectiveOptions.cacheControl !== undefined
            ? { cacheControl: effectiveOptions.cacheControl }
            : {}),
          ...(effectiveOptions.etag !== undefined ? { etag: effectiveOptions.etag } : {}),
        })

        // Проверяем не сработал ли лимит concurrency при открытии потока (для мгновенного ответа 429 до отправки заголовков)
        if (res.body && (request.method === 'GET' || !request.method)) {
          const slot = await resolveReadSlot(clean, effectiveOptions.server)
          const gate = resolveCallConcurrency(
            slot.name,
            slot.concurrencyGate,
            effectiveOptions.concurrency,
          )
          if (gate && gate.config.mode === 'reject') {
            // Прогрев первого чанка обнаруживает переполнение пула ДО возврата 200/206 клиенту!
            const reader = res.body.getReader()
            const first = await reader.read()
            const reassembled = new ReadableStream<Uint8Array>({
              start(c) {
                if (!first.done && first.value) c.enqueue(first.value)
                else {
                  reader.releaseLock()
                  c.close()
                }
              },
              async pull(c) {
                const next = await reader.read()
                if (next.done) {
                  reader.releaseLock()
                  c.close()
                } else {
                  c.enqueue(next.value)
                }
              },
              async cancel(reason) {
                await reader.cancel(reason).catch(() => undefined)
                reader.releaseLock()
              },
            })

            const headers = new Headers(res.headers)
            headers.set('x-content-type-options', 'nosniff')
            headers.set('cross-origin-resource-policy', 'same-origin')
            headers.set('content-security-policy', "default-src 'none'; sandbox")

            const forceAttachment =
              Boolean(effectiveOptions.download) || isPotentiallyActiveMime(file.type)
            if (forceAttachment) {
              const downloadName =
                typeof effectiveOptions.download === 'string' &&
                effectiveOptions.download.trim()
                  ? effectiveOptions.download.trim()
                  : basenameOfStoragePath(clean)
              headers.set('content-disposition', contentDispositionAttachment(downloadName))
            }
            return new Response(reassembled, {
              status: res.status,
              statusText: res.statusText,
              headers,
            })
          }
        }

        const headers = new Headers(res.headers)
        headers.set('x-content-type-options', 'nosniff')
        headers.set('cross-origin-resource-policy', 'same-origin')
        headers.set('content-security-policy', "default-src 'none'; sandbox")

        const forceAttachment =
          Boolean(effectiveOptions.download) || isPotentiallyActiveMime(file.type)
        if (forceAttachment) {
          const downloadName =
            typeof effectiveOptions.download === 'string' &&
            effectiveOptions.download.trim()
              ? effectiveOptions.download.trim()
              : basenameOfStoragePath(clean)
          headers.set('content-disposition', contentDispositionAttachment(downloadName))
        }
        return new Response(res.body, {
          status: res.status,
          statusText: res.statusText,
          headers,
        })
      } catch (err) {
        if (err instanceof StorageConcurrencyError) {
          return new Response('Too Many Concurrent Streams', {
            status: 429,
            headers: {
              'cache-control': 'no-store',
              'retry-after': '1',
            },
          })
        }
        throw err
      }
    },

    async del(path: string, options?: { server?: string }): Promise<boolean> {
      const clean = normalizeStoragePath(path)
      const recorded = await ledger.getFile(clean)

      if (recorded && (!options?.server || options.server === 'auto')) {
        for (const p of recorded.parts) {
          const s = slots.get(p.server)
          if (s?.readOnly) throw new StorageReadOnlyError(s.name)
        }
        let anyRemoved = false
        for (const p of recorded.parts) {
          const s = slots.get(p.server)
          if (s) {
            const ok = await s.driver.del(p.path)
            if (ok) anyRemoved = true
          }
        }
        await ledger.deleteFile(clean)
        for (const serverName of slots.keys()) {
          const repKey = `@replica:${serverName}:${clean}`
          const rep = await ledger.getFile(repKey)
          if (rep) {
            const s = slots.get(serverName)
            if (s && !s.readOnly) {
              await s.driver.del(clean).catch(() => undefined)
            }
            await ledger.deleteFile(repKey)
          }
        }
        await invalidateStatCache(clean)
        return anyRemoved
      }

      const slot = await resolveReadSlot(clean, options?.server)
      if (slot.readOnly) {
        throw new StorageReadOnlyError(slot.name)
      }
      const removed = await slot.driver.del(clean)
      if (recorded && recorded.parts.length === 1 && recorded.parts[0]?.server === slot.name) {
        await ledger.deleteFile(clean)
      }
      await ledger.deleteFile(`@replica:${slot.name}:${clean}`)
      await invalidateStatCache(clean)
      return removed
    },

    async copy(input: StorageTransferInput): Promise<StoredObject> {
      const srcPath = normalizeStoragePath(input.path)
      const dstPath = input.toPath ? normalizeStoragePath(input.toPath) : srcPath
      const dstSlot = getSlot(input.to)
      if (dstSlot.readOnly) {
        throw new StorageReadOnlyError(dstSlot.name)
      }

      const recorded = await ledger.getFile(srcPath)
      const srcSlot = await resolveReadSlot(srcPath, input.from)

      if (
        (!recorded || recorded.parts.length === 1) &&
        srcSlot.name === dstSlot.name &&
        srcPath === dstPath
      ) {
        const headObj = await this.head(srcPath, { server: srcSlot.name })
        if (!headObj) throw new RangeError(`[storage] исходный файл не найден: «${srcPath}»`)
        return headObj
      }

      // Если копия создаётся под тем же относительным путём на другом сервере, храним запись
      // реплики отдельно от основного маршрута, чтобы не затирать и не удалять исходник!
      const isServerReplica =
        dstPath === srcPath &&
        (srcSlot.name !== dstSlot.name || Boolean(recorded && recorded.parts.length > 1))
      const ledgerRecordPath = isServerReplica
        ? `@replica:${dstSlot.name}:${dstPath}`
        : dstPath

      const srcKey = resolveCallKey(srcSlot.key, undefined)
      const dstKey = resolveCallKey(dstSlot.key, input.key)

      // Нативный серверный `COPY` (например WebDAV `COPY` внутри одного сервера под новый путь)
      const sameServerNativeCopy =
        srcSlot.name === dstSlot.name &&
        srcPath !== dstPath &&
        typeof dstSlot.driver.copyObject === 'function' &&
        (!recorded || (recorded.parts.length === 1 && recorded.parts[0]!.server === srcSlot.name)) &&
        sameEncryptionKey(srcKey, dstKey)

      if (sameServerNativeCopy) {
        const part = recorded?.parts[0]
        const headSrc = part ? null : await srcSlot.driver.head(srcPath)
        const storedBytes = part ? part.storedBytes : (headSrc?.size ?? 0)
        if (!part && !headSrc) {
          throw new RangeError(
            `[storage] исходный файл «${srcPath}» не найден на сервере «${srcSlot.name}»`,
          )
        }
        if (storedBytes > dstSlot.limits.fileBytes) {
          throw new RangeError(
            `[storage] размер файла (${storedBytes} Б) превышает лимит файла сервера «${dstSlot.name}» (${dstSlot.limits.fileBytes} Б)`,
          )
        }
        const reservationId = nextReservationId()
        const reserved = await ledger.reserve({
          id: reservationId,
          allocations: [
            {
              server: dstSlot.name,
              bytes: storedBytes,
              maxStorageBytes: dstSlot.limits.storageBytes,
            },
          ],
          ttlMs: reservationTtlMs,
        })
        if (!reserved) {
          throw new StorageQuotaError(
            dstSlot.name,
            `[storage] недостаточно места на сервере «${dstSlot.name}» для копирования «${srcPath}»`,
          )
        }
        try {
          const meta = await dstSlot.driver.copyObject!(srcPath, dstPath, {
            overwrite: true,
            ...(input.signal ? { signal: input.signal } : {}),
          })
          const encrypted = part ? part.encrypted : dstKey !== null
          const plainBytes = part
            ? part.plainBytes
            : encrypted
              ? decryptedSize(meta.size)
              : meta.size
          const contentType = recorded?.type ?? meta.contentType
          const lastModified = recorded?.lastModified ?? meta.lastModified
          const nextRec: StoredFileRecord = {
            path: dstPath,
            name: basenameOfStoragePath(dstPath),
            size: plainBytes,
            storedBytes: meta.size,
            type: contentType,
            lastModified,
            createdAt: Date.now(),
            parts: [
              {
                index: 0,
                server: dstSlot.name,
                path: dstPath,
                plainBytes,
                storedBytes: meta.size,
                encrypted,
              },
            ],
          }
          const { replaced } = await ledger.commit({ reservationId, file: nextRec })
          await invalidateStatCache(dstPath)
          if (replaced) {
            for (const oldPart of replaced.parts) {
              if (oldPart.server !== dstSlot.name || oldPart.path !== dstPath) {
                const oldS = slots.get(oldPart.server)
                if (oldS && !oldS.readOnly) {
                  await oldS.driver.del(oldPart.path).catch(() => undefined)
                }
              }
            }
          }
          return toStoredObject(
            { ...meta, contentType, lastModified },
            dstSlot,
            plainBytes,
            encrypted,
          )
        } catch (err) {
          await ledger.release(reservationId).catch(() => undefined)
          throw err
        }
      }
      const singleEncryptedMatch =
        recorded &&
        recorded.parts.length === 1 &&
        recorded.parts[0]!.server === srcSlot.name &&
        recorded.parts[0]!.encrypted &&
        dstKey !== null &&
        sameEncryptionKey(srcKey, dstKey)

      if (singleEncryptedMatch) {
        const part = recorded.parts[0]!
        if (part.storedBytes > dstSlot.limits.fileBytes) {
          throw new RangeError(
            `[storage] размер файла (${part.storedBytes} Б) превышает лимит файла сервера «${dstSlot.name}» (${dstSlot.limits.fileBytes} Б)`,
          )
        }
        const rawCipher = await srcSlot.driver.lazy(part.path)
        if (!rawCipher) {
          throw new RangeError(
            `[storage] исходный зашифрованный файл «${srcPath}» не найден на сервере «${srcSlot.name}»`,
          )
        }
        const reservationId = nextReservationId()
        const reserved = await ledger.reserve({
          id: reservationId,
          allocations: [
            {
              server: dstSlot.name,
              bytes: part.storedBytes,
              maxStorageBytes: dstSlot.limits.storageBytes,
            },
          ],
          ttlMs: reservationTtlMs,
        })
        if (!reserved) {
          throw new StorageQuotaError(
            dstSlot.name,
            `[storage] недостаточно места на сервере «${dstSlot.name}» для копирования «${srcPath}»`,
          )
        }
        try {
          const meta = await dstSlot.driver.put({
            path: dstPath,
            stream: rawCipher.stream(),
            size: part.storedBytes,
            contentType: recorded.type,
            lastModified: recorded.lastModified,
            ...(input.signal ? { signal: input.signal } : {}),
          })
          const nextRec: StoredFileRecord = {
            path: ledgerRecordPath,
            name: basenameOfStoragePath(dstPath),
            size: recorded.size,
            storedBytes: meta.size,
            type: recorded.type,
            lastModified: recorded.lastModified,
            createdAt: Date.now(),
            parts: [
              {
                index: 0,
                server: dstSlot.name,
                path: dstPath,
                plainBytes: recorded.size,
                storedBytes: meta.size,
                encrypted: true,
              },
            ],
          }
          await ledger.commit({ reservationId, file: nextRec })
          await invalidateStatCache(dstPath)
          return toStoredObject(meta, dstSlot, recorded.size, true)
        } catch (err) {
          await ledger.release(reservationId).catch(() => undefined)
          throw err
        }
      }

      const sourceFile = await this.lazy(srcPath, {
        ...(input.from ? { server: input.from } : {}),
        ...(input.meta ? { meta: input.meta } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
      })
      if (!sourceFile) {
        throw new RangeError(
          `[storage] исходный файл «${srcPath}» не найден на сервере «${srcSlot.name}»`,
        )
      }

      if (!isServerReplica) {
        return this.put({
          path: dstPath,
          body: sourceFile,
          size: sourceFile.size,
          contentType: sourceFile.type || 'application/octet-stream',
          lastModified: sourceFile.lastModified,
          server: dstSlot.name,
          ...(input.key !== undefined ? { key: input.key } : {}),
          ...(input.rate !== undefined ? { rate: input.rate } : {}),
          ...(input.concurrency !== undefined ? { concurrency: input.concurrency } : {}),
          ...(input.meta !== undefined ? { meta: input.meta } : {}),
          ...(input.signal ? { signal: input.signal } : {}),
        })
      }

      const neededStored =
        dstKey !== null ? encryptedSize(sourceFile.size) : sourceFile.size
      if (neededStored > dstSlot.limits.fileBytes) {
        throw new RangeError(
          `[storage] размер файла (${neededStored} Б) превышает лимит файла сервера «${dstSlot.name}» (${dstSlot.limits.fileBytes} Б)`,
        )
      }
      const reservationId = nextReservationId()
      const reserved = await ledger.reserve({
        id: reservationId,
        allocations: [
          {
            server: dstSlot.name,
            bytes: neededStored,
            maxStorageBytes: dstSlot.limits.storageBytes,
          },
        ],
        ttlMs: reservationTtlMs,
      })
      if (!reserved) {
        throw new StorageQuotaError(
          dstSlot.name,
          `[storage] недостаточно места на сервере «${dstSlot.name}» для копирования «${srcPath}»`,
        )
      }
      try {
        const written = await writePhysicalPart({
          slot: dstSlot,
          partPath: dstPath,
          plainStream: sourceFile.stream(),
          plainSize: sourceFile.size,
          contentType: sourceFile.type || 'application/octet-stream',
          lastModified: sourceFile.lastModified,
          overrides: input,
        })
        const repRec: StoredFileRecord = {
          path: ledgerRecordPath,
          name: basenameOfStoragePath(dstPath),
          size: written.plainBytes,
          storedBytes: written.meta.size,
          type: written.meta.contentType,
          lastModified: written.meta.lastModified,
          createdAt: Date.now(),
          parts: [
            {
              index: 0,
              server: dstSlot.name,
              path: dstPath,
              plainBytes: written.plainBytes,
              storedBytes: written.meta.size,
              encrypted: written.encrypted,
            },
          ],
        }
        await ledger.commit({ reservationId, file: repRec })
        await invalidateStatCache(dstPath)
        return toStoredObject(written.meta, dstSlot, written.plainBytes, written.encrypted)
      } catch (err) {
        await ledger.release(reservationId).catch(() => undefined)
        throw err
      }
    },

    async move(input: StorageTransferInput): Promise<StoredObject> {
      const srcPath = normalizeStoragePath(input.path)
      const dstPath = input.toPath ? normalizeStoragePath(input.toPath) : srcPath
      const dstSlot = getSlot(input.to)
      if (dstSlot.readOnly) {
        throw new StorageReadOnlyError(dstSlot.name)
      }

      const recorded = await ledger.getFile(srcPath)
      const srcSlot = await resolveReadSlot(srcPath, input.from)
      if (recorded && (!input.from || input.from === 'auto')) {
        for (const p of recorded.parts) {
          const s = slots.get(p.server)
          if (s?.readOnly) throw new StorageReadOnlyError(s.name)
        }
      } else if (srcSlot.readOnly) {
        throw new StorageReadOnlyError(srcSlot.name)
      }

      if (
        (!recorded || recorded.parts.length === 1) &&
        srcSlot.name === dstSlot.name &&
        srcPath === dstPath
      ) {
        const headObj = await this.head(srcPath, { server: srcSlot.name })
        if (!headObj) throw new RangeError(`[storage] исходный файл не найден: «${srcPath}»`)
        return headObj
      }

      const copied = await this.copy(input)

      // Продвигаем запись реплики (если dstPath === srcPath) в основной маршрут ledger и чистим исходник
      const repKey = `@replica:${dstSlot.name}:${dstPath}`
      const repRec = await ledger.getFile(repKey)
      if (repRec) {
        await ledger.deleteFile(repKey)
        const promoted: StoredFileRecord = { ...repRec, path: dstPath }
        const promoResId = nextReservationId()
        await ledger.reserve({
          id: promoResId,
          allocations: [
            {
              server: dstSlot.name,
              bytes: promoted.storedBytes,
              maxStorageBytes: Number.MAX_SAFE_INTEGER,
            },
          ],
          ttlMs: reservationTtlMs,
        })
        await ledger.commit({ reservationId: promoResId, file: promoted })
      }

      if (recorded && (!input.from || input.from === 'auto' || recorded.parts.length > 1)) {
        for (const p of recorded.parts) {
          if (p.server !== dstSlot.name || p.path !== dstPath) {
            const oldS = slots.get(p.server)
            if (oldS && !oldS.readOnly) {
              await oldS.driver.del(p.path).catch(() => undefined)
            }
          }
        }
        if (srcPath !== dstPath) {
          await ledger.deleteFile(srcPath)
        }
      } else if (srcSlot.name !== dstSlot.name || srcPath !== dstPath) {
        await srcSlot.driver.del(srcPath).catch(() => undefined)
        await ledger.deleteFile(`@replica:${srcSlot.name}:${srcPath}`)
        if (srcPath !== dstPath) {
          await ledger.deleteFile(srcPath)
        }
      }

      await invalidateStatCache(srcPath)
      await invalidateStatCache(dstPath)
      return copied
    },

    async clone(input: StorageCloneInput): Promise<StorageCloneReport> {
      const fromSlot = getSlot(input.from)
      const toSlot = getSlot(input.to)
      if (toSlot.readOnly) {
        throw new StorageReadOnlyError(toSlot.name)
      }
      if (fromSlot.name === toSlot.name) {
        return {
          from: fromSlot.name,
          to: toSlot.name,
          clonedPaths: [],
          skippedPaths: [],
          bytesTransferred: 0,
        }
      }

      const listed = await ledger.listFiles({
        ...(input.prefix ? { prefix: input.prefix } : {}),
      })
      const clonedPaths: string[] = []
      const skippedPaths: string[] = []
      let bytesTransferred = 0

      for (const rec of listed.entries) {
        if (rec.path.startsWith('@replica:')) continue
        input.signal?.throwIfAborted()
        if (!rec.parts.some((p) => p.server === fromSlot.name)) {
          continue
        }

        if (!input.overwrite) {
          const existingOnTarget = await toSlot.driver.head(rec.path)
          if (existingOnTarget) {
            skippedPaths.push(rec.path)
            continue
          }
        }

        const copied = await this.copy({
          path: rec.path,
          from: rec.parts.length === 1 ? fromSlot.name : undefined,
          to: toSlot.name,
          ...(input.key !== undefined ? { key: input.key } : {}),
          ...(input.rate !== undefined ? { rate: input.rate } : {}),
          ...(input.concurrency !== undefined ? { concurrency: input.concurrency } : {}),
          ...(input.meta !== undefined ? { meta: input.meta } : {}),
          ...(input.signal ? { signal: input.signal } : {}),
        })
        clonedPaths.push(rec.path)
        bytesTransferred += copied.storedBytes ?? copied.size
      }

      return {
        from: fromSlot.name,
        to: toSlot.name,
        clonedPaths,
        skippedPaths,
        bytesTransferred,
      }
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
          encrypted: slot.key !== null,
          allowSplit: slot.allowSplit,
          limits: slot.limits,
          usedBytes: u.usedBytes,
          reservedBytes: u.reservedBytes,
          freeBytes,
          filesCount: u.filesCount,
          partsCount: u.partsCount,
        }
      })
      return { servers: serverReports }
    },
  }
}
