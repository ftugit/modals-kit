// Серверные обработчики форм `/upload-demo`: работают и по `wss://`, и по нативному HTTP POST (без JS).
import { randomUUID } from 'node:crypto'
import { registerComponentForm } from '#hooks/component-form/registry.js'
import { StreamFile } from '#lib/storage/index.js'
import {
  appStorage,
  prependQuickNote,
  prependUploadedRecord,
  removeUploadedRecord,
  type QuickNoteRecord,
  type UploadedDemoRecord,
} from '#server/storage.server.js'
import { deleteUploadForm, quickNoteForm, uploadBundleForm } from './forms.js'

function safeSlug(filename: string): string {
  const cleaned = filename
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, '_')
    .slice(-100)
  return cleaned || 'upload.bin'
}

registerComponentForm({
  description: uploadBundleForm,
  integrity: (_event, form) => form.get('verify_integrity') === 'on',
  async execute({ values, commit }) {
    const title = String(values.title ?? '').trim()
    const notes = String(values.notes ?? '').trim()
    const verifyIntegrity = Boolean(values.verify_integrity)
    const file = values.bundle as File

    const id = randomUUID()
    const storagePath = `demo/${id}-${safeSlug(file.name)}`
    const transport: 'ws' | 'http' = file instanceof StreamFile ? 'ws' : 'http'

    const stored = await appStorage.put({
      path: storagePath,
      body: file.stream(),
      contentType: file.type || 'application/octet-stream',
      size: file.size,
      lastModified: file.lastModified,
    })

    const record: UploadedDemoRecord = {
      id,
      title,
      notes,
      path: stored.path,
      filename: file.name || 'upload.bin',
      contentType: stored.contentType,
      size: stored.size,
      url: stored.url ?? `/api/files/${stored.path}`,
      transport,
      integrityVerified: transport === 'ws' && verifyIntegrity,
      createdAt: new Date().toISOString(),
    }

    prependUploadedRecord(record)
    commit()
    return { data: { item: record } }
  },
  redirectOnSuccess: () => '/upload-demo',
})

registerComponentForm({
  description: quickNoteForm,
  execute({ values, commit }) {
    const note: QuickNoteRecord = {
      id: randomUUID(),
      message: String(values.message ?? '').trim(),
      createdAt: new Date().toISOString(),
    }
    prependQuickNote(note)
    commit()
    return { data: { note } }
  },
  redirectOnSuccess: () => '/upload-demo',
})

registerComponentForm({
  description: deleteUploadForm,
  async execute({ values, commit }) {
    const id = String(values.id ?? '')
    const removed = removeUploadedRecord(id)
    if (removed) {
      await appStorage.del(removed.path)
    }
    commit()
    return { data: { removedId: id } }
  },
  redirectOnSuccess: () => '/upload-demo',
})
