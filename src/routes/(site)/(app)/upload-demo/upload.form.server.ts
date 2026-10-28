// Серверные обработчики форм `/upload-demo`: работают и по `wss://`, и по нативному HTTP POST (без JS),
// направляют поток в выбранный сервер (`local`, `memory`, `auto` или S3 из куки-сейфа),
// выполняют живую проверку `storage.probe(server)` и потоковый перенос `storage.move`.
import { randomUUID } from 'node:crypto'
import { demoParams } from '#components/demo/schema.js'
import { registerImageCheck } from '#components/form/image.js'
import { registerComponentForm } from '#hooks/component-form/registry.js'
import { CheckRegistry } from '#lib/form/index.js'
import { reject } from '#lib/form/server.js'
import {
  StorageQuotaError,
  StorageReadOnlyError,
  StreamFile,
} from '#lib/storage/index.js'
import {
  listUploadedRecords,
  prependQuickNote,
  prependUploadedRecord,
  removeUploadedRecord,
  resolveRequestStorage,
  updateUploadedRecordServer,
  type QuickNoteRecord,
  type UploadedDemoRecord,
} from '#server/storage.server.js'
import {
  demoPanelSchema,
  type UploadDemoValues,
} from './demo-schema.js'
import {
  createUploadBundleForm,
  deleteUploadForm,
  probeServerForm,
  quickNoteForm,
  transferUploadForm,
} from './forms.js'

function safeSlug(filename: string): string {
  const cleaned = filename
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, '_')
    .slice(-100)
  return cleaned || 'upload.bin'
}

function readStaticDemoConfig(url: URL): UploadDemoValues {
  return demoParams(demoPanelSchema, url) as UploadDemoValues
}

function readDesiredServer(url: URL): string {
  const raw = url.searchParams.get('server')?.trim()
  return raw || 'local'
}

const imageChecks = new CheckRegistry()
registerImageCheck(imageChecks)

registerComponentForm({
  id: 'upload_bundle',
  description: (event) => createUploadBundleForm(readStaticDemoConfig(event.url)),
  checks: imageChecks,
  authorize(event) {
    const cfg = readStaticDemoConfig(event.url)
    if (cfg.acl === 'deny_403') {
      return reject(403, 'auth.forbidden')
    }
    if (cfg.acl === 'expired_422') {
      return [
        {
          id: 'auth.expired',
          code: 'auth.expired',
          message: 'Сессия устарела — проверка authorize отработала на Кадре 0 (0 байт прочитано)',
          origin: 'server',
        },
      ]
    }
    return undefined
  },
  integrity: (_event, form) => form.get('verify_integrity') === 'on',
  async execute({ values, fail, commit }, event) {
    const storage = await resolveRequestStorage(event.cookies)
    const desiredServer = readDesiredServer(event.url)
    if (desiredServer !== 'auto' && !storage.serverNames.includes(desiredServer)) {
      return fail(
        [
          {
            id: `bundle:server.${desiredServer}`,
            code: 'storage.unavailable',
            message: `Сервер «${desiredServer}» не найден в куки-сейфе текущего браузера`,
            path: ['bundle'],
            origin: 'server',
          },
        ],
        'not-applied',
      )
    }

    const title = String(values.title ?? '').trim()
    const notes = String(values.notes ?? '').trim()
    const verifyIntegrity = Boolean(values.verify_integrity)
    const rawBundle = values.bundle
    const files: readonly File[] = Array.isArray(rawBundle)
      ? (rawBundle as readonly File[])
      : rawBundle instanceof File
        ? [rawBundle]
        : []

    const createdItems: UploadedDemoRecord[] = []
    try {
      for (const file of files) {
        const id = randomUUID()
        const storagePath = `demo/${id}-${safeSlug(file.name)}`
        const transport: 'ws' | 'http' = file instanceof StreamFile ? 'ws' : 'http'

        const stored = await storage.put({
          path: storagePath,
          body: file.stream(),
          contentType: file.type || 'application/octet-stream',
          size: file.size,
          lastModified: file.lastModified,
          server: desiredServer,
        })

        const record: UploadedDemoRecord = {
          id,
          title: files.length > 1 ? `${title} (${file.name})` : title,
          notes,
          path: stored.path,
          server: stored.server,
          filename: file.name || 'upload.bin',
          contentType: stored.contentType,
          size: stored.size,
          url: stored.url ?? `/api/files/${stored.path}`,
          transport,
          integrityVerified: transport === 'ws' && verifyIntegrity,
          createdAt: new Date().toISOString(),
        }
        prependUploadedRecord(record)
        createdItems.push(record)
      }
    } catch (err) {
      if (err instanceof StorageQuotaError || err instanceof StorageReadOnlyError) {
        return fail(
          [
            {
              id: `bundle:${err.code}`,
              code: err.code,
              message: err.message,
              path: ['bundle'],
              origin: 'server',
            },
          ],
          createdItems.length > 0 ? 'unknown' : 'not-applied',
        )
      }
      throw err
    }

    const storageReport = await storage.report()
    commit()
    return {
      data: {
        item: createdItems[0],
        items: createdItems,
        storageReport,
      },
    }
  },
  redirectOnSuccess: (event) => `/upload-demo${event.url.search}`,
})

registerComponentForm({
  description: probeServerForm,
  async execute({ values, fail, commit }, event) {
    const storage = await resolveRequestStorage(event.cookies)
    const serverName = String(values.server_name ?? '').trim()
    if (!storage.serverNames.includes(serverName)) {
      return fail(
        [{ message: `Сервер «${serverName}» не подключён` }],
        'not-applied',
      )
    }
    const probe = await storage.probe(serverName)
    const storageReport = await storage.report()
    commit()
    return { data: { probe, storageReport } }
  },
  redirectOnSuccess: (event) => `/upload-demo${event.url.search}`,
})

registerComponentForm({
  description: transferUploadForm,
  async execute({ values, fail, commit }, event) {
    const storage = await resolveRequestStorage(event.cookies)
    const id = String(values.id ?? '')
    const toServer = String(values.to_server ?? '')
    const current = listUploadedRecords().find((x) => x.id === id)
    if (!current) {
      return fail([{ message: 'Файл не найден в списке демо' }], 'not-applied')
    }
    if (!storage.serverNames.includes(toServer)) {
      return fail([{ message: `Целевой сервер «${toServer}» не подключён` }], 'not-applied')
    }

    try {
      const moved = await storage.move({
        path: current.path,
        from: current.server,
        to: toServer,
      })

      const nextUrl = moved.url ?? `/api/files/${moved.path}`
      const updated = updateUploadedRecordServer(id, moved.server, nextUrl)
      const storageReport = await storage.report()
      commit()
      return { data: { item: updated, storageReport } }
    } catch (err) {
      if (err instanceof StorageQuotaError || err instanceof StorageReadOnlyError) {
        return fail([{ code: err.code, message: err.message }], 'not-applied')
      }
      throw err
    }
  },
  redirectOnSuccess: (event) => `/upload-demo${event.url.search}`,
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
  redirectOnSuccess: (event) => `/upload-demo${event.url.search}`,
})

registerComponentForm({
  description: deleteUploadForm,
  async execute({ values, commit }, event) {
    const storage = await resolveRequestStorage(event.cookies)
    const id = String(values.id ?? '')
    const removed = removeUploadedRecord(id)
    if (removed && storage.serverNames.includes(removed.server)) {
      await storage.del(removed.path, { server: removed.server }).catch(() => undefined)
    }
    const storageReport = await storage.report()
    commit()
    return { data: { removedId: id, storageReport } }
  },
  redirectOnSuccess: (event) => `/upload-demo${event.url.search}`,
})
