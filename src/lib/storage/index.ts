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
  normalizeServerConcurrency,
  resolveCallConcurrency,
  StorageConcurrencyError,
  type ConcurrencyConfig,
  type ConcurrencyGate,
  type ConcurrencyInput,
} from './concurrency.js'
import {
  createDecryptedStreamFile,
  createSha256Hasher,
  CRYPTO_CHUNK_PLAIN_BYTES,
  CRYPTO_CHUNK_STORED_BYTES,
  CRYPTO_HEADER_BYTES,
  CRYPTO_TAG_BYTES,
  decryptedSize,
  encryptedSize,
  encryptStream,
  hashStreamSha256,
  normalizeExpectedSha256,
  StorageCryptoError,
  StorageHashMismatchError,
  type Sha256Hasher,
  type StorageEncryptionKey,
} from './crypto.js'
import {
  computeRecordHealthStatus,
  defineStorageLedger,
  memoryLedger,
  type AdaptedStorageLedger,
  type LedgerReservation,
  type ServerAllocation,
  type ServerUsageSnapshot,
  type StorageLedgerSpec,
  type StoredFileRecord,
  type StoredFileStatus,
  type StoredPart,
  type StoredReplica,
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
import {
  executeStorageUpload,
  matchesUploadAccept,
  sanitizeUploadFileName,
  StorageUploadError,
  type StorageUploadErrorCode,
} from './upload.js'
import type {
  ConfiguredStorageServer,
  DriverPutInput,
  DriverStoredMeta,
  LazyContent,
  ReadStrategy,
  ServerLimits,
  StagedSpoolFile,
  Storage,
  StorageCallOverrides,
  StorageCloneInput,
  StorageCloneReport,
  StorageConfig,
  StorageDriver,
  StorageListOptions,
  StorageListResult,
  StorageProbeResult,
  StorageProbeStep,
  StoragePutBody,
  StoragePutInput,
  StorageReadOptions,
  StorageReconcileOptions,
  StorageReconcileReport,
  StorageReport,
  StorageServeOptions,
  StorageServeTarget,
  StorageServerEntry,
  StorageServerPolicy,
  StorageServerReport,
  StorageServerSuspendedEvent,
  StorageSpool,
  StorageTransferInput,
  StorageUploadFileContext,
  StorageUploadOptions,
  StorageUploadResult,
  StoredObject,
  StoredUploadedFile,
  UrlConfiguredStorageServer,
  WriteStrategy,
} from './types.js'

export {
  createBandwidthLimiter,
  createConcurrencyGate,
  createSha256Hasher,
  decryptedSize,
  defineStorageLedger,
  defineStorageStore,
  encryptedSize,
  hashStreamSha256,
  matchesUploadAccept,
  memoryDriver,
  memoryLedger,
  memoryStore,
  sanitizeUploadFileName,
  StorageConcurrencyError,
  StorageCryptoError,
  StorageHashMismatchError,
  StorageUploadError,
  StreamFile,
}

export type {
  AdaptedStorageLedger,
  AdaptedStorageStore,
  BandwidthLimiter,
  ConcurrencyConfig,
  ConcurrencyGate,
  ConcurrencyInput,
  ConfiguredStorageServer,
  DriverPutInput,
  DriverStoredMeta,
  LazyContent,
  LedgerReservation,
  MemoryDriverOptions,
  RateInput,
  ReadStrategy,
  ServerAllocation,
  ServerLimits,
  ServerUsageSnapshot,
  Sha256Hasher,
  StagedSpoolFile,
  Storage,
  StorageCallOverrides,
  StorageCloneInput,
  StorageCloneReport,
  StorageConfig,
  StorageDriver,
  StorageEncryptionKey,
  StorageLedgerSpec,
  StorageListOptions,
  StorageListResult,
  StorageProbeResult,
  StorageProbeStep,
  StoragePutBody,
  StoragePutInput,
  StorageReadOptions,
  StorageReconcileOptions,
  StorageReconcileReport,
  StorageReport,
  StorageRequestMeta,
  StorageServeOptions,
  StorageServeTarget,
  StorageServerEntry,
  StorageServerPolicy,
  StorageServerReport,
  StorageServerSuspendedEvent,
  StorageSpool,
  StorageStateListener,
  StorageStoreSpec,
  StorageTechConfig,
  StorageTransferInput,
  StorageUploadErrorCode,
  StorageUploadFileContext,
  StorageUploadOptions,
  StorageUploadResult,
  StoredFileRecord,
  StoredFileStatus,
  StoredObject,
  StoredPart,
  StoredReplica,
  StoredUploadedFile,
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

export class StorageOverwriteError extends Error {
  readonly code = 'storage.already-exists'
  readonly path: string

  constructor(path: string) {
    super(`[storage] объект «${path}» уже существует (overwrite: false)`)
    this.name = 'StorageOverwriteError'
    this.path = path
  }
}

export class StorageServerSuspendedError extends Error {
  readonly code = 'storage.server-suspended'
  readonly server: string
  readonly reason: 'missing-files' | 'manual'

  constructor(server: string, reason: 'missing-files' | 'manual') {
    super(
      `[storage] сервер «${server}» отключён (${reason === 'missing-files' ? 'превышен порог пропавших файлов' : 'вручную'}) и ждёт реактивации`,
    )
    this.name = 'StorageServerSuspendedError'
    this.server = server
    this.reason = reason
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
  readonly hash: boolean
  readonly missingThreshold?: number
  readonly initialSuspended: boolean
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
    const concurrencyGate = normalizeServerConcurrency(name, entry.concurrency)
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
      concurrencyGate,
      hash: Boolean(entry.hash),
      ...(entry.missingThreshold !== undefined && entry.missingThreshold > 0
        ? { missingThreshold: Math.floor(entry.missingThreshold) }
        : {}),
      initialSuspended: Boolean(entry.suspended),
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
    hash: false,
    initialSuspended: false,
  }
}

function fnv1a32(str: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

function fanOutReadableStream(
  source: ReadableStream<Uint8Array>,
  count: number,
): ReadableStream<Uint8Array>[] {
  if (count <= 1) return [source]
  const branches: ReadableStream<Uint8Array>[] = []
  let rest = source
  for (let i = 0; i < count - 1; i++) {
    const [left, right] = rest.tee()
    branches.push(left)
    rest = right
  }
  branches.push(rest)
  return branches
}

function upsertStoredReplica(
  existing: readonly StoredReplica[] | undefined,
  next: StoredReplica,
): readonly StoredReplica[] {
  const list = existing ? existing.filter((r) => r.server !== next.server) : []
  return [...list, next]
}

function collectAllPhysicalPartsOfRecord(rec: StoredFileRecord): StoredPart[] {
  const out: StoredPart[] = [...rec.parts]
  if (rec.replicas) {
    for (const rep of rec.replicas) {
      if (rep.parts && rep.parts.length > 0) {
        out.push(...rep.parts)
      } else {
        out.push({
          index: 0,
          server: rep.server,
          path: rep.path,
          plainBytes: rec.size,
          storedBytes: rep.storedBytes,
          encrypted: rep.encrypted,
          ...(rep.etag !== undefined ? { etag: rep.etag } : {}),
        })
      }
    }
  }
  return out
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
  // Суффикс — криптографический: id расходится между инстансами процесса,
  // где счётчик и миллисекунда могут совпасть (Math.random здесь был
  // предсказуем и короче, чем выглядит).
  const buf = new Uint8Array(6)
  crypto.getRandomValues(buf)
  const suffix = [...buf].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 8)
  return `resv-${Date.now().toString(36)}-${reservationSeq.toString(36)}-${suffix}`
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

const BLOB_SLICE_CHUNK_BYTES = 64 * 1024

/**
 * Читает `Blob` срезами по `64 KiB` вместо нативного `blob.stream()`:
 * в Node.js `< 24.20.0` (`nodejs/node#63574`, см. `@remix-run/file-storage-s3`)
 * чанки из `Blob#stream()` удерживаются в памяти до завершения процесса.
 */
function streamBlobSlices(
  blob: Blob,
  start = 0,
  end = blob.size,
): ReadableStream<Uint8Array> {
  const boundedStart = Math.max(0, Math.min(start, blob.size))
  const boundedEnd = Math.max(boundedStart, Math.min(end, blob.size))
  let offset = boundedStart
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (offset >= boundedEnd) {
        controller.close()
        return
      }
      const nextEnd = Math.min(offset + BLOB_SLICE_CHUNK_BYTES, boundedEnd)
      const chunk = new Uint8Array(await blob.slice(offset, nextEnd).arrayBuffer())
      offset = nextEnd
      if (chunk.byteLength > 0) {
        controller.enqueue(chunk)
      }
      if (offset >= boundedEnd) {
        controller.close()
      }
    },
  })
}

function bodyToNormalized(body: StoragePutBody): NormalizedInputBody {
  if (body instanceof ReadableStream) {
    return { stream: body }
  }
  if (body instanceof Blob) {
    return {
      stream: streamBlobSlices(body),
      knownSize: body.size,
      ...(body.type ? { inferredType: body.type } : {}),
      sliceable: (start, end) => streamBlobSlices(body, start, end),
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
  // Отвязываем собственную копию ArrayBuffer (защита от переиспользования буфера вызывающим кодом
  // при ретраях и от утечки общего 8-КиБ пула Node Buffer)
  const snapshot = new Uint8Array(new ArrayBuffer(view.byteLength))
  snapshot.set(view)

  const makeSliceStream = (sub: Uint8Array) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        if (sub.byteLength > 0) controller.enqueue(sub)
        controller.close()
      },
    })
  return {
    knownSize: snapshot.byteLength,
    stream: makeSliceStream(snapshot),
    sliceable: (start, end) => makeSliceStream(snapshot.subarray(start, end)),
  }
}

function buildPublicUrl(
  baseUrl: string | undefined,
  path: string,
  serverName: string,
  useBarePath: boolean,
  publicOrigin?: string,
): string | undefined {
  if (!baseUrl) return undefined
  const cleanBase = baseUrl.replace(/\/+$/, '')
  const cleanOrigin = publicOrigin?.trim().replace(/\/+$/, '')
  const resolvedBase =
    cleanOrigin && cleanBase.startsWith('/') && !cleanBase.startsWith('//')
      ? `${cleanOrigin}${cleanBase}`
      : cleanBase
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  const suffix = useBarePath ? '' : `?server=${encodeURIComponent(serverName)}`
  return `${resolvedBase}/${encodedPath}${suffix}`
}

function encodeRfc5987ValueChars(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

function contentDispositionAttachment(filename: string): string {
  const clean = filename.replace(/[\r\n]+/g, ' ').trim() || 'download'
  const asciiFallback = clean.replace(/[^\x20-\x7e]|["\\]/g, '_') || 'download'
  const encoded = encodeRfc5987ValueChars(clean)
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
  const defaultReadStrategy: ReadStrategy = config.readStrategy ?? 'primary'
  const cooldownMs = Math.max(0, config.cooldownMs ?? 0)
  const globalMissingThreshold =
    config.missingThreshold !== undefined && config.missingThreshold > 0
      ? Math.floor(config.missingThreshold)
      : undefined
  const onServerSuspended = config.onServerSuspended
  const cooldowns = new Map<string, number>()
  const suspendedServers = new Map<
    string,
    { reason: 'missing-files' | 'manual'; suspendedAt: number }
  >()
  const missingCounts = new Map<string, number>()
  let roundRobinCursor = 0
  let readRoundRobinCursor = 0

  const slots = new Map<string, NormalizedServerSlot>()
  for (const name of initialNames) {
    const slot = normalizeSlot(name, config.servers[name]!, Boolean(store))
    slots.set(name, slot)
    if (slot.initialSuspended) {
      suspendedServers.set(name, { reason: 'manual', suspendedAt: Date.now() })
    }
  }

  function isSlotSuspended(name: string): boolean {
    return suspendedServers.has(name)
  }

  function assertSlotWritable(slot: NormalizedServerSlot, bypassSuspended = false): void {
    if (slot.readOnly) throw new StorageReadOnlyError(slot.name)
    if (!bypassSuspended) {
      const susp = suspendedServers.get(slot.name)
      if (susp) throw new StorageServerSuspendedError(slot.name, susp.reason)
    }
  }

  async function syncServerStateFromStore(name: string): Promise<void> {
    if (!store) return
    const [storedSusp, storedCount] = await Promise.all([
      store
        .get<{ reason: 'missing-files' | 'manual'; suspendedAt: number }>(
          `suspended:${name}`,
        )
        .catch(() => undefined),
      store.get<number>(`missing:${name}`).catch(() => undefined),
    ])
    if (typeof storedCount === 'number' && Number.isFinite(storedCount)) {
      missingCounts.set(name, Math.max(0, Math.floor(storedCount)))
    }
    if (storedSusp && !suspendedServers.has(name)) {
      suspendedServers.set(name, storedSusp)
    }
  }

  async function applySuspendServer(
    name: string,
    reason: 'missing-files' | 'manual',
    countOverride?: number,
  ): Promise<void> {
    getSlot(name)
    const now = Date.now()
    const count = countOverride ?? missingCounts.get(name) ?? 0
    const entry = { reason, suspendedAt: now }
    suspendedServers.set(name, entry)
    if (store) {
      await store.set(`suspended:${name}`, entry).catch(() => undefined)
    }
    stateListener?.({
      type: 'server:suspended',
      server: name,
      reason,
      missingCount: count,
    })
    if (onServerSuspended) {
      await onServerSuspended({
        server: name,
        reason,
        missingCount: count,
        suspendedAt: now,
      })
    }
  }

  async function applyResumeServer(
    name: string,
    resetMissingCount = true,
  ): Promise<void> {
    getSlot(name)
    suspendedServers.delete(name)
    cooldowns.delete(name)
    if (resetMissingCount) {
      missingCounts.set(name, 0)
    }
    if (store) {
      await store.delete(`suspended:${name}`).catch(() => undefined)
      if (resetMissingCount) {
        await store.delete(`missing:${name}`).catch(() => undefined)
      }
    }
    stateListener?.({ type: 'server:resumed', server: name })
  }

  function isServerHealthy(name: string, now = Date.now()): boolean {
    if (suspendedServers.has(name)) return false
    const until = cooldowns.get(name)
    if (until === undefined) return true
    if (until <= now) {
      cooldowns.delete(name)
      stateListener?.({ type: 'server:recovered', server: name })
      return true
    }
    return false
  }

  function markServerCooldown(name: string, errorMsg: string): void {
    if (cooldownMs <= 0) return
    const until = Date.now() + cooldownMs
    cooldowns.set(name, until)
    stateListener?.({
      type: 'server:cooldown',
      server: name,
      until,
      error: errorMsg,
    })
  }

  function markServerHealthy(name: string): void {
    if (cooldowns.delete(name)) {
      stateListener?.({ type: 'server:recovered', server: name })
    }
  }

  function isTransientDriverFailure(err: unknown, signal?: AbortSignal): boolean {
    if (signal?.aborted) return false
    if (
      err instanceof StorageQuotaError ||
      err instanceof StorageReadOnlyError ||
      err instanceof StorageOverwriteError ||
      err instanceof StorageServerSuspendedError ||
      err instanceof StorageConcurrencyError ||
      err instanceof StorageCryptoError ||
      err instanceof StorageHashMismatchError ||
      err instanceof StorageUploadError ||
      err instanceof RangeError ||
      err instanceof TypeError
    ) {
      return false
    }
    if (err instanceof Error && err.name === 'AbortError') return false
    return true
  }

  const defaultName =
    config.defaultServer ??
    initialNames.find((n) => !slots.get(n)!.readOnly && !suspendedServers.has(n)) ??
    initialNames.find((n) => !slots.get(n)!.readOnly) ??
    initialNames[0]!
  if (!slots.has(defaultName)) {
    throw new TypeError(`[storage] defaultServer «${defaultName}» отсутствует в servers`)
  }

  const customWritePool =
    config.writePool && config.writePool.length > 0 ? [...config.writePool] : null

  function currentWritePool(): readonly string[] {
    if (customWritePool) {
      return customWritePool.filter((n) => slots.has(n) && !suspendedServers.has(n))
    }
    return [...slots.keys()].filter(
      (n) => !slots.get(n)!.readOnly && !suspendedServers.has(n),
    )
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

  async function deleteUnreferencedPhysicalParts(
    candidateParts: readonly StoredPart[],
    excludePath?: string,
  ): Promise<boolean> {
    if (candidateParts.length === 0) return false
    const orphans = await ledger.filterUnreferencedParts(candidateParts, excludePath)
    let anyRemoved = false
    for (const p of orphans) {
      const s = slots.get(p.server)
      if (s && !s.readOnly) {
        const ok = await s.driver.del(p.path).catch(() => false)
        if (ok) anyRemoved = true
      }
    }
    return anyRemoved
  }

  /**
   * Зафиксировать пропажу записанной в `ledger` части/реплики на сервере (`driver` вернул `null` без сетевой ошибки).
   * Повторное обращение к уже отмеченной `missingAt` части не увеличивает счётчик повторно.
   */
  async function reportMissingLocation(
    rec: StoredFileRecord,
    serverName: string,
    physicalPath: string,
  ): Promise<void> {
    if (!slots.has(serverName)) return
    const now = Date.now()
    let newlyMarked = false

    await ledger.patchFile(rec.path, (cur) => {
      let changed = false
      const nextParts = cur.parts.map((p) => {
        if (p.server === serverName && p.path === physicalPath) {
          if (p.missingAt === undefined) {
            newlyMarked = true
            changed = true
            return { ...p, missingAt: now }
          }
        }
        return p
      })
      const nextReplicas = cur.replicas?.map((r) => {
        if (r.server === serverName) {
          if (r.parts && r.parts.length > 0) {
            let repPartChanged = false
            const updatedRepParts = r.parts.map((rp) => {
              if (rp.server === serverName && rp.path === physicalPath && rp.missingAt === undefined) {
                newlyMarked = true
                repPartChanged = true
                return { ...rp, missingAt: now }
              }
              return rp
            })
            if (repPartChanged) {
              changed = true
              return { ...r, missingAt: r.missingAt ?? now, parts: updatedRepParts }
            }
          } else if (r.path === physicalPath && r.missingAt === undefined) {
            newlyMarked = true
            changed = true
            return { ...r, missingAt: now }
          }
        }
        return r
      })

      if (!changed) return null
      const draft: StoredFileRecord = {
        ...cur,
        parts: nextParts,
        ...(nextReplicas !== undefined ? { replicas: nextReplicas } : {}),
      }
      return {
        ...draft,
        status: computeRecordHealthStatus(draft),
      }
    })

    await invalidateStatCache(rec.path)

    if (!newlyMarked) return

    let count: number
    if (store) {
      count = await store
        .incr(`missing:${serverName}`, { ttlMs: 365 * 24 * 60 * 60 * 1000, by: 1 })
        .catch(() => (missingCounts.get(serverName) ?? 0) + 1)
    } else {
      count = (missingCounts.get(serverName) ?? 0) + 1
    }
    missingCounts.set(serverName, count)

    stateListener?.({
      type: 'file:missing',
      server: serverName,
      path: physicalPath,
      missingCount: count,
    })

    const slot = getSlot(serverName)
    const threshold = slot.missingThreshold ?? globalMissingThreshold
    if (
      threshold !== undefined &&
      threshold > 0 &&
      count >= threshold &&
      !suspendedServers.has(serverName)
    ) {
      await applySuspendServer(serverName, 'missing-files', count)
    }
  }

  function orderReadGroup(
    group: readonly NormalizedServerSlot[],
    strategy: ReadStrategy,
    affinityKey: string | undefined,
    cleanPath: string,
  ): readonly NormalizedServerSlot[] {
    if (group.length <= 1 || strategy === 'primary') return group
    if (strategy === 'round-robin') {
      const start = readRoundRobinCursor % group.length
      readRoundRobinCursor = (readRoundRobinCursor + 1) % 1_000_000_000
      return [...group.slice(start), ...group.slice(0, start)]
    }
    const key = affinityKey && affinityKey.length > 0 ? affinityKey : cleanPath
    const start = fnv1a32(key) % group.length
    return [...group.slice(start), ...group.slice(0, start)]
  }

  async function orderGroupByStrategy(group: readonly string[]): Promise<readonly string[]> {
    if (group.length <= 1 || writeStrategy === 'priority') return group
    if (writeStrategy === 'round-robin') {
      const start = roundRobinCursor % group.length
      roundRobinCursor = (roundRobinCursor + 1) % 1_000_000_000
      return [...group.slice(start), ...group.slice(0, start)]
    }
    // writeStrategy === 'most-free'
    const snap = await ledger.usage(group)
    return [...group].sort((a, b) => {
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

  async function orderAutoCandidates(pool: readonly string[]): Promise<readonly string[]> {
    if (pool.length === 0) return pool
    if (store) {
      await Promise.all(pool.map((n) => syncServerStateFromStore(n)))
    }
    const activePool = pool.filter((n) => !suspendedServers.has(n))
    if (activePool.length === 0) return []
    const now = Date.now()
    const healthy: string[] = []
    const cooling: string[] = []
    for (const name of activePool) {
      if (isServerHealthy(name, now)) healthy.push(name)
      else cooling.push(name)
    }
    const orderedHealthy = await orderGroupByStrategy(healthy)
    if (cooling.length === 0) return orderedHealthy
    const orderedCooling = await orderGroupByStrategy(cooling)
    return [...orderedHealthy, ...orderedCooling]
  }

  async function resolveReadSlot(
    cleanPath: string,
    explicitServer?: string | readonly string[],
    preloadedRec?: StoredFileRecord | null,
  ): Promise<NormalizedServerSlot> {
    if (typeof explicitServer === 'string') {
      if (explicitServer && explicitServer !== 'auto') return getSlot(explicitServer)
    } else if (explicitServer) {
      const first = explicitServer.find((s) => s && s !== 'auto')
      if (first) return getSlot(first)
    }
    const rec = preloadedRec !== undefined ? preloadedRec : await ledger.getFile(cleanPath)
    const recordedServer = rec?.parts[0]?.server
    if (recordedServer && slots.has(recordedServer) && !suspendedServers.has(recordedServer)) {
      return slots.get(recordedServer)!
    }
    const healthyReplica = rec?.replicas?.find(
      (r) => r.missingAt === undefined && slots.has(r.server) && !suspendedServers.has(r.server),
    )
    if (healthyReplica) {
      return slots.get(healthyReplica.server)!
    }
    if (recordedServer && slots.has(recordedServer)) {
      return slots.get(recordedServer)!
    }
    return getSlot(defaultName)
  }

  async function resolveReadCandidates(
    cleanPath: string,
    explicitServer?: string | readonly string[],
    readStrategyOverride?: ReadStrategy,
    affinityKey?: string,
    preloadedRec?: StoredFileRecord | null,
  ): Promise<readonly NormalizedServerSlot[]> {
    if (typeof explicitServer === 'string') {
      if (explicitServer && explicitServer !== 'auto') return [getSlot(explicitServer)]
    } else if (explicitServer) {
      const explicitList = explicitServer
        .filter((s) => Boolean(s) && s !== 'auto')
        .map((s) => getSlot(s))
      if (explicitList.length > 0) return explicitList
    }

    const rec = preloadedRec !== undefined ? preloadedRec : await ledger.getFile(cleanPath)
    const primaryName =
      rec?.parts[0]?.server && slots.has(rec.parts[0].server)
        ? rec.parts[0].server
        : defaultName

    const candidateNames: string[] = []
    const primaryMissing = Boolean(rec && rec.parts.some((p) => p.missingAt !== undefined))
    if (!primaryMissing) {
      candidateNames.push(primaryName)
    }

    if (rec && rec.replicas !== undefined) {
      // Современная запись: 0 дополнительных N+1 запросов к ledger!
      for (const rep of rec.replicas) {
        if (rep.missingAt !== undefined) continue
        if (rep.parts?.some((rp) => rp.missingAt !== undefined)) continue
        if (slots.has(rep.server) && !candidateNames.includes(rep.server)) {
          candidateNames.push(rep.server)
        }
      }
    } else {
      // Обратная совместимость со старыми записями без поля `replicas`
      for (const name of slots.keys()) {
        if (name === primaryName) continue
        const replica = await ledger.getFile(`@replica:${name}:${cleanPath}`)
        if (replica && !candidateNames.includes(name)) {
          candidateNames.push(name)
        }
      }
    }

    if (store && candidateNames.length > 0) {
      await Promise.all(candidateNames.map((n) => syncServerStateFromStore(n)))
    }

    const activeNames = candidateNames.filter((n) => !suspendedServers.has(n))
    if (activeNames.length === 0) {
      return []
    }

    const strategy = readStrategyOverride ?? defaultReadStrategy
    if (activeNames.length === 1) {
      return [getSlot(activeNames[0]!)]
    }

    const now = Date.now()
    const healthySlots: NormalizedServerSlot[] = []
    const coolingSlots: NormalizedServerSlot[] = []
    for (const name of activeNames) {
      const slot = getSlot(name)
      if (isServerHealthy(name, now)) healthySlots.push(slot)
      else coolingSlots.push(slot)
    }
    const orderedHealthy = orderReadGroup(healthySlots, strategy, affinityKey, cleanPath)
    const orderedCooling = orderReadGroup(coolingSlots, strategy, affinityKey, cleanPath)
    return [...orderedHealthy, ...orderedCooling]
  }

  function recordToStoredObject(
    record: StoredFileRecord,
    extra?: { readonly deduplicated?: boolean },
  ): StoredObject {
    const primaryServer = record.parts[0]?.server ?? defaultName
    const primarySlot = slots.get(primaryServer)
    const isMultiPart = record.parts.length > 1
    const url = buildPublicUrl(
      primarySlot?.driver.publicBaseUrl,
      record.path,
      primaryServer,
      isMultiPart || primaryServer === defaultName,
      tech?.publicOrigin,
    )
    const replicaNames = record.replicas?.map((r) => r.server)
    return {
      path: record.path,
      server: primaryServer,
      size: record.size,
      storedBytes: record.storedBytes,
      encrypted: record.parts.some((p) => p.encrypted),
      partsCount: record.parts.length,
      contentType: record.type,
      lastModified: record.lastModified,
      ...(record.hash !== undefined ? { hash: record.hash } : {}),
      ...(extra?.deduplicated !== undefined ? { deduplicated: extra.deduplicated } : {}),
      ...(replicaNames && replicaNames.length > 0 ? { replicas: replicaNames } : {}),
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
      tech?.publicOrigin,
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
    computeHash?: boolean
    expectedHash?: string
  }): Promise<{
    meta: DriverStoredMeta
    encrypted: boolean
    plainBytes: number
    plainHash?: string
  }> {
    const {
      slot,
      partPath,
      plainSize,
      contentType,
      lastModified,
      overrides,
      computeHash,
      expectedHash,
    } = params
    const effectiveKey = resolveCallKey(slot.key, overrides.key)
    const limiter = resolveCallRate(slot.rateLimiter, overrides.rate)
    const gate = resolveCallConcurrency(slot.name, slot.concurrencyGate, overrides.concurrency)

    const lease = gate
      ? await gate.acquire({ meta: overrides.meta, signal: overrides.signal })
      : null
    const activeSignal = lease ? lease.signal : overrides.signal

    const hasher =
      computeHash || expectedHash !== undefined ? createSha256Hasher() : null

    stateListener?.({ type: 'upload:start', server: slot.name, path: partPath })
    try {
      let seenPlain = 0
      let plainReader: ReadableStreamDefaultReader<Uint8Array> | null = null
      const countedPlain = new ReadableStream<Uint8Array>({
        async pull(c) {
          plainReader ??= params.plainStream.getReader()
          try {
            const { done, value } = await plainReader.read()
            if (done) {
              plainReader.releaseLock()
              plainReader = null
              c.close()
              return
            }
            seenPlain += value.byteLength
            hasher?.update(value)
            c.enqueue(value)
          } catch (e) {
            if (plainReader) {
              plainReader.releaseLock()
              plainReader = null
            }
            c.error(e)
          }
        },
        async cancel(reason) {
          if (plainReader) {
            const r = plainReader
            plainReader = null
            await r.cancel(reason).catch(() => undefined)
            r.releaseLock()
          }
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

      const plainHash = hasher ? hasher.digestHex() : undefined
      if (expectedHash !== undefined && plainHash !== expectedHash) {
        await slot.driver.del(partPath).catch(() => undefined)
        throw new StorageHashMismatchError(expectedHash, plainHash ?? '')
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
        ...(plainHash !== undefined ? { plainHash } : {}),
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

    if (!part.encrypted) {
      // Оборачиваем чтение сырого потока в лимитеры rate + concurrency + телеметрию сервера
      return new StreamFile(
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
    }

    const effectiveKey = resolveCallKey(slot.key, overrides?.key)
    if (effectiveKey === null) {
      throw new StorageCryptoError(
        `[storage/crypto] часть «${part.path}» на сервере «${slot.name}» зашифрована, но ключ расшифровки не задан`,
      )
    }
    const decryptedFile = createDecryptedStreamFile(rawFile, effectiveKey, {
      plainSize: part.plainBytes,
      fileName: basenameOfStoragePath(part.path),
      contentType: logicalType,
      lastModified: logicalLastModified,
    })

    // Лимитеры concurrency / rate и телеметрия держатся на внешнем потоке части (а не на 64 КБ AEAD-кадрах)
    return new StreamFile(
      {
        byteLength: decryptedFile.size,
        stream(start = 0, end = decryptedFile.size) {
          return wrapSlotReadControls(
            decryptedFile.slice(start, end).stream(),
            slot,
            part.path,
            overrides,
          )
        },
      },
      decryptedFile.name,
      { type: logicalType, lastModified: logicalLastModified },
    )
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

    const primaryServer = record.parts[0]?.server ?? defaultName
    const outerCallGate =
      overrides?.concurrency !== undefined
        ? resolveCallConcurrency(primaryServer, null, overrides.concurrency)
        : null
    const partOverrides: StorageCallOverrides | undefined =
      overrides?.concurrency !== undefined
        ? { ...overrides, concurrency: overrides.concurrency === null || overrides.concurrency === 0 ? null : undefined }
        : overrides

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
          let outerLeaseReleased = false
          let outerReleaseFn: (() => void) | null = null
          let outerSignal: AbortSignal | undefined = overrides?.signal

          const releaseOuter = () => {
            if (!outerLeaseReleased && outerReleaseFn) {
              outerLeaseReleased = true
              outerReleaseFn()
              outerReleaseFn = null
            }
          }

          return new ReadableStream<Uint8Array<ArrayBuffer>>({
            async pull(controller) {
              try {
                if (outerCallGate && !outerReleaseFn && !outerLeaseReleased) {
                  const lease = await outerCallGate.acquire({
                    meta: overrides?.meta,
                    signal: overrides?.signal,
                  })
                  outerReleaseFn = () => lease.release()
                  outerSignal = lease.signal
                }
                outerSignal?.throwIfAborted()

                for (;;) {
                  if (!activeReader) {
                    if (spanIdx >= touched.length) {
                      releaseOuter()
                      controller.close()
                      return
                    }
                    const current = touched[spanIdx]!
                    spanIdx += 1
                    const effectivePartOverrides =
                      outerSignal && outerSignal !== partOverrides?.signal
                        ? { ...partOverrides, signal: outerSignal }
                        : partOverrides
                    const partFile = await openPartPlainFile(
                      current.part,
                      record.type,
                      record.lastModified,
                      effectivePartOverrides,
                    )
                    if (!partFile) {
                      await reportMissingLocation(
                        record,
                        current.part.server,
                        current.part.path,
                      )
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
                  outerSignal?.throwIfAborted()
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
                releaseOuter()
                if (activeReader) {
                  await activeReader.cancel(err).catch(() => undefined)
                  activeReader.releaseLock()
                  activeReader = null
                }
                controller.error(err)
              }
            },
            async cancel(reason) {
              releaseOuter()
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
      .filter((s) => !s.readOnly && s.allowSplit && !suspendedServers.has(s.name))
    if (splitPool.length === 0) return null

    const snap = await ledger.usage(splitPool.map((s) => s.name))
    let remainingPlain = params.totalPlainBytes
    let offset = 0
    const planned: PlannedSplitPart[] = []
    const perServerReserved = new Map<string, number>()

    const freeByServer = new Map<string, number>()
    for (const slot of splitPool) {
      const u = snap[slot.name] ?? {
        usedBytes: 0,
        reservedBytes: 0,
        filesCount: 0,
        partsCount: 0,
      }
      freeByServer.set(slot.name, slot.limits.storageBytes - u.usedBytes - u.reservedBytes)
    }

    if (writeStrategy === 'round-robin' && splitPool.length > 1) {
      // В режиме round-robin чередуем по 1 части на сервер по кругу (полосатое размещение по шардам)
      while (remainingPlain > 0) {
        let progressed = false
        for (const slot of splitPool) {
          if (remainingPlain <= 0) break
          const freeStorage = freeByServer.get(slot.name) ?? 0
          if (freeStorage <= 0) continue
          const encrypted = resolveCallKey(slot.key, params.callKey) !== null
          const storedBudget = Math.min(slot.limits.fileBytes, freeStorage)
          const maxPlain = maxPlainBytesForStoredBudget(storedBudget, encrypted)
          if (maxPlain <= 0) continue

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
          freeByServer.set(slot.name, freeStorage - takeStored)
          perServerReserved.set(
            slot.name,
            (perServerReserved.get(slot.name) ?? 0) + takeStored,
          )
          progressed = true
        }
        if (!progressed) break
      }
    } else {
      for (const slot of splitPool) {
        if (remainingPlain <= 0) break
        let freeStorage = freeByServer.get(slot.name) ?? 0
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
          freeByServer.set(slot.name, freeStorage)
          perServerReserved.set(
            slot.name,
            (perServerReserved.get(slot.name) ?? 0) + takeStored,
          )
        }
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
      const nextSlot = normalizeSlot(cleanName, entry, Boolean(store))
      slots.set(cleanName, nextSlot)
      if (nextSlot.initialSuspended && !suspendedServers.has(cleanName)) {
        suspendedServers.set(cleanName, { reason: 'manual', suspendedAt: Date.now() })
      }
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
      suspendedServers.delete(name)
      missingCounts.delete(name)
      cooldowns.delete(name)
      return slots.delete(name)
    },

    async suspendServer(
      serverName: string,
      reason: 'manual' | 'missing-files' = 'manual',
    ): Promise<void> {
      await applySuspendServer(serverName, reason)
    },

    async resumeServer(
      serverName: string,
      options?: { readonly resetMissingCount?: boolean },
    ): Promise<void> {
      await applyResumeServer(serverName, options?.resetMissingCount !== false)
    },

    isServerSuspended(serverName: string): boolean {
      getSlot(serverName)
      return isSlotSuspended(serverName)
    },

    async reconcile(options?: StorageReconcileOptions): Promise<StorageReconcileReport> {
      const limit =
        options?.limit !== undefined && options.limit > 0 ? Math.floor(options.limit) : 50
      const filterSet =
        options?.servers && options.servers.length > 0 ? new Set(options.servers) : null
      if (filterSet) {
        for (const s of filterSet) getSlot(s)
      }

      const problemRecords = await ledger.listMissingFiles({
        limit,
        ...(filterSet ? { servers: [...filterSet] } : {}),
      })

      const restoredFiles: string[] = []
      const stillMissingFiles: string[] = []
      let restoredParts = 0

      for (const rec of problemRecords) {
        options?.signal?.throwIfAborted()
        let recRestoredCount = 0
        const restoredByServer = new Map<string, number>()

        const nextParts: StoredPart[] = []
        for (const part of rec.parts) {
          if (
            part.missingAt === undefined ||
            (filterSet !== null && !filterSet.has(part.server)) ||
            !slots.has(part.server)
          ) {
            nextParts.push(part)
            continue
          }
          const slot = getSlot(part.server)
          const meta = await slot.driver.head(part.path).catch(() => null)
          if (meta && meta.size === part.storedBytes) {
            const { missingAt: _removed, ...cleanPart } = part
            nextParts.push(cleanPart)
            recRestoredCount += 1
            restoredByServer.set(part.server, (restoredByServer.get(part.server) ?? 0) + 1)
          } else {
            nextParts.push(part)
          }
        }

        let nextReplicas: StoredReplica[] | undefined
        if (rec.replicas) {
          nextReplicas = []
          for (const rep of rec.replicas) {
            if (
              rep.missingAt === undefined ||
              (filterSet !== null && !filterSet.has(rep.server)) ||
              !slots.has(rep.server)
            ) {
              nextReplicas.push(rep)
              continue
            }
            const slot = getSlot(rep.server)
            const meta = await slot.driver.head(rep.path).catch(() => null)
            if (meta && meta.size === rep.storedBytes) {
              const { missingAt: _removed, ...cleanRep } = rep
              nextReplicas.push(cleanRep)
              recRestoredCount += 1
              restoredByServer.set(rep.server, (restoredByServer.get(rep.server) ?? 0) + 1)
            } else {
              nextReplicas.push(rep)
            }
          }
        }

        const checkedAt = Date.now()
        const updatedDraft: StoredFileRecord = {
          ...rec,
          parts: nextParts,
          ...(nextReplicas !== undefined ? { replicas: nextReplicas } : {}),
          checkedAt,
        }
        const nextStatus = computeRecordHealthStatus(updatedDraft)
        await ledger.patchFile(rec.path, () => ({
          ...updatedDraft,
          status: nextStatus,
        }))
        await invalidateStatCache(rec.path)

        if (recRestoredCount > 0) {
          restoredParts += recRestoredCount
          for (const [srv, dec] of restoredByServer.entries()) {
            const prev = missingCounts.get(srv) ?? 0
            const nextCount = Math.max(0, prev - dec)
            missingCounts.set(srv, nextCount)
            if (store) {
              if (nextCount === 0) {
                await store.delete(`missing:${srv}`).catch(() => undefined)
              } else {
                await store.set(`missing:${srv}`, nextCount).catch(() => undefined)
              }
            }
            stateListener?.({ type: 'file:restored', server: srv, path: rec.path })
          }
        }

        if (nextStatus === 'ok') {
          restoredFiles.push(rec.path)
        } else {
          stillMissingFiles.push(rec.path)
        }
      }

      const targetServers = filterSet ? [...filterSet] : [...slots.keys()]
      const remainingMissingByServer: Record<string, number> = {}
      const resumedServers: string[] = []

      for (const srv of targetServers) {
        const remaining = await ledger.listMissingFiles({ servers: [srv], limit: 1000 })
        const actualCount = remaining.length
        missingCounts.set(srv, actualCount)
        if (store) {
          if (actualCount === 0) {
            await store.delete(`missing:${srv}`).catch(() => undefined)
          } else {
            await store.set(`missing:${srv}`, actualCount).catch(() => undefined)
          }
        }
        remainingMissingByServer[srv] = actualCount

        if (options?.autoResumeServers && actualCount === 0) {
          const susp = suspendedServers.get(srv)
          if (susp && susp.reason === 'missing-files') {
            await applyResumeServer(srv, true)
            resumedServers.push(srv)
          }
        }
      }

      return {
        checkedFiles: problemRecords.length,
        restoredFiles,
        restoredParts,
        stillMissingFiles,
        resumedServers,
        serverMissingCounts: remainingMissingByServer,
      }
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
        await writePhysicalPart({
          slot,
          partPath: probePath,
          plainStream: new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(expected.subarray(0, 48))
              c.enqueue(expected.subarray(48))
              c.close()
            },
          }),
          plainSize: expected.byteLength,
          contentType: 'application/octet-stream',
          lastModified: Date.now(),
          overrides: {},
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
          await slot.driver.del(probePath)
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
      if (ok) {
        markServerHealthy(slot.name)
      } else if (probeError) {
        markServerCooldown(slot.name, probeError)
      }
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
      const normalizedExpectedHash =
        input.expectedHash !== undefined
          ? normalizeExpectedSha256(input.expectedHash)
          : undefined

      const isAutoTarget = !input.server || input.server === 'auto'
      if (!isAutoTarget) {
        const explicitSlot = getSlot(input.server!)
        if (store) await syncServerStateFromStore(explicitSlot.name)
        assertSlotWritable(explicitSlot)
      }

      if (input.overwrite === false) {
        const alreadyExists = await this.has(
          path,
          isAutoTarget ? undefined : { server: input.server },
        )
        if (alreadyExists) {
          throw new StorageOverwriteError(path)
        }
      }

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

        const isAutoServer = !input.server || input.server === 'auto'
        const rawWritePool = currentWritePool()
        const candidates = !isAutoServer
          ? [input.server!]
          : await orderAutoCandidates(rawWritePool)

        if (candidates.length === 0) {
          // Если все пишущие серверы заблокированы (suspended), бросаем StorageServerSuspendedError
          for (const [sName, susp] of suspendedServers.entries()) {
            const s = slots.get(sName)
            if (s && !s.readOnly) {
              throw new StorageServerSuspendedError(sName, susp.reason)
            }
          }
          throw new StorageReadOnlyError(defaultName)
        }

        const resolveReplicaSlots = async (
          primaryName: string,
        ): Promise<NormalizedServerSlot[]> => {
          if (input.replicate === undefined) return []
          if (typeof input.replicate === 'number') {
            if (!Number.isFinite(input.replicate) || input.replicate <= 1) return []
            const wantExtra = Math.floor(input.replicate) - 1
            const orderedPool = await orderAutoCandidates(currentWritePool())
            const out: NormalizedServerSlot[] = []
            for (const sName of orderedPool) {
              if (sName === primaryName) continue
              const s = getSlot(sName)
              if (!s.readOnly && !suspendedServers.has(s.name)) {
                out.push(s)
                if (out.length >= wantExtra) break
              }
            }
            return out
          }
          const seen = new Set<string>([primaryName])
          const out: NormalizedServerSlot[] = []
          for (const rawName of input.replicate) {
            if (!rawName || rawName === 'auto' || seen.has(rawName)) continue
            seen.add(rawName)
            const s = getSlot(rawName)
            if (store) await syncServerStateFromStore(s.name)
            assertSlotWritable(s)
            out.push(s)
          }
          return out
        }

        const verifyExistingPhysicalLive = async (
          existing: StoredFileRecord,
        ): Promise<boolean> => {
          if (
            !isAutoServer &&
            !existing.parts.every((p) => p.server === input.server)
          ) {
            return false
          }
          for (const p of existing.parts) {
            if (p.missingAt !== undefined) return false
            const s = slots.get(p.server)
            if (!s || suspendedServers.has(s.name)) return false
            const headMeta = await s.driver.head(p.path).catch(() => null)
            if (!headMeta || headMeta.size !== p.storedBytes) {
              await reportMissingLocation(existing, p.server, p.path)
              return false
            }
          }
          return true
        }

        const commitDeduplicatedRecord = async (
          existing: StoredFileRecord,
          verifiedHash: string,
        ): Promise<StoredObject> => {
          const cleanParts: StoredPart[] = existing.parts.map((p) => ({
            index: p.index,
            server: p.server,
            path: p.path,
            plainBytes: p.plainBytes,
            storedBytes: p.storedBytes,
            encrypted: p.encrypted,
            ...(p.etag !== undefined ? { etag: p.etag } : {}),
          }))
          const cleanReplicas: StoredReplica[] = (existing.replicas ?? [])
            .filter((r) => r.missingAt === undefined && slots.has(r.server))
            .map((r) => ({ ...r }))

          const record: StoredFileRecord = {
            path,
            name: basenameOfStoragePath(path),
            size: existing.size,
            storedBytes: existing.storedBytes,
            type: contentType,
            lastModified,
            createdAt: Date.now(),
            hash: verifiedHash,
            status: 'ok',
            parts: cleanParts,
            replicas: cleanReplicas,
          }
          const dedupResId = nextReservationId()
          await ledger.reserve({
            id: dedupResId,
            allocations: [],
            ttlMs: reservationTtlMs,
          })
          const { replaced } = await ledger.commit({
            reservationId: dedupResId,
            file: record,
          })
          await invalidateStatCache(path)
          if (replaced) {
            await deleteUnreferencedPhysicalParts(
              collectAllPhysicalPartsOfRecord(replaced),
            )
          }

          // Если при дедупликации запрошены дополнительные реплики, которых ещё нет у файла — доклонируем их
          const primarySrv = cleanParts[0]?.server ?? defaultName
          const extraRepSlots = await resolveReplicaSlots(primarySrv)
          const missingRepSlots = extraRepSlots.filter(
            (rs) => !cleanReplicas.some((r) => r.server === rs.name),
          )
          if (missingRepSlots.length > 0) {
            for (const rs of missingRepSlots) {
              await this.copy({
                path,
                to: rs.name,
                ...(input.key !== undefined ? { key: input.key } : {}),
                ...(input.rate !== undefined ? { rate: input.rate } : {}),
                ...(input.concurrency !== undefined ? { concurrency: input.concurrency } : {}),
                ...(input.meta !== undefined ? { meta: input.meta } : {}),
                ...(input.signal !== undefined ? { signal: input.signal } : {}),
              })
            }
            const refreshed = await ledger.getFile(path)
            if (refreshed) {
              return recordToStoredObject(refreshed, { deduplicated: true })
            }
          }

          return recordToStoredObject(record, { deduplicated: true })
        }

        const replayableFullStream =
          normalized.sliceable !== undefined && expectedPlainSize !== undefined
            ? () => normalized.sliceable!(0, expectedPlainSize)
            : null

        const anyCandidateWantsHash =
          normalizedExpectedHash !== undefined ||
          input.hash === true ||
          (input.hash === undefined && candidates.some((c) => getSlot(c).hash))

        let precomputedHash: string | undefined

        // Сценарий Г.1: replayable-источник с включённым hash / expectedHash — считаем SHA-256 до сети!
        if (anyCandidateWantsHash && replayableFullStream) {
          precomputedHash = await hashStreamSha256(
            replayableFullStream(),
            input.signal,
          )
          if (
            normalizedExpectedHash !== undefined &&
            precomputedHash !== normalizedExpectedHash
          ) {
            throw new StorageHashMismatchError(
              normalizedExpectedHash,
              precomputedHash,
            )
          }
          const existing = await ledger.findByHash(precomputedHash, expectedPlainSize)
          if (existing && (await verifyExistingPhysicalLive(existing))) {
            return commitDeduplicatedRecord(existing, precomputedHash)
          }
        } else if (!replayableFullStream && normalizedExpectedHash !== undefined) {
          // Сценарий Г.2: однопроходный поток + заранее известный expectedHash — проверяем реестр ДО сети!
          const existing = await ledger.findByHash(
            normalizedExpectedHash,
            expectedPlainSize,
          )
          if (existing && (await verifyExistingPhysicalLive(existing))) {
            const actualHash = await hashStreamSha256(normalized.stream, input.signal)
            if (actualHash !== normalizedExpectedHash) {
              throw new StorageHashMismatchError(normalizedExpectedHash, actualHash)
            }
            if (
              expectedPlainSize === undefined &&
              existing.size !== undefined
            ) {
              // Проверяем совпадение размера уже найденной записи при отсутствии input.size
            }
            return commitDeduplicatedRecord(existing, actualHash)
          }
        }

        // Проверяем, требуется ли принудительная нарезка (явные splitServers с split: true)
        const forceExplicitSplit =
          input.split === true &&
          input.splitServers !== undefined &&
          input.splitServers.length > 0

        let lastReadOnly: string | null = null
        let lastOverFileLimit: { server: string; max: number; needed: number } | null = null
        let lastQuotaServer: string | null = null
        let lastDriverError: unknown = null

        // 1. Попытка уложить файл целиком на один подходящий сервер (если не запрошен явный splitServers)
        if (!forceExplicitSplit) {
          for (const candidateName of candidates) {
            const slot = getSlot(candidateName)
            if (slot.readOnly) {
              lastReadOnly = slot.name
              continue
            }
            if (suspendedServers.has(slot.name)) {
              if (!isAutoServer) {
                const susp = suspendedServers.get(slot.name)!
                throw new StorageServerSuspendedError(slot.name, susp.reason)
              }
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

            const replicaSlots = await resolveReplicaSlots(slot.name)
            const validReplicaSlots: NormalizedServerSlot[] = []
            const allocations: ServerAllocation[] = [
              {
                server: slot.name,
                bytes: neededStored,
                maxStorageBytes: slot.limits.storageBytes,
              },
            ]

            for (const repSlot of replicaSlots) {
              const repKey = resolveCallKey(repSlot.key, input.key)
              const repNeeded =
                expectedPlainSize !== undefined
                  ? repKey !== null
                    ? encryptedSize(expectedPlainSize)
                    : expectedPlainSize
                  : 0
              if (repNeeded > repSlot.limits.fileBytes) {
                if (Array.isArray(input.replicate)) {
                  throw new RangeError(
                    `[storage] размер реплики (${repNeeded} Б) превышает лимит файла сервера «${repSlot.name}» (${repSlot.limits.fileBytes} Б)`,
                  )
                }
                continue
              }
              validReplicaSlots.push(repSlot)
              allocations.push({
                server: repSlot.name,
                bytes: repNeeded,
                maxStorageBytes: repSlot.limits.storageBytes,
              })
            }

            const reservationId = nextReservationId()
            const reserved = await ledger.reserve({
              id: reservationId,
              allocations,
              ttlMs: reservationTtlMs,
            })
            if (!reserved) {
              // Если авто-реплика не влезла по квоте, но основной сервер вмещает — пробуем без авто-реплики или идём дальше
              if (
                validReplicaSlots.length > 0 &&
                typeof input.replicate === 'number'
              ) {
                const primaryOnlyRes = await ledger.reserve({
                  id: reservationId,
                  allocations: [allocations[0]!],
                  ttlMs: reservationTtlMs,
                })
                if (primaryOnlyRes) {
                  validReplicaSlots.length = 0
                } else {
                  lastQuotaServer = slot.name
                  continue
                }
              } else {
                const ExplicitFailSrv =
                  Array.isArray(input.replicate) && validReplicaSlots.length > 0
                    ? validReplicaSlots[0]!.name
                    : slot.name
                lastQuotaServer = ExplicitFailSrv
                continue
              }
            }

            const slotWantsHash =
              normalizedExpectedHash !== undefined ||
              (input.hash !== undefined ? input.hash : slot.hash)
            const needStreamHash = slotWantsHash && precomputedHash === undefined

            const writtenTargets: Array<{ srv: NormalizedServerSlot; path: string }> = []
            try {
              const allTargets = [slot, ...validReplicaSlots]
              const streams: ReadableStream<Uint8Array>[] = replayableFullStream
                ? allTargets.map(() => replayableFullStream())
                : fanOutReadableStream(normalized.stream, allTargets.length)

              const results = await Promise.all(
                allTargets.map(async (targetSlot, idx) => {
                  const probeRef: StoredPart = {
                    index: 0,
                    server: targetSlot.name,
                    path,
                    plainBytes: 0,
                    storedBytes: 0,
                    encrypted: false,
                  }
                  const unref = await ledger.filterUnreferencedParts([probeRef], path)
                  const targetPartPath =
                    unref.length > 0
                      ? path
                      : `${path}.cow-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

                  const w = await writePhysicalPart({
                    slot: targetSlot,
                    partPath: targetPartPath,
                    plainStream: streams[idx]!,
                    ...(expectedPlainSize !== undefined
                      ? { plainSize: expectedPlainSize }
                      : {}),
                    contentType,
                    lastModified,
                    overrides: input,
                    ...(idx === 0 && needStreamHash ? { computeHash: true } : {}),
                    ...(idx === 0 &&
                    normalizedExpectedHash !== undefined &&
                    precomputedHash === undefined
                      ? { expectedHash: normalizedExpectedHash }
                      : {}),
                  })
                  writtenTargets.push({ srv: targetSlot, path: w.meta.path })
                  markServerHealthy(targetSlot.name)
                  return { targetSlot, written: w }
                }),
              )

              const primaryRes = results[0]!.written
              const finalHash = precomputedHash ?? primaryRes.plainHash

              // Сценарий Г.3: однопроходный поток с `hash: true` без известного заранее хеша —
              // если уже есть живой файл с таким же SHA-256 под другим путём, освобождаем свежие дубли!
              if (
                finalHash !== undefined &&
                precomputedHash === undefined &&
                validReplicaSlots.length === 0
              ) {
                const existing = await ledger.findByHash(
                  finalHash,
                  primaryRes.plainBytes,
                )
                if (
                  existing &&
                  existing.path !== path &&
                  !(
                    existing.parts.length === 1 &&
                    existing.parts[0]!.server === slot.name &&
                    existing.parts[0]!.path === primaryRes.meta.path
                  ) &&
                  (await verifyExistingPhysicalLive(existing))
                ) {
                  await slot.driver.del(primaryRes.meta.path).catch(() => undefined)
                  await ledger.release(reservationId).catch(() => undefined)
                  return commitDeduplicatedRecord(existing, finalHash)
                }
              }

              const nowTs = Date.now()
              const writtenReplicas: StoredReplica[] = results
                .slice(1)
                .map(({ targetSlot, written }) => ({
                  server: targetSlot.name,
                  path: written.meta.path,
                  storedBytes: written.meta.size,
                  encrypted: written.encrypted,
                  createdAt: nowTs,
                }))

              const record: StoredFileRecord = {
                path,
                name: basenameOfStoragePath(path),
                size: primaryRes.plainBytes,
                storedBytes: primaryRes.meta.size,
                type: primaryRes.meta.contentType,
                lastModified: primaryRes.meta.lastModified,
                createdAt: nowTs,
                ...(finalHash !== undefined ? { hash: finalHash } : {}),
                status: 'ok',
                parts: [
                  {
                    index: 0,
                    server: slot.name,
                    path: primaryRes.meta.path,
                    plainBytes: primaryRes.plainBytes,
                    storedBytes: primaryRes.meta.size,
                    encrypted: primaryRes.encrypted,
                  },
                ],
                replicas: writtenReplicas,
              }
              const { replaced } = await ledger.commit({ reservationId, file: record })
              await invalidateStatCache(path)
              if (replaced) {
                const keptKeys = new Set(
                  collectAllPhysicalPartsOfRecord(record).map(
                    (p) => `${p.server}:${p.path}`,
                  ),
                )
                const oldCandidates = collectAllPhysicalPartsOfRecord(replaced).filter(
                  (p) => !keptKeys.has(`${p.server}:${p.path}`),
                )
                await deleteUnreferencedPhysicalParts(oldCandidates)
              }

              return recordToStoredObject(record)
            } catch (err) {
              for (const wt of writtenTargets) {
                if (!wt.srv.readOnly) {
                  await wt.srv.driver.del(wt.path).catch(() => undefined)
                }
              }
              await ledger.release(reservationId).catch(() => undefined)
              if (isAutoServer && isTransientDriverFailure(err, input.signal)) {
                markServerCooldown(
                  slot.name,
                  err instanceof Error ? err.message : String(err),
                )
                if (replayableFullStream) {
                  lastDriverError = err
                  continue
                }
              }
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
                ...(precomputedHash !== undefined ? { hash: precomputedHash } : {}),
                status: 'ok',
                parts: writtenParts,
                replicas: [],
              }
              const { replaced } = await ledger.commit({
                reservationId: splitPlan.reservationId,
                file: record,
              })
              await invalidateStatCache(path)
              if (replaced) {
                const keptKeys = new Set(writtenParts.map((wp) => `${wp.server}:${wp.path}`))
                const oldCandidates = collectAllPhysicalPartsOfRecord(replaced).filter(
                  (p) => !keptKeys.has(`${p.server}:${p.path}`),
                )
                await deleteUnreferencedPhysicalParts(oldCandidates)
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

        if (lastDriverError !== null) {
          throw lastDriverError
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

    async upload(
      request: Request,
      options?: StorageUploadOptions,
    ): Promise<StorageUploadResult> {
      let defaultMaxFileSize = 0
      const useSplitPool = Boolean(options?.split && options?.stageToDisk)
      for (const s of slots.values()) {
        if (s.readOnly) continue
        if (useSplitPool && s.allowSplit) {
          defaultMaxFileSize += s.limits.storageBytes
        } else if (s.limits.fileBytes > defaultMaxFileSize) {
          defaultMaxFileSize = s.limits.fileBytes
        }
      }
      return executeStorageUpload(request, options, {
        put: (inp) => this.put(inp),
        lazy: (p, opt) => this.lazy(p, opt),
        del: (p, opt) => this.del(p, opt),
        ...(defaultMaxFileSize > 0 ? { defaultMaxFileSize } : {}),
        ...(tech?.resolveMeta ? { resolveMeta: tech.resolveMeta } : {}),
      })
    },

    async has(path: string, options?: StorageReadOptions): Promise<boolean> {
      return (await this.head(path, options)) !== null
    },

    async stat(
      path: string,
      options?: StorageReadOptions,
    ): Promise<StoredFileRecord | null> {
      const clean = normalizeStoragePath(path)
      const explicitServer =
        typeof options?.server === 'string' && options.server !== 'auto'
          ? options.server
          : Array.isArray(options?.server)
            ? options.server.find((s) => Boolean(s) && s !== 'auto')
            : undefined

      if (!explicitServer) {
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
      }

      const slot = getSlot(explicitServer)
      const rec = await ledger.getFile(clean)
      if (rec && rec.parts.some((p) => p.server === slot.name)) {
        return rec
      }
      const inlineRep = rec?.replicas?.find((r) => r.server === slot.name)
      if (rec && inlineRep) {
        return {
          ...rec,
          storedBytes: inlineRep.storedBytes,
          parts: inlineRep.parts ?? [
            {
              index: 0,
              server: inlineRep.server,
              path: inlineRep.path,
              plainBytes: rec.size,
              storedBytes: inlineRep.storedBytes,
              encrypted: inlineRep.encrypted,
              ...(inlineRep.etag !== undefined ? { etag: inlineRep.etag } : {}),
              ...(inlineRep.missingAt !== undefined
                ? { missingAt: inlineRep.missingAt }
                : {}),
            },
          ],
        }
      }
      if (!rec || rec.replicas === undefined) {
        const rep = await ledger.getFile(`@replica:${slot.name}:${clean}`)
        if (rep) {
          return { ...rep, path: clean }
        }
      }
      const meta = await slot.driver.head(clean)
      if (!meta) return null
      const encrypted = resolveCallKey(slot.key, options?.key) !== null
      const plainBytes = encrypted ? decryptedSize(meta.size) : meta.size
      return {
        path: clean,
        name: basenameOfStoragePath(clean),
        size: plainBytes,
        storedBytes: meta.size,
        type: meta.contentType,
        lastModified: meta.lastModified,
        createdAt: meta.lastModified,
        parts: [
          {
            index: 0,
            server: slot.name,
            path: clean,
            plainBytes,
            storedBytes: meta.size,
            encrypted,
          },
        ],
      }
    },

    async list(options?: StorageListOptions): Promise<StorageListResult> {
      const filterServer =
        options?.server && options.server !== 'auto' ? options.server : undefined
      if (filterServer) {
        getSlot(filterServer)
      }

      if (!filterServer) {
        const page = await ledger.listFiles({
          ...(options?.prefix !== undefined ? { prefix: options.prefix } : {}),
          ...(options?.limit !== undefined ? { limit: options.limit } : {}),
          ...(options?.cursor !== undefined ? { cursor: options.cursor } : {}),
        })
        return {
          entries: page.entries.map((r) => recordToStoredObject(r)),
          records: page.entries,
          ...(page.cursor !== undefined ? { cursor: page.cursor } : {}),
        }
      }

      const wantLimit =
        options?.limit && options.limit > 0 ? Math.floor(options.limit) : undefined
      const matchedRecords: StoredFileRecord[] = []
      let cur = options?.cursor
      let nextCursor: string | undefined

      for (;;) {
        const batchSize = wantLimit ? Math.max(wantLimit * 2, 50) : 200
        const page = await ledger.listFiles({
          ...(options?.prefix !== undefined ? { prefix: options.prefix } : {}),
          limit: batchSize,
          ...(cur !== undefined ? { cursor: cur } : {}),
        })
        for (let i = 0; i < page.entries.length; i++) {
          const rec = page.entries[i]!
          if (
            rec.parts.some((p) => p.server === filterServer) ||
            (options?.includeReplicas === true &&
              Boolean(rec.replicas?.some((r) => r.server === filterServer)))
          ) {
            matchedRecords.push(rec)
            if (wantLimit !== undefined && matchedRecords.length >= wantLimit) {
              const hasMoreInBatch = i + 1 < page.entries.length
              if (hasMoreInBatch || page.cursor !== undefined) {
                nextCursor = rec.path
              }
              return {
                entries: matchedRecords.map((r) => recordToStoredObject(r)),
                records: matchedRecords,
                ...(nextCursor !== undefined ? { cursor: nextCursor } : {}),
              }
            }
          }
        }
        if (page.cursor === undefined || page.entries.length === 0) {
          break
        }
        cur = page.cursor
      }

      return {
        entries: matchedRecords.map((r) => recordToStoredObject(r)),
        records: matchedRecords,
      }
    },

    async head(path: string, options?: StorageReadOptions): Promise<StoredObject | null> {
      const clean = normalizeStoragePath(path)
      const isAutoRead = !options?.server || options.server === 'auto'
      const rec = isAutoRead ? await this.stat(clean) : await ledger.getFile(clean)

      if (isAutoRead && rec && rec.parts.length > 1) {
        const primaryPartsAvailable = rec.parts.every(
          (p) => p.missingAt === undefined && !suspendedServers.has(p.server),
        )
        if (primaryPartsAvailable) {
          return recordToStoredObject(rec)
        }
      }

      const readCandidates = await resolveReadCandidates(
        clean,
        options?.server,
        options?.readStrategy,
        options?.affinityKey,
        rec,
      )
      let lastErr: unknown = null

      for (let i = 0; i < readCandidates.length; i++) {
        const slot = readCandidates[i]!
        const hasMoreCandidates = i + 1 < readCandidates.length

        try {
          if (rec && rec.parts.length === 1 && rec.parts[0]!.server === slot.name) {
            const part = rec.parts[0]!
            const exists = await slot.driver.head(part.path)
            if (exists) {
              markServerHealthy(slot.name)
              return recordToStoredObject(rec)
            }
            await reportMissingLocation(rec, slot.name, part.path)
            if (hasMoreCandidates) continue
            return null
          }

          const inlineRep = rec?.replicas?.find((r) => r.server === slot.name)
          if (rec && inlineRep) {
            const meta = await slot.driver.head(inlineRep.path)
            if (!meta) {
              await reportMissingLocation(rec, slot.name, inlineRep.path)
              if (hasMoreCandidates) continue
              return null
            }
            markServerHealthy(slot.name)
            const builtBase = toStoredObject(meta, slot, rec.size, inlineRep.encrypted)
            const replicaNames = rec.replicas?.map((r) => r.server)
            return {
              ...builtBase,
              path: rec.path,
              contentType: rec.type,
              lastModified: rec.lastModified,
              ...(rec.hash !== undefined ? { hash: rec.hash } : {}),
              ...(replicaNames && replicaNames.length > 0
                ? { replicas: replicaNames }
                : {}),
            }
          }

          const replicaRec =
            !rec || rec.replicas === undefined
              ? await ledger.getFile(`@replica:${slot.name}:${clean}`)
              : null

          if (store && slot.statTtlMs) {
            const cacheKey = `head:${slot.name}:${clean}`
            const cached = await store.get<StoredObject>(cacheKey)
            if (cached) return cached
            const meta = await slot.driver.head(clean)
            if (!meta) {
              if (hasMoreCandidates) continue
              return null
            }
            markServerHealthy(slot.name)
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
          if (!meta) {
            if (hasMoreCandidates) continue
            return null
          }
          markServerHealthy(slot.name)
          if (replicaRec && replicaRec.parts[0]) {
            return toStoredObject(meta, slot, replicaRec.size, replicaRec.parts[0].encrypted)
          }
          const effectiveKey = resolveCallKey(slot.key, options?.key)
          const plain = effectiveKey !== null ? decryptedSize(meta.size) : meta.size
          return toStoredObject(meta, slot, plain, effectiveKey !== null)
        } catch (err) {
          if (isTransientDriverFailure(err, options?.signal)) {
            markServerCooldown(
              slot.name,
              err instanceof Error ? err.message : String(err),
            )
            if (hasMoreCandidates) {
              lastErr = err
              continue
            }
          }
          throw err
        }
      }

      if (lastErr !== null) throw lastErr
      return null
    },

    async lazy(path: string, options?: StorageReadOptions): Promise<StreamFile | null> {
      const clean = normalizeStoragePath(path)
      const rec = await ledger.getFile(clean)
      const isAutoRead = !options?.server || options.server === 'auto'

      if (rec && isAutoRead && rec.parts.length > 1) {
        const primaryPartsAvailable = rec.parts.every(
          (p) => p.missingAt === undefined && !suspendedServers.has(p.server),
        )
        const hasHealthyReplica = Boolean(
          rec.replicas?.some(
            (r) =>
              r.missingAt === undefined &&
              slots.has(r.server) &&
              !suspendedServers.has(r.server),
          ),
        )
        if (primaryPartsAvailable && (!hasHealthyReplica || (options?.readStrategy ?? defaultReadStrategy) === 'primary')) {
          return assembleMultiPartStreamFile(rec, options)
        }
      }

      const readCandidates = await resolveReadCandidates(
        clean,
        options?.server,
        options?.readStrategy,
        options?.affinityKey,
        rec,
      )
      let lastErr: unknown = null

      for (let i = 0; i < readCandidates.length; i++) {
        const slot = readCandidates[i]!
        const hasMoreCandidates = i + 1 < readCandidates.length

        try {
          if (rec && rec.parts.length > 1 && rec.parts[0]!.server === slot.name) {
            return assembleMultiPartStreamFile(rec, options)
          }

          if (rec && rec.parts.length === 1 && rec.parts[0]!.server === slot.name) {
            const part = rec.parts[0]!
            const opened = await openPartPlainFile(
              part,
              rec.type,
              rec.lastModified,
              options,
            )
            if (opened) {
              markServerHealthy(slot.name)
              return opened
            }
            await reportMissingLocation(rec, slot.name, part.path)
            if (hasMoreCandidates) continue
            return null
          }

          const inlineRep = rec?.replicas?.find((r) => r.server === slot.name)
          if (rec && inlineRep) {
            const repPart: StoredPart = {
              index: 0,
              server: inlineRep.server,
              path: inlineRep.path,
              plainBytes: rec.size,
              storedBytes: inlineRep.storedBytes,
              encrypted: inlineRep.encrypted,
              ...(inlineRep.etag !== undefined ? { etag: inlineRep.etag } : {}),
            }
            const opened = await openPartPlainFile(
              repPart,
              rec.type,
              rec.lastModified,
              options,
            )
            if (opened) {
              markServerHealthy(slot.name)
              return opened
            }
            await reportMissingLocation(rec, slot.name, inlineRep.path)
            if (hasMoreCandidates) continue
            return null
          }

          const replicaRec =
            !rec || rec.replicas === undefined
              ? await ledger.getFile(`@replica:${slot.name}:${clean}`)
              : null
          if (replicaRec && replicaRec.parts[0]) {
            const opened = await openPartPlainFile(
              replicaRec.parts[0],
              replicaRec.type,
              replicaRec.lastModified,
              options,
            )
            if (opened) {
              markServerHealthy(slot.name)
              return opened
            }
            if (hasMoreCandidates) continue
            return null
          }

          const raw = await slot.driver.lazy(clean)
          if (!raw) {
            if (hasMoreCandidates) continue
            return null
          }
          markServerHealthy(slot.name)

          const controlledRaw = new StreamFile(
            {
              byteLength: raw.size,
              stream(start = 0, end = raw.size) {
                return wrapSlotReadControls(
                  raw.slice(start, end).stream(),
                  slot,
                  clean,
                  options,
                )
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
        } catch (err) {
          if (isTransientDriverFailure(err, options?.signal)) {
            markServerCooldown(
              slot.name,
              err instanceof Error ? err.message : String(err),
            )
            if (hasMoreCandidates) {
              lastErr = err
              continue
            }
          }
          throw err
        }
      }

      if (lastErr !== null) throw lastErr
      return null
    },

    async get(
      path: string,
      options?: StorageReadOptions,
    ): Promise<ReadableStream<Uint8Array> | null> {
      const file = await this.lazy(path, options)
      return file ? file.stream() : null
    },

    async serve(
      target: StorageServeTarget,
      request: Request,
      options?: StorageServeOptions,
    ): Promise<Response> {
      let meta = options?.meta
      if (!meta && tech?.resolveMeta) {
        meta = await tech.resolveMeta(request)
      }
      const effectiveOptions: StorageServeOptions = {
        ...options,
        ...(meta ? { meta } : {}),
      }

      const isFileTarget = typeof File !== 'undefined' && target instanceof File
      const isRecordTarget =
        !isFileTarget &&
        typeof target === 'object' &&
        target !== null &&
        Array.isArray((target as StoredFileRecord).parts)

      const cleanPath =
        typeof target === 'string'
          ? normalizeStoragePath(target)
          : isRecordTarget
            ? normalizeStoragePath((target as StoredFileRecord).path)
            : null

      if (effectiveOptions.cdn && cleanPath !== null) {
        const rec = isRecordTarget
          ? (target as StoredFileRecord)
          : await ledger.getFile(cleanPath)
        const cdnCandidates = await resolveReadCandidates(
          cleanPath,
          effectiveOptions.server,
          effectiveOptions.readStrategy,
          effectiveOptions.affinityKey,
          rec,
        )
        const slot =
          cdnCandidates.find((s) => Boolean(s.cdnUrl)) ??
          cdnCandidates[0] ??
          (await resolveReadSlot(cleanPath, effectiveOptions.server, rec))

        const isMultiPart =
          Boolean(rec && rec.parts.length > 1) &&
          !rec?.replicas?.some((r) => r.server === slot.name)
        const repOnSlot = rec?.replicas?.find((r) => r.server === slot.name)
        const isEncrypted = repOnSlot
          ? repOnSlot.encrypted
          : Boolean(rec?.parts.some((p) => p.encrypted)) ||
            resolveCallKey(slot.key, effectiveOptions.key) !== null

        if (!slot.cdnUrl) {
          reportDegradedOption(
            `cdn: true (сервер «${slot.name}»)`,
            `cdnUrl в конфигурации сервера «${slot.name}»`,
          )
        } else if (isMultiPart || isEncrypted) {
          reportDegradedOption(
            `cdn: true («${cleanPath}»)`,
            'одночастный незашифрованный объект (зашифрованные и нарезанные файлы отдаются напрямую)',
          )
        } else {
          const physicalTarget = repOnSlot ? repOnSlot.path : cleanPath
          const encodedPath = physicalTarget.split('/').map(encodeURIComponent).join('/')
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
        let file: StreamFile | null = null
        let fallbackName = 'download'
        let gateForReject: ConcurrencyGate | null = null
        let resolvedRecord: StoredFileRecord | null = null

        if (isFileTarget) {
          const inputFile = target as File
          fallbackName = inputFile.name || 'download'
          const baseLazy =
            inputFile instanceof StreamFile
              ? inputFile
              : new StreamFile(
                  {
                    byteLength: inputFile.size,
                    stream: (s = 0, e = inputFile.size) =>
                      streamBlobSlices(inputFile, s, e) as ReadableStream<
                        Uint8Array<ArrayBuffer>
                      >,
                  },
                  fallbackName,
                  { type: inputFile.type, lastModified: inputFile.lastModified },
                )

          const adhocLimiter = resolveCallRate(null, effectiveOptions.rate)
          const adhocGate = resolveCallConcurrency(
            'serve',
            null,
            effectiveOptions.concurrency,
          )
          gateForReject = adhocGate

          if (adhocLimiter || adhocGate) {
            const syntheticSlot: NormalizedServerSlot = {
              name: 'serve',
              driver: slots.get(defaultName)!.driver,
              limits: DEFAULT_UNBOUNDED_LIMITS,
              readOnly: true,
              allowSplit: false,
              key: null,
              rateLimiter: adhocLimiter,
              concurrencyGate: adhocGate,
              hash: false,
              initialSuspended: false,
            }
            file = new StreamFile(
              {
                byteLength: baseLazy.size,
                stream(s = 0, e = baseLazy.size) {
                  return wrapSlotReadControls(
                    baseLazy.slice(s, e).stream(),
                    syntheticSlot,
                    fallbackName,
                    effectiveOptions,
                  )
                },
              },
              fallbackName,
              { type: baseLazy.type, lastModified: baseLazy.lastModified },
            )
          } else {
            file = baseLazy
          }
        } else if (isRecordTarget) {
          const rec = target as StoredFileRecord
          resolvedRecord = rec
          fallbackName = rec.name || basenameOfStoragePath(cleanPath!)
          const hasReplicas = Boolean(rec.replicas && rec.replicas.length > 0)
          const nonPrimaryStrategy =
            (effectiveOptions.readStrategy ?? defaultReadStrategy) !== 'primary'

          if (
            rec.parts.length > 1 &&
            rec.parts.every(
              (p) => p.missingAt === undefined && !suspendedServers.has(p.server),
            ) &&
            !(hasReplicas && nonPrimaryStrategy)
          ) {
            file = assembleMultiPartStreamFile(rec, effectiveOptions)
          } else if (
            rec.parts.length === 1 &&
            rec.parts[0]!.missingAt === undefined &&
            !suspendedServers.has(rec.parts[0]!.server) &&
            !(hasReplicas && nonPrimaryStrategy) &&
            (!effectiveOptions.server || effectiveOptions.server === 'auto')
          ) {
            file = await openPartPlainFile(
              rec.parts[0]!,
              rec.type,
              rec.lastModified,
              effectiveOptions,
            )
            if (!file) {
              await reportMissingLocation(rec, rec.parts[0]!.server, rec.parts[0]!.path)
              file = await this.lazy(cleanPath!, effectiveOptions)
            }
          } else {
            file = await this.lazy(cleanPath!, effectiveOptions)
          }
          const primaryServer = rec.parts[0]?.server ?? defaultName
          const slot = slots.get(primaryServer) ?? getSlot(defaultName)
          gateForReject = resolveCallConcurrency(
            slot.name,
            slot.concurrencyGate,
            effectiveOptions.concurrency,
          )
        } else {
          fallbackName = basenameOfStoragePath(cleanPath!)
          resolvedRecord = await ledger.getFile(cleanPath!)
          file = await this.lazy(cleanPath!, effectiveOptions)
          const slot = await resolveReadSlot(
            cleanPath!,
            effectiveOptions.server,
            resolvedRecord,
          )
          gateForReject = resolveCallConcurrency(
            slot.name,
            slot.concurrencyGate,
            effectiveOptions.concurrency,
          )
        }

        if (!file) {
          return new Response('Not Found', {
            status: 404,
            headers: { 'cache-control': 'no-store' },
          })
        }

        // По RFC 9110 §13.1.5 браузеры (Chromium, Safari, Firefox) и менеджеры закачек
        // подставляют `If-Range` для авто-докачки прерванного потока ТОЛЬКО с сильным `ETag`
        // (без префикса `W/`). Генерируем сильный дескриптор за O(1) памяти без чтения тела.
        const etagMode = effectiveOptions.etag ?? 'strong'
        const metadataDigest =
          etagMode === 'strong'
            ? async (f: { readonly name: string; readonly size: number; readonly lastModified: number }) => {
                const partsSig = resolvedRecord
                  ? resolvedRecord.parts
                      .map((p) => `${p.server}:${p.storedBytes}:${p.etag ?? ''}`)
                      .join(',')
                  : ''
                const rawDesc = `mks1|${cleanPath ?? f.name}|${f.size}|${Math.trunc(f.lastModified)}|${resolvedRecord?.createdAt ?? 0}|${resolvedRecord?.hash ?? ''}|${partsSig}`
                const hash = await crypto.subtle.digest(
                  'SHA-256',
                  new TextEncoder().encode(rawDesc),
                )
                return Array.from(new Uint8Array(hash).subarray(0, 16))
                  .map((b) => b.toString(16).padStart(2, '0'))
                  .join('')
              }
            : undefined

        const res = await createFileResponse(file, request, {
          acceptRanges: effectiveOptions.acceptRanges ?? true,
          etag: etagMode,
          ...(metadataDigest ? { digest: metadataDigest } : {}),
          ...(effectiveOptions.cacheControl !== undefined
            ? { cacheControl: effectiveOptions.cacheControl }
            : {}),
        })

        const isPayloadResponse = res.status === 200 || res.status === 206

        // Проверяем не сработал ли лимит concurrency при открытии потока (для мгновенного ответа 429 до отправки заголовков)
        if (isPayloadResponse && res.body && (request.method === 'GET' || !request.method)) {
          if (gateForReject && gateForReject.config.mode === 'reject') {
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
                  : fallbackName
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
          isPayloadResponse &&
          (Boolean(effectiveOptions.download) || isPotentiallyActiveMime(file.type))
        if (forceAttachment) {
          const downloadName =
            typeof effectiveOptions.download === 'string' &&
            effectiveOptions.download.trim()
              ? effectiveOptions.download.trim()
              : fallbackName
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
        const candidates = collectAllPhysicalPartsOfRecord(recorded)

        // Собираем устаревшие `@replica:` записи только если их могли создать старые версии
        if (recorded.replicas === undefined) {
          for (const serverName of slots.keys()) {
            const repKey = `@replica:${serverName}:${clean}`
            const rep = await ledger.getFile(repKey)
            if (rep) {
              candidates.push(...rep.parts)
              await ledger.deleteFile(repKey)
            }
          }
        }

        await ledger.deleteFile(clean)
        await deleteUnreferencedPhysicalParts(candidates)
        await invalidateStatCache(clean)
        return true
      }

      const slot = await resolveReadSlot(clean, options?.server, recorded)
      if (slot.readOnly) {
        throw new StorageReadOnlyError(slot.name)
      }

      if (recorded) {
        const inlineRep = recorded.replicas?.find((r) => r.server === slot.name)
        if (inlineRep) {
          const repPart: StoredPart = {
            index: 0,
            server: inlineRep.server,
            path: inlineRep.path,
            plainBytes: recorded.size,
            storedBytes: inlineRep.storedBytes,
            encrypted: inlineRep.encrypted,
          }
          await ledger.patchFile(clean, (cur) => {
            const nextReps = (cur.replicas ?? []).filter((r) => r.server !== slot.name)
            const draft: StoredFileRecord = { ...cur, replicas: nextReps }
            return { ...draft, status: computeRecordHealthStatus(draft) }
          })
          await deleteUnreferencedPhysicalParts([repPart])
          await invalidateStatCache(clean)
          return true
        }

        if (recorded.parts.length === 1 && recorded.parts[0]?.server === slot.name) {
          const oldPart = recorded.parts[0]!
          const remainingReps = recorded.replicas ?? []
          if (remainingReps.length > 0) {
            const [promoted, ...restReps] = remainingReps
            await ledger.patchFile(clean, (cur) => {
              const draft: StoredFileRecord = {
                ...cur,
                storedBytes: promoted!.storedBytes,
                parts: [
                  {
                    index: 0,
                    server: promoted!.server,
                    path: promoted!.path,
                    plainBytes: cur.size,
                    storedBytes: promoted!.storedBytes,
                    encrypted: promoted!.encrypted,
                    ...(promoted!.etag !== undefined ? { etag: promoted!.etag } : {}),
                    ...(promoted!.missingAt !== undefined
                      ? { missingAt: promoted!.missingAt }
                      : {}),
                  },
                ],
                replicas: restReps,
              }
              return { ...draft, status: computeRecordHealthStatus(draft) }
            })
            await deleteUnreferencedPhysicalParts([oldPart])
            await invalidateStatCache(clean)
            return true
          }

          await ledger.deleteFile(clean)
          await deleteUnreferencedPhysicalParts([oldPart])
          await invalidateStatCache(clean)
          return true
        }
      }

      const removed = await slot.driver.del(clean)
      await ledger.deleteFile(`@replica:${slot.name}:${clean}`)
      await invalidateStatCache(clean)
      return removed
    },

    async copy(input: StorageTransferInput): Promise<StoredObject> {
      const srcPath = normalizeStoragePath(input.path)
      const dstPath = input.toPath ? normalizeStoragePath(input.toPath) : srcPath
      const dstSlot = getSlot(input.to)
      if (store) await syncServerStateFromStore(dstSlot.name)
      assertSlotWritable(dstSlot)

      const recorded = await ledger.getFile(srcPath)
      const srcSlot = await resolveReadSlot(srcPath, input.from, recorded)

      if (
        (!recorded || recorded.parts.length === 1) &&
        srcSlot.name === dstSlot.name &&
        srcPath === dstPath
      ) {
        const headObj = await this.head(srcPath, { server: srcSlot.name })
        if (!headObj) throw new RangeError(`[storage] исходный файл не найден: «${srcPath}»`)
        return headObj
      }

      // Если копия создаётся под тем же относительным путём на другом сервере, храним реплику
      // прямо в `recorded.replicas` без загрязнения пространства имён `@replica:`!
      const isServerReplica =
        dstPath === srcPath &&
        (srcSlot.name !== dstSlot.name || Boolean(recorded && recorded.parts.length > 1))

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
            ...(recorded?.hash !== undefined ? { hash: recorded.hash } : {}),
            status: 'ok',
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
            replicas: [],
          }
          const { replaced } = await ledger.commit({ reservationId, file: nextRec })
          await invalidateStatCache(dstPath)
          if (replaced) {
            const oldCandidates = collectAllPhysicalPartsOfRecord(replaced).filter(
              (p) => p.server !== dstSlot.name || p.path !== dstPath,
            )
            await deleteUnreferencedPhysicalParts(oldCandidates)
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
          await reportMissingLocation(recorded, srcSlot.name, part.path)
          throw new RangeError(
            `[storage] исходный зашифрованный файл «${srcPath}» не найден на сервере «${srcSlot.name}»`,
          )
        }
        const alreadyHasReplica = Boolean(
          isServerReplica &&
            recorded.replicas?.some((r) => r.server === dstSlot.name && r.path === dstPath),
        )
        const reservationId = nextReservationId()
        const reserved = await ledger.reserve({
          id: reservationId,
          allocations: alreadyHasReplica
            ? []
            : [
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
          if (isServerReplica) {
            const newReplica: StoredReplica = {
              server: dstSlot.name,
              path: dstPath,
              storedBytes: meta.size,
              encrypted: true,
              createdAt: Date.now(),
            }
            const updated = await ledger.patchFile(srcPath, (cur) => {
              const nextReps = upsertStoredReplica(cur.replicas, newReplica)
              const draft: StoredFileRecord = { ...cur, replicas: nextReps }
              return { ...draft, status: computeRecordHealthStatus(draft) }
            })
            await ledger.release(reservationId).catch(() => undefined)
            await invalidateStatCache(dstPath)
            const built = toStoredObject(meta, dstSlot, recorded.size, true)
            return {
              ...built,
              ...(recorded.hash !== undefined ? { hash: recorded.hash } : {}),
              ...(updated?.replicas && updated.replicas.length > 0
                ? { replicas: updated.replicas.map((r) => r.server) }
                : {}),
            }
          }

          const nextRec: StoredFileRecord = {
            path: dstPath,
            name: basenameOfStoragePath(dstPath),
            size: recorded.size,
            storedBytes: meta.size,
            type: recorded.type,
            lastModified: recorded.lastModified,
            createdAt: Date.now(),
            ...(recorded.hash !== undefined ? { hash: recorded.hash } : {}),
            status: 'ok',
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
            replicas: [],
          }
          const { replaced } = await ledger.commit({ reservationId, file: nextRec })
          await invalidateStatCache(dstPath)
          if (replaced) {
            const oldCandidates = collectAllPhysicalPartsOfRecord(replaced).filter(
              (p) => p.server !== dstSlot.name || p.path !== dstPath,
            )
            await deleteUnreferencedPhysicalParts(oldCandidates)
          }
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
          ...(recorded?.hash !== undefined ? { hash: true } : {}),
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
      const alreadyHasReplica = Boolean(
        recorded?.replicas?.some((r) => r.server === dstSlot.name && r.path === dstPath),
      )
      const reservationId = nextReservationId()
      const reserved = await ledger.reserve({
        id: reservationId,
        allocations: alreadyHasReplica
          ? []
          : [
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

        if (recorded) {
          const newReplica: StoredReplica = {
            server: dstSlot.name,
            path: dstPath,
            storedBytes: written.meta.size,
            encrypted: written.encrypted,
            createdAt: Date.now(),
          }
          const updated = await ledger.patchFile(srcPath, (cur) => {
            const nextReps = upsertStoredReplica(cur.replicas, newReplica)
            const draft: StoredFileRecord = { ...cur, replicas: nextReps }
            return { ...draft, status: computeRecordHealthStatus(draft) }
          })
          await ledger.release(reservationId).catch(() => undefined)
          await invalidateStatCache(dstPath)
          const built = toStoredObject(
            written.meta,
            dstSlot,
            written.plainBytes,
            written.encrypted,
          )
          return {
            ...built,
            ...(recorded.hash !== undefined ? { hash: recorded.hash } : {}),
            ...(updated?.replicas && updated.replicas.length > 0
              ? { replicas: updated.replicas.map((r) => r.server) }
              : {}),
          }
        }

        const repRec: StoredFileRecord = {
          path: dstPath,
          name: basenameOfStoragePath(dstPath),
          size: written.plainBytes,
          storedBytes: written.meta.size,
          type: written.meta.contentType,
          lastModified: written.meta.lastModified,
          createdAt: Date.now(),
          status: 'ok',
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
          replicas: [],
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
      if (store) await syncServerStateFromStore(dstSlot.name)
      assertSlotWritable(dstSlot)

      const recorded = await ledger.getFile(srcPath)
      const srcSlot = await resolveReadSlot(srcPath, input.from, recorded)
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

      if (srcPath === dstPath && recorded) {
        await ledger.patchFile(dstPath, (cur) => {
          const targetRep = cur.replicas?.find((r) => r.server === dstSlot.name)
          const remainingReps = (cur.replicas ?? []).filter(
            (r) => r.server !== dstSlot.name && r.server !== srcSlot.name,
          )
          const nextStoredBytes = targetRep
            ? targetRep.storedBytes
            : (copied.storedBytes ?? copied.size)
          const nextEncrypted = targetRep ? targetRep.encrypted : Boolean(copied.encrypted)
          const draft: StoredFileRecord = {
            ...cur,
            storedBytes: nextStoredBytes,
            parts: [
              {
                index: 0,
                server: dstSlot.name,
                path: dstPath,
                plainBytes: cur.size,
                storedBytes: nextStoredBytes,
                encrypted: nextEncrypted,
              },
            ],
            replicas: remainingReps,
          }
          return { ...draft, status: computeRecordHealthStatus(draft) }
        })
      } else {
        // Обратная совместимость со старыми записями без `recorded`
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
      }

      if (recorded && (!input.from || input.from === 'auto' || recorded.parts.length > 1)) {
        const oldParts = recorded.parts.filter(
          (p) => p.server !== dstSlot.name || p.path !== dstPath,
        )
        if (srcPath !== dstPath) {
          await ledger.deleteFile(srcPath)
        }
        await deleteUnreferencedPhysicalParts(oldParts)
      } else if (srcSlot.name !== dstSlot.name || srcPath !== dstPath) {
        if (srcPath !== dstPath) {
          await ledger.deleteFile(srcPath)
        }
        await ledger.deleteFile(`@replica:${srcSlot.name}:${srcPath}`)
        await deleteUnreferencedPhysicalParts([
          {
            index: 0,
            server: srcSlot.name,
            path: srcPath,
            plainBytes: copied.size,
            storedBytes: copied.storedBytes ?? copied.size,
            encrypted: Boolean(copied.encrypted),
          },
        ])
      }

      await invalidateStatCache(srcPath)
      await invalidateStatCache(dstPath)
      return copied
    },

    async clone(input: StorageCloneInput): Promise<StorageCloneReport> {
      const fromSlot = getSlot(input.from)
      const toSlot = getSlot(input.to)
      if (store) await syncServerStateFromStore(toSlot.name)
      assertSlotWritable(toSlot)

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
        const onSource =
          rec.parts.some((p) => p.server === fromSlot.name) ||
          Boolean(rec.replicas?.some((r) => r.server === fromSlot.name))
        if (!onSource) {
          continue
        }

        if (!input.overwrite) {
          const alreadyReplicated = Boolean(
            rec.replicas?.some(
              (r) => r.server === toSlot.name && r.missingAt === undefined,
            ),
          )
          if (alreadyReplicated) {
            skippedPaths.push(rec.path)
            continue
          }
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
      const now = Date.now()
      const currentNames = [...slots.keys()]
      if (store) {
        await Promise.all(currentNames.map((n) => syncServerStateFromStore(n)))
      }
      const snap = await ledger.usage(currentNames)
      const serverReports: StorageServerReport[] = currentNames.map((name) => {
        const slot = slots.get(name)!
        const healthy = isServerHealthy(name, now)
        const susp = suspendedServers.get(name)
        const cooldownUntil = cooldowns.get(name)
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
          healthy,
          suspended: Boolean(susp),
          ...(susp ? { suspendedReason: susp.reason } : {}),
          missingCount: missingCounts.get(name) ?? 0,
          ...(cooldownUntil !== undefined ? { cooldownUntil } : {}),
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
