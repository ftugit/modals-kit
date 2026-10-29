// Серверные обработчики форм `/upload-demo`: работают и по `wss://`, и по нативному HTTP POST (без JS),
// направляют поток в выбранный сервер (`local`, `memory`, `auto`, `split_demo` или S3/WebDAV из куки-сейфа),
// выполняют самопроверку `storage.probe(server)`, создание реплик `storage.copy`, перенос `storage.move`
// и пакетное клонирование `storage.clone`.
import { randomUUID } from 'node:crypto'
import { demoParams } from '#components/demo/schema.js'
import { registerImageCheck } from '#components/form/image.js'
import { registerComponentForm } from '#hooks/component-form/registry.js'
import { CheckRegistry } from '#lib/form/index.js'
import { reject } from '#lib/form/server.js'
import {
  normalizeStoragePath,
  StorageOverwriteError,
  StorageQuotaError,
  StorageReadOnlyError,
  StreamFile,
} from '#lib/storage/index.js'
import {
  enrichDemoRecord,
  getDemoStorageTelemetry,
  listEnrichedUploadedRecords,
  listUploadedRecords,
  prependQuickNote,
  prependUploadedRecord,
  removeUploadedRecord,
  replaceUploadedRecord,
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
  cloneServerForm,
  copyUploadForm,
  createUploadBundleForm,
  deleteUploadForm,
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
    const cfg = readStaticDemoConfig(event.url)
    const desiredServer = readDesiredServer(event.url)
    const isSplitDemo = desiredServer === 'split_demo'
    const storage = await resolveRequestStorage(event.cookies, {
      writeStrategy:
        isSplitDemo && cfg.write_strategy === 'priority'
          ? 'round-robin'
          : cfg.write_strategy,
    })

    if (
      desiredServer !== 'auto' &&
      !isSplitDemo &&
      !storage.serverNames.includes(desiredServer)
    ) {
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
    const rawCustomPath = String(values.custom_path ?? '').trim()
    const notes = String(values.notes ?? '').trim()
    const allowOverwrite = values.allow_overwrite !== false
    const verifyIntegrity = Boolean(values.verify_integrity)
    const rawBundle = values.bundle
    const files: readonly File[] = Array.isArray(rawBundle)
      ? (rawBundle as readonly File[])
      : rawBundle instanceof File
        ? [rawBundle]
        : []

    let normalizedCustomBase: string | null = null
    if (rawCustomPath) {
      try {
        normalizedCustomBase = normalizeStoragePath(rawCustomPath)
      } catch (err) {
        return fail(
          [
            {
              id: 'custom_path:invalid',
              code: 'path.invalid',
              message: err instanceof Error ? err.message : 'Недопустимый относительный путь',
              path: ['custom_path'],
              origin: 'server',
            },
          ],
          'not-applied',
        )
      }
    }

    const createdItems: UploadedDemoRecord[] = []
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]!
        const id = randomUUID()
        const storagePath = normalizedCustomBase
          ? files.length > 1
            ? `${normalizedCustomBase}-${i + 1}`
            : normalizedCustomBase
          : `demo/${id}-${safeSlug(file.name)}`
        const transport: 'ws' | 'http' = file instanceof StreamFile ? 'ws' : 'http'
        const useStageToDisk = isSplitDemo || Boolean(cfg.stage_to_disk)
        const uploadRateOverride =
          cfg.up_rate && cfg.up_rate !== 'default' ? Number(cfg.up_rate) : undefined

        const stored = await storage.put({
          path: storagePath,
          body: file instanceof StreamFile ? file.stream() : file,
          contentType: file.type || 'application/octet-stream',
          size: file.size,
          lastModified: file.lastModified,
          overwrite: allowOverwrite,
          stageToDisk: useStageToDisk,
          ...(uploadRateOverride ? { rate: uploadRateOverride } : {}),
          ...(isSplitDemo
            ? {
                server: 'auto',
                split: true,
                splitServers: ['shard_a', 'shard_b'],
              }
            : {
                server: desiredServer,
              }),
        })

        const baseRecord: UploadedDemoRecord = {
          id,
          title: files.length > 1 ? `${title} (${file.name})` : title,
          notes,
          path: stored.path,
          server: stored.server,
          filename: file.name || 'upload.bin',
          contentType: stored.contentType,
          size: stored.size,
          storedBytes: stored.storedBytes,
          encrypted: stored.encrypted,
          partsCount: stored.partsCount,
          url: stored.url ?? `/api/files/${stored.path}`,
          transport,
          integrityVerified: transport === 'ws' && verifyIntegrity,
          createdAt: new Date().toISOString(),
        }
        const enriched = await enrichDemoRecord(storage, baseRecord)
        // Если перезаписали существующий пользовательский путь — обновляем карточку вместо дубля
        const existingSamePath = listUploadedRecords().find((r) => r.path === enriched.path)
        if (existingSamePath) {
          const merged = { ...enriched, id: existingSamePath.id }
          replaceUploadedRecord(merged)
          createdItems.push(merged)
        } else {
          prependUploadedRecord(enriched)
          createdItems.push(enriched)
        }
      }
    } catch (err) {
      if (
        err instanceof StorageQuotaError ||
        err instanceof StorageReadOnlyError ||
        err instanceof StorageOverwriteError
      ) {
        const targetField =
          err instanceof StorageOverwriteError && normalizedCustomBase
            ? ['custom_path']
            : ['bundle']
        return fail(
          [
            {
              id: `${targetField[0]}:${err.code}`,
              code: err.code,
              message: err.message,
              path: targetField,
              origin: 'server',
            },
          ],
          createdItems.length > 0 ? 'unknown' : 'not-applied',
        )
      }
      throw err
    }

    const storageReport = await storage.report()
    const telemetry = getDemoStorageTelemetry()
    commit()
    return {
      data: {
        item: createdItems[0],
        items: createdItems,
        storageReport,
        telemetry,
      },
    }
  },
  redirectOnSuccess: (event) => `/upload-demo${event.url.search}`,
})

registerComponentForm({
  description: cloneServerForm,
  async execute({ values, fail, commit }, event) {
    const storage = await resolveRequestStorage(event.cookies)
    const fromServer = String(values.from_server ?? '').trim()
    const toServer = String(values.to_server ?? '').trim()
    if (!storage.serverNames.includes(fromServer) || !storage.serverNames.includes(toServer)) {
      return fail([{ message: 'Исходный или целевой сервер не подключён' }], 'not-applied')
    }
    try {
      const cloneReport = await storage.clone({
        from: fromServer,
        to: toServer,
        overwrite: false,
      })
      const items = await listEnrichedUploadedRecords(storage)
      const storageReport = await storage.report()
      const telemetry = getDemoStorageTelemetry()
      commit()
      return { data: { cloneReport, items, storageReport, telemetry } }
    } catch (err) {
      if (err instanceof StorageQuotaError || err instanceof StorageReadOnlyError || err instanceof RangeError) {
        return fail([{ message: err.message }], 'not-applied')
      }
      throw err
    }
  },
  redirectOnSuccess: (event) => `/upload-demo${event.url.search}`,
})

registerComponentForm({
  description: copyUploadForm,
  async execute({ values, fail, commit }, event) {
    const storage = await resolveRequestStorage(event.cookies)
    const id = String(values.id ?? '')
    const toServer = String(values.to_server ?? '')
    const current = listUploadedRecords().find((x) => x.id === id)
    if (!current) {
      return fail([{ message: 'Файл не найден в списке демо' }], 'not-applied')
    }
    if (!storage.serverNames.includes(toServer)) {
      return fail([{ message: `Сервер «${toServer}» не подключён` }], 'not-applied')
    }
    try {
      await storage.copy({
        path: current.path,
        ...((current.partsCount ?? 1) > 1 ? {} : { from: current.server }),
        to: toServer,
      })
      const enriched = await enrichDemoRecord(storage, current)
      replaceUploadedRecord(enriched)
      const storageReport = await storage.report()
      const telemetry = getDemoStorageTelemetry()
      commit()
      return { data: { item: enriched, storageReport, telemetry } }
    } catch (err) {
      if (err instanceof StorageQuotaError || err instanceof StorageReadOnlyError || err instanceof RangeError) {
        return fail([{ message: err.message }], 'not-applied')
      }
      throw err
    }
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
      return fail(
        [{ message: `Сервер «${toServer}» не подключён` }],
        'not-applied',
      )
    }

    try {
      const moved = await storage.move({
        path: current.path,
        ...((current.partsCount ?? 1) > 1 ? {} : { from: current.server }),
        to: toServer,
      })
      const nextUrl = moved.url ?? `/api/files/${moved.path}?server=${encodeURIComponent(moved.server)}`
      const updated = updateUploadedRecordServer(id, moved.server, nextUrl)
      const enriched = updated ? await enrichDemoRecord(storage, updated) : null
      if (enriched) replaceUploadedRecord(enriched)
      const storageReport = await storage.report()
      const telemetry = getDemoStorageTelemetry()
      commit()
      return { data: { item: enriched ?? updated, storageReport, telemetry } }
    } catch (err) {
      if (err instanceof StorageQuotaError || err instanceof StorageReadOnlyError || err instanceof RangeError) {
        return fail([{ message: err.message }], 'not-applied')
      }
      throw err
    }
  },
  redirectOnSuccess: (event) => `/upload-demo${event.url.search}`,
})

registerComponentForm({
  description: deleteUploadForm,
  async execute({ values, commit }, event) {
    const storage = await resolveRequestStorage(event.cookies)
    const id = String(values.id ?? '')
    const removed = removeUploadedRecord(id)
    if (removed) {
      // Удаляем все физические части (и реплики) через auto-удаление в ledger
      await storage.del(removed.path).catch(() =>
        storage.del(removed.path, { server: removed.server }).catch(() => false),
      )
    }
    const storageReport = await storage.report()
    const telemetry = getDemoStorageTelemetry()
    commit()
    return { data: { removedId: id, storageReport, telemetry } }
  },
  redirectOnSuccess: (event) => `/upload-demo${event.url.search}`,
})

registerComponentForm({
  description: quickNoteForm,
  async execute({ values, commit }) {
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
