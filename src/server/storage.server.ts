// Серверный экземпляр хранилища файлов приложения для прототипа потоковой загрузки.
//
// Хранит бинарные файлы во временной директории ОС (`/tmp/modals-kit-uploads`)
// через `localDriver` (`*.part` → атомарный `rename`), не засоряя рабочее дерево Git.
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStorage } from '#lib/storage/index.js'
import { localDriver } from '#lib/storage/local.js'
import { localStore } from './cache.server.js'

export const UPLOAD_ROOT_DIR = join(tmpdir(), 'modals-kit-uploads')

export const appStorage = createStorage({
  servers: {
    local: localDriver({
      rootDir: UPLOAD_ROOT_DIR,
      publicBaseUrl: '/api/files',
    }),
  },
})

export interface UploadedDemoRecord {
  readonly id: string
  readonly title: string
  readonly notes: string
  readonly path: string
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

const demoStore = localStore.scope('upload-demo', { max: 4 })

export function listUploadedRecords(): readonly UploadedDemoRecord[] {
  return demoStore.get<readonly UploadedDemoRecord[]>('files') ?? []
}

export function prependUploadedRecord(item: UploadedDemoRecord): readonly UploadedDemoRecord[] {
  const next = [item, ...listUploadedRecords()].slice(0, 30)
  demoStore.set('files', next, Infinity)
  return next
}

export function removeUploadedRecord(id: string): UploadedDemoRecord | null {
  const current = listUploadedRecords()
  const target = current.find((x) => x.id === id) ?? null
  if (!target) return null
  demoStore.set(
    'files',
    current.filter((x) => x.id !== id),
    Infinity,
  )
  return target
}

export function listQuickNotes(): readonly QuickNoteRecord[] {
  return demoStore.get<readonly QuickNoteRecord[]>('notes') ?? []
}

export function prependQuickNote(note: QuickNoteRecord): readonly QuickNoteRecord[] {
  const next = [note, ...listQuickNotes()].slice(0, 20)
  demoStore.set('notes', next, Infinity)
  return next
}
