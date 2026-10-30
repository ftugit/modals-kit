// Серверный сборщик хранилища файлов приложения.
//
// `0` ключей в `.env`, `0` локальных конфиг-файлов, `0` записей паролей в общей БД:
// базовые серверы (`local`, `memory` и зашифрованная пара `shard_a` + `shard_b` для наглядной
// демонстрации нарезки `split` и склейки `Range 206`) доступны сразу, а пользовательские
// S3 и WebDAV-серверы подключаются на лету из зашифрованного куки-сейфа браузера (`storageVaultSchema`).
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Cookies } from '@sveltejs/kit'
import { storageVaultSchema } from '#content/storage-vault/schema.js'
import { readVaultEntries } from '#hooks/cookie-vault/vault.server.js'
import { cacheStorageStore } from '#hooks/storage-db.js'
import {
  createConcurrencyGate,
  createStorage,
  memoryDriver,
  type ConcurrencyInput,
  type Storage,
  type StorageServerEntry,
  type WriteStrategy,
} from '#lib/storage/index.js'
import { jsonLedger, localDriver, localSpool } from '#lib/storage/local.js'
import { s3Driver } from '#lib/storage/s3.js'
import { createStorageState, type StorageTelemetrySnapshot } from '#lib/storage/state.js'
import { isWebdavDsn, webdavDriver } from '#lib/storage/webdav.js'
import { localStore } from './cache.server.js'
import { clientIpOf, normalizeClientIp, type ClientAddressSource } from './client-ip.server.js'
import { createSafeStorageFetch, validateStorageTargetUrl } from './safe-storage-fetch.server.js'

const KB = 1024
const MB = 1024 * KB

export const UPLOAD_ROOT_DIR = join(tmpdir(), 'modals-kit-uploads')
export const UPLOAD_LEDGER_FILE = join(UPLOAD_ROOT_DIR, '_ledger.json')
export const UPLOAD_SPOOL_DIR = join(UPLOAD_ROOT_DIR, '.spool')

const sharedLocalDriver = localDriver({
  rootDir: UPLOAD_ROOT_DIR,
  publicBaseUrl: '/api/files',
})

const sharedMemoryDriver = memoryDriver({
  publicBaseUrl: '/api/files',
})

const sharedShardADriver = memoryDriver({
  publicBaseUrl: '/api/files',
})

const sharedShardBDriver = memoryDriver({
  publicBaseUrl: '/api/files',
})

export const sharedUploadLedger = jsonLedger({ filePath: UPLOAD_LEDGER_FILE })
export const sharedUploadSpool = localSpool(UPLOAD_SPOOL_DIR)
export const sharedUploadStore = cacheStorageStore(
  localStore.scope('upload-demo:storage', { max: 512 }),
)
export const demoStorageState = createStorageState()

// Общие между HTTP-запросами семафоры параллельных скачиваний для режимов DemoPanel
const sharedDownloadGates = {
  reject_1: createConcurrencyGate('demo-dl-reject', { max: 1, mode: 'reject' }),
  queue_1: createConcurrencyGate('demo-dl-queue', {
    max: 1,
    mode: 'queue',
    queueTimeoutMs: 15_000,
  }),
  preempt_1: createConcurrencyGate('demo-dl-preempt', { max: 1, mode: 'preempt' }),
} as const

export function resolveDemoConcurrencyOverride(
  mode: string | null | undefined,
): ConcurrencyInput {
  if (!mode || mode === 'default') return undefined
  if (mode === '0') return 0
  if (mode === 'reject_1') return sharedDownloadGates.reject_1
  if (mode === 'queue_1') return sharedDownloadGates.queue_1
  if (mode === 'preempt_1') return sharedDownloadGates.preempt_1
  return undefined
}

export function getDemoStorageTelemetry(): StorageTelemetrySnapshot {
  return demoStorageState.getSnapshot()
}

function baseServers(): Record<string, StorageServerEntry> {
  return {
    local: {
      driver: sharedLocalDriver,
      statTtlMs: 30_000,
      limits: {
        storageBytes: 2 * 1024 * MB,
        fileBytes: 512 * MB,
      },
    },
    memory: {
      driver: sharedMemoryDriver,
      statTtlMs: 30_000,
      limits: {
        storageBytes: 128 * MB,
        fileBytes: 64 * MB,
      },
    },
    shard_a: {
      driver: sharedShardADriver,
      key: 'demo-shard-a-aes256-key',
      statTtlMs: 30_000,
      limits: {
        storageBytes: 64 * MB,
        fileBytes: 512 * KB,
      },
    },
    shard_b: {
      driver: sharedShardBDriver,
      key: 'demo-shard-b-aes256-key',
      statTtlMs: 30_000,
      limits: {
        storageBytes: 64 * MB,
        fileBytes: 512 * KB,
      },
    },
  }
}

function resolveRequestMeta(request: Request, event?: ClientAddressSource) {
  const ip =
    clientIpOf(event, request) ??
    normalizeClientIp(request.headers.get('x-real-ip')) ??
    '127.0.0.1'
  const clientId = request.headers.get('x-demo-client')?.trim().slice(0, 64) || undefined
  return {
    ip,
    ...(clientId ? { clientId } : {}),
  }
}

/** Базовый экземпляр без кук (встроенные `local`, `memory`, `shard_a`, `shard_b`). */
export const appStorage: Storage = createStorage({
  defaultServer: 'local',
  writePool: ['local', 'memory'],
  cooldownMs: 15_000,
  ledger: sharedUploadLedger,
  spool: sharedUploadSpool,
  store: sharedUploadStore,
  state: demoStorageState.onEvent,
  tech: { resolveMeta: (req) => resolveRequestMeta(req) },
  servers: baseServers(),
})

export interface ResolveRequestStorageOptions {
  readonly writeStrategy?: WriteStrategy
  readonly event?: ClientAddressSource
}

/**
 * Собрать экземпляр `Storage` для конкретного HTTP/WS-запроса:
 * объединяет встроенные серверы с S3/WebDAV-серверами из зашифрованного куки-сейфа браузера.
 */
export async function resolveRequestStorage(
  cookies: Cookies,
  options?: ResolveRequestStorageOptions,
): Promise<Storage> {
  const servers: Record<string, StorageServerEntry> = baseServers()
  const vaultEntries = await readVaultEntries(cookies, storageVaultSchema)
  const writePool: string[] = ['local', 'memory']
  const safeFetch = createSafeStorageFetch()

  for (const [id, { entry }] of vaultEntries) {
    if (!validateStorageTargetUrl(entry.url).ok) continue
    const driver = isWebdavDsn(entry.url)
      ? webdavDriver(entry.url, {
          readOnly: entry.readOnly,
          publicBaseUrl: '/api/files',
          fetchImpl: safeFetch,
        })
      : s3Driver(entry.url, {
          publicBaseUrl: '/api/files',
          fetchImpl: safeFetch,
        })
    servers[id] = {
      driver,
      statTtlMs: 30_000,
      limits: {
        storageBytes: entry.storageMb * MB,
        fileBytes: entry.fileMb * MB,
      },
      readOnly: entry.readOnly,
      allowSplit: entry.allowSplit !== false,
      ...(entry.encryptionKey ? { key: entry.encryptionKey } : {}),
    }
    if (!entry.readOnly) {
      writePool.push(id)
    }
  }

  return createStorage({
    defaultServer: 'local',
    writePool,
    writeStrategy: options?.writeStrategy ?? 'priority',
    cooldownMs: 15_000,
    ledger: sharedUploadLedger,
    spool: sharedUploadSpool,
    store: sharedUploadStore,
    state: demoStorageState.onEvent,
    tech: { resolveMeta: (req) => resolveRequestMeta(req, options?.event) },
    servers,
  })
}

export interface UploadedDemoRecord {
  readonly id: string
  readonly title: string
  readonly notes: string
  readonly path: string
  readonly server: string
  readonly filename: string
  readonly contentType: string
  readonly size: number
  readonly storedBytes?: number
  readonly encrypted?: boolean
  readonly partsCount?: number
  readonly firstPartBytes?: number
  readonly partServers?: readonly string[]
  readonly replicas?: readonly string[]
  readonly url: string
  readonly transport: 'ws' | 'http'
  readonly integrityVerified?: boolean
  readonly createdAt: string
}

export interface QuickNoteRecord {
  readonly id: string
  readonly message: string
  readonly createdAt: string
}

const MAX_DEMO_RECORDS = 50
let uploadedRecords: UploadedDemoRecord[] = []
let quickNotes: QuickNoteRecord[] = []

export function listUploadedRecords(): readonly UploadedDemoRecord[] {
  return uploadedRecords
}

export async function enrichDemoRecord(
  storage: Storage,
  record: UploadedDemoRecord,
): Promise<UploadedDemoRecord> {
  const stat = await storage.stat(record.path)
  let replicas: string[] = []
  if (stat?.replicas !== undefined) {
    replicas = stat.replicas
      .filter((r) => r.server !== (stat.parts[0]?.server ?? record.server))
      .map((r) => r.server)
  } else {
    for (const srv of storage.serverNames) {
      if (srv === record.server) continue
      if (stat?.parts.some((p) => p.server === srv)) continue
      const rep = await sharedUploadLedger.getFile(`@replica:${srv}:${record.path}`)
      if (rep) replicas.push(srv)
    }
  }
  if (!stat) {
    return {
      ...record,
      ...(replicas.length > 0 ? { replicas } : { replicas: [] }),
    }
  }
  const partServers = [...new Set(stat.parts.map((p) => p.server))]
  return {
    ...record,
    server: stat.parts[0]?.server ?? record.server,
    size: stat.size,
    storedBytes: stat.storedBytes,
    encrypted: stat.parts.some((p) => p.encrypted),
    partsCount: stat.parts.length,
    firstPartBytes: stat.parts[0]?.plainBytes,
    partServers,
    replicas,
  }
}

export async function listEnrichedUploadedRecords(
  storage: Storage,
): Promise<readonly UploadedDemoRecord[]> {
  return Promise.all(uploadedRecords.map((r) => enrichDemoRecord(storage, r)))
}

export function prependUploadedRecord(record: UploadedDemoRecord): void {
  uploadedRecords = [record, ...uploadedRecords].slice(0, MAX_DEMO_RECORDS)
}

export function replaceUploadedRecord(next: UploadedDemoRecord): void {
  uploadedRecords = uploadedRecords.map((item) => (item.id === next.id ? next : item))
}

export function updateUploadedRecordServer(
  id: string,
  server: string,
  url: string,
): UploadedDemoRecord | null {
  let updated: UploadedDemoRecord | null = null
  uploadedRecords = uploadedRecords.map((item) => {
    if (item.id !== id) return item
    updated = { ...item, server, url }
    return updated
  })
  return updated
}

export function removeUploadedRecord(id: string): UploadedDemoRecord | null {
  const found = uploadedRecords.find((item) => item.id === id) ?? null
  if (found) {
    uploadedRecords = uploadedRecords.filter((item) => item.id !== id)
  }
  return found
}

export function listQuickNotes(): readonly QuickNoteRecord[] {
  return quickNotes
}

export function prependQuickNote(note: QuickNoteRecord): void {
  quickNotes = [note, ...quickNotes].slice(0, MAX_DEMO_RECORDS)
}
