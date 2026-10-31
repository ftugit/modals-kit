import type { CookieVaultValidationResult } from '#hooks/cookie-vault/vault.server.js'
import { createStorage, memoryLedger } from '#lib/storage/index.js'
import { s3Driver } from '#lib/storage/s3.js'
import { isWebdavDsn, webdavDriver } from '#lib/storage/webdav.js'
import {
  createSafeStorageFetch,
  isCloudStorageEnv,
  validateStorageTargetUrl,
  type DnsResolverFn,
  type StorageUrlSafetyOptions,
} from './safe-storage-fetch.server.js'

export { validateStorageTargetUrl, type StorageUrlSafetyOptions }

const MB = 1024 * 1024
const STORAGE_PROBE_TIMEOUT_MS = 10_000

export interface StorageProbeEntry {
  readonly url: string
  readonly storageMb: number
  readonly fileMb: number
  readonly readOnly: boolean
  readonly allowSplit?: boolean
  readonly encryptionKey?: string
}

export interface ProbeStorageOptions {
  readonly allowLocalNetwork?: boolean
  readonly dnsResolver?: DnsResolverFn
}

/**
 * Проверить живое подключение и права S3 / WebDAV перед сохранением конфига сервера:
 * - отсекает SSRF на внутренние / cloud-metadata адреса (включая закрепление DNS `lookup`);
 * - для обычного слота (`readOnly: false`) прогоняет потоковый цикл `put` -> чтение -> `del`
 *   (включая проверку `AES-256-GCM`, если задан `encryptionKey`);
 * - для `readOnly: true` проверяет запрет записи + `head` + чтение корня `listFolders('')`.
 */
export async function probeStorageVaultEntry(
  id: string,
  entry: StorageProbeEntry,
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
    timeoutMs: STORAGE_PROBE_TIMEOUT_MS,
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
