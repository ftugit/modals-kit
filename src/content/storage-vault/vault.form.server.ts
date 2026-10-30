import {
  registerCookieVaultForms,
  type CookieVaultValidationResult,
} from '#hooks/cookie-vault/vault.server.js'
import { localPath } from '#lib/address/index.js'
import { createStorage, memoryLedger } from '#lib/storage/index.js'
import { s3Driver } from '#lib/storage/s3.js'
import { isWebdavDsn, webdavDriver } from '#lib/storage/webdav.js'
import { createIpThrottle } from '#server/client-ip.server.js'
import {
  createSafeStorageFetch,
  isCloudStorageEnv,
  validateStorageTargetUrl,
  type DnsResolverFn,
  type StorageUrlSafetyOptions,
} from '#server/safe-storage-fetch.server.js'
import { storageVaultSchema, type StorageVaultEntry } from './schema.js'

export { validateStorageTargetUrl, type StorageUrlSafetyOptions }

const MB = 1024 * 1024
const VAULT_PROBE_TIMEOUT_MS = 10_000

function safeVaultRedirect(url: URL): string {
  const from = localPath(url.searchParams.get('from'))
  if (from) {
    return `/upload-demo/vault?from=${encodeURIComponent(from)}`
  }
  return '/upload-demo/vault'
}

export interface ProbeStorageOptions {
  readonly allowLocalNetwork?: boolean
  readonly dnsResolver?: DnsResolverFn
}

/**
 * Проверить живое подключение и права S3 / WebDAV ПЕРЕД записью конфига:
 * - отсекает SSRF на внутренние / cloud-metadata адреса (включая закрепление DNS `lookup`);
 * - для обычного слота (`readOnly: false`) прогоняет потоковый цикл `put` -> чтение -> `del`
 *   (включая проверку `AES-256-GCM`, если задан `encryptionKey`);
 * - для `readOnly: true` проверяет запрет записи + `head` + чтение корня `listFiles('')`.
 */
export async function probeStorageVaultEntry(
  id: string,
  entry: StorageVaultEntry,
  fetchOverride?: typeof fetch,
  options?: ProbeStorageOptions,
): Promise<CookieVaultValidationResult> {
  const allowLocalNetwork = options?.allowLocalNetwork ?? !isCloudStorageEnv()
  const safety = validateStorageTargetUrl(entry.url, { allowLocalNetwork })
  if (!safety.ok) {
    return {
      ok: false,
      path: ['url'],
      message: 'Адрес сервера хранилища запрещён политикой безопасности',
    }
  }

  const timedFetch = createSafeStorageFetch({
    allowLocalNetwork,
    timeoutMs: VAULT_PROBE_TIMEOUT_MS,
    ...(fetchOverride ? { baseFetch: fetchOverride } : {}),
    ...(options?.dnsResolver ? { dnsResolver: options.dnsResolver } : {}),
  })

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
      const errText = probe.error ?? 'хранилище недоступно'
      const isCryptoErr = /\[storage\/crypto\]|ключ шифрования/i.test(errText)
      return {
        ok: false,
        path: [isCryptoErr ? 'encryption_key' : 'url'],
        message: `Проверка сервера «${id}» не пройдена: ${errText}`,
      }
    }

    if (entry.readOnly && 'listFolders' in driver && typeof driver.listFolders === 'function') {
      await driver.listFolders('')
    }

    return { ok: true }
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err)
    const isCryptoErr = /\[storage\/crypto\]|ключ шифрования/i.test(rawMsg)
    const detail = rawMsg.replace(/^\[storage(?:\/(?:s3|webdav|crypto))?\]\s*/, '')
    return {
      ok: false,
      path: [isCryptoErr ? 'encryption_key' : 'url'],
      message: `Не удалось подключиться к серверу «${id}»: ${detail}`,
    }
  }
}

const storageVaultThrottle = createIpThrottle('storage-vault', 15, 60_000)

registerCookieVaultForms(storageVaultSchema, {
  redirectOnSuccess: (event) => safeVaultRedirect(event.url),
  throttle: storageVaultThrottle,
  validateEntry: (id, entry) => probeStorageVaultEntry(id, entry),
})
