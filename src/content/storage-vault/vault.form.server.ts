import {
  registerCookieVaultForms,
  type CookieVaultValidationResult,
} from '#hooks/cookie-vault/vault.server.js'
import { createStorage, memoryLedger } from '#lib/storage/index.js'
import { s3Driver } from '#lib/storage/s3.js'
import { isWebdavDsn, webdavDriver } from '#lib/storage/webdav.js'
import { storageVaultSchema, type StorageVaultEntry } from './schema.js'

const MB = 1024 * 1024
const VAULT_PROBE_TIMEOUT_MS = 10_000

function safeVaultRedirect(url: URL): string {
  const from = url.searchParams.get('from') ?? ''
  if (from.startsWith('/') && !from.startsWith('//')) {
    return `/upload-demo/vault?from=${encodeURIComponent(from)}`
  }
  return '/upload-demo/vault'
}

function createBoundedFetch(
  baseFetch: typeof fetch,
  timeoutMs = VAULT_PROBE_TIMEOUT_MS,
): typeof fetch {
  return (input, init) => {
    const deadlineSignal = AbortSignal.timeout(timeoutMs)
    const signal = init?.signal
      ? AbortSignal.any([init.signal, deadlineSignal])
      : deadlineSignal
    return baseFetch(input, { ...init, signal })
  }
}

/**
 * Проверить живое подключение и права S3 / WebDAV ПЕРЕД записью зашифрованной куки в сейф:
 * - для обычного слота (`readOnly: false`) прогоняет потоковый цикл `put` -> чтение -> `del`
 *   (включая проверку `AES-256-GCM`, если задан `encryptionKey`);
 * - для `readOnly: true` проверяет запрет записи + `head` + чтение корня `listFiles('')`,
 *   отсекая неверные ключи, несуществующий бакет/папку и HTML-страницы входа вместо WebDAV.
 */
export async function probeStorageVaultEntry(
  id: string,
  entry: StorageVaultEntry,
  fetchOverride?: typeof fetch,
): Promise<CookieVaultValidationResult> {
  const timedFetch = createBoundedFetch(fetchOverride ?? globalThis.fetch)

  try {
    const driver = isWebdavDsn(entry.url)
      ? webdavDriver(entry.url, {
          readOnly: entry.readOnly,
          fetchImpl: timedFetch,
        })
      : s3Driver(entry.url, {
          fetchImpl: timedFetch,
        })

    const storage = createStorage({
      defaultServer: id,
      ledger: memoryLedger(),
      servers: {
        [id]: {
          driver,
          limits: {
            storageBytes: Math.max(entry.storageMb * MB, 1 * MB),
            fileBytes: Math.max(entry.fileMb * MB, 1 * MB),
          },
          readOnly: entry.readOnly,
          allowSplit: entry.allowSplit !== false,
          ...(entry.encryptionKey ? { key: entry.encryptionKey } : {}),
        },
      },
    })

    const probe = await storage.probe(id)
    if (!probe.ok) {
      return {
        ok: false,
        path: ['url'],
        message: `Проверка сервера «${id}» не пройдена: ${probe.error ?? 'хранилище недоступно'}`,
      }
    }

    if (entry.readOnly && 'listFolders' in driver && typeof driver.listFolders === 'function') {
      await driver.listFolders('')
    }

    return { ok: true }
  } catch (err) {
    const detail =
      err instanceof Error
        ? err.message.replace(/^\[storage(?:\/(?:s3|webdav))?\]\s*/, '')
        : String(err)
    return {
      ok: false,
      path: ['url'],
      message: `Не удалось подключиться к серверу «${id}»: ${detail}`,
    }
  }
}

registerCookieVaultForms(storageVaultSchema, {
  redirectOnSuccess: (event) => safeVaultRedirect(event.url),
  validateEntry: (id, entry) => probeStorageVaultEntry(id, entry),
})
