// Серверный сборщик хранилища файлов приложения.
//
// `0` ключей в `.env`, `0` локальных конфиг-файлов, `0` записей паролей в общей БД:
// базовые серверы (`local` + `memory`) доступны всегда, а пользовательские S3-серверы
// подключаются на лету из зашифрованного куки-сейфа текущего браузера (`storageVaultSchema`).
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Cookies } from '@sveltejs/kit'
import { storageVaultSchema } from '#content/storage-vault/schema.js'
import { readVaultEntries } from '#hooks/cookie-vault/vault.server.js'
import { createStorage, memoryDriver, type Storage, type StorageServerEntry } from '#lib/storage/index.js'
import { jsonLedger, localDriver, localSpool } from '#lib/storage/local.js'

const MB = 1024 * 1024

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

export const sharedUploadLedger = jsonLedger({ filePath: UPLOAD_LEDGER_FILE })
export const sharedUploadSpool = localSpool(UPLOAD_SPOOL_DIR)

function baseServers(): Record<string, StorageServerEntry> {
  return {
    local: {
      driver: sharedLocalDriver,
      limits: {
        storageBytes: 2 * 1024 * MB,
        fileBytes: 512 * MB,
      },
    },
    memory: {
      driver: sharedMemoryDriver,
      limits: {
        storageBytes: 128 * MB,
        fileBytes: 64 * MB,
      },
    },
  }
}

/** Базовый экземпляр без кук (встроенные `local` и `memory`). */
export const appStorage: Storage = createStorage({
  defaultServer: 'local',
  ledger: sharedUploadLedger,
  spool: sharedUploadSpool,
  servers: baseServers(),
})

/**
 * Собрать экземпляр `Storage` для конкретного HTTP/WS-запроса:
 * объединяет встроенные `local` и `memory` с S3-серверами из зашифрованного куки-сейфа браузера.
 */
export async function resolveRequestStorage(cookies: Cookies): Promise<Storage> {
  const servers: Record<string, StorageServerEntry> = baseServers()
  const vaultEntries = await readVaultEntries(cookies, storageVaultSchema)

  for (const [id, { entry }] of vaultEntries) {
    servers[id] = {
      url: entry.url,
      publicBaseUrl: '/api/files',
      limits: {
        storageBytes: entry.storageMb * MB,
        fileBytes: entry.fileMb * MB,
      },
      readOnly: entry.readOnly,
      allowSplit: entry.allowSplit !== false,
      ...(entry.encryptionKey ? { key: entry.encryptionKey } : {}),
    }
  }

  return createStorage({
    defaultServer: 'local',
    ledger: sharedUploadLedger,
    spool: sharedUploadSpool,
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

export function prependUploadedRecord(record: UploadedDemoRecord): void {
  uploadedRecords = [record, ...uploadedRecords].slice(0, MAX_DEMO_RECORDS)
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
