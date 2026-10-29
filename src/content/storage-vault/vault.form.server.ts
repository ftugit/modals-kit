import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import {
  registerCookieVaultForms,
  type CookieVaultValidationResult,
} from '#hooks/cookie-vault/vault.server.js'
import { createStorage, memoryLedger } from '#lib/storage/index.js'
import { parseS3Url, s3Driver } from '#lib/storage/s3.js'
import { isWebdavDsn, parseWebdavUrl, webdavDriver } from '#lib/storage/webdav.js'
import { storageVaultSchema, type StorageVaultEntry } from './schema.js'

const MB = 1024 * 1024
const VAULT_PROBE_TIMEOUT_MS = 10_000

const METADATA_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
])

function isCloudEnv(): boolean {
  return process.env.VERCEL === '1' || Boolean(process.env.CF_PAGES)
}

function parseIpv4Octets(ip: string): [number, number, number, number] | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN))
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null
  return [nums[0]!, nums[1]!, nums[2]!, nums[3]!]
}

function isBlockedIpv4(ip: string, allowLocalNetwork: boolean): boolean {
  const oct = parseIpv4Octets(ip)
  if (!oct) return true
  const [a, b] = oct
  // Unspecified (0.0.0.0/8), link-local / AWS-GCP-Azure IMDS (169.254.0.0/16),
  // Alibaba Cloud metadata (100.100.100.200), multicast/reserved (>= 224.0.0.0)
  // запрещены всегда, включая локальную разработку.
  if (a === 0) return true
  if (a === 169 && b === 254) return true
  if (ip === '100.100.100.200') return true
  if (a >= 224) return true

  if (!allowLocalNetwork) {
    if (a === 127) return true
    if (a === 10) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true
  }
  return false
}

function extractMappedIpv4FromIpv6(ipLower: string): string | null {
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ipLower)
  if (dotted?.[1]) return dotted[1]
  const hexPair = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ipLower)
  if (hexPair?.[1] && hexPair[2]) {
    const hi = parseInt(hexPair[1], 16)
    const lo = parseInt(hexPair[2], 16)
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`
  }
  return null
}

function isBlockedIpv6(rawIp: string, allowLocalNetwork: boolean): boolean {
  const ip = rawIp.replace(/^\[|\]$/g, '').split('%')[0]!.toLowerCase()
  if (ip === '::') return true
  // AWS IPv6 IMDS (fd00:ec2::254) и link-local fe80::/10 запрещены всегда.
  if (ip === 'fd00:ec2::254' || ip === 'fd00:0ec2::254') return true
  if (/^fe[89ab][0-9a-f]*:/.test(ip)) return true

  const mappedV4 = extractMappedIpv4FromIpv6(ip)
  if (mappedV4) return isBlockedIpv4(mappedV4, allowLocalNetwork)

  if (!allowLocalNetwork) {
    if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') return true
    // Unique local fc00::/7
    if (/^f[cd][0-9a-f]{0,2}:/.test(ip)) return true
  }
  return false
}

function isBlockedIpAddress(ip: string, allowLocalNetwork: boolean): boolean {
  const clean = ip.replace(/^\[|\]$/g, '').split('%')[0]!
  const ver = isIP(clean)
  if (ver === 4) return isBlockedIpv4(clean, allowLocalNetwork)
  if (ver === 6) return isBlockedIpv6(clean, allowLocalNetwork)
  return false
}

export interface StorageUrlSafetyOptions {
  /** Разрешить ли loopback / RFC1918 и нешифрованный `+http://` (только вне облака). */
  readonly allowLocalNetwork?: boolean
}

/**
 * Проверить безопасность целевого адреса хранилища S3 / WebDAV против SSRF:
 * - всегда блокирует cloud metadata (`169.254.169.254`, `100.100.100.200`, `fd00:ec2::254`,
 *   `metadata.google.internal`, `169.254.0.0/16`, `fe80::/10`, `0.0.0.0`, `::`);
 * - при `allowLocalNetwork: false` (облачный деплой) требует `https:` и блокирует
 *   `localhost`, `.local`, `.internal`, loopback и приватные подсети IPv4/IPv6.
 */
export function validateStorageTargetUrl(
  rawDsn: string,
  options?: StorageUrlSafetyOptions,
): { readonly ok: true; readonly endpointUrl: URL } | { readonly ok: false; readonly reason: string } {
  const allowLocalNetwork = options?.allowLocalNetwork ?? !isCloudEnv()

  let endpoint: string
  try {
    endpoint = isWebdavDsn(rawDsn)
      ? parseWebdavUrl(rawDsn).endpoint
      : parseS3Url(rawDsn).endpoint
  } catch {
    return { ok: false, reason: 'invalid-dsn' }
  }

  let parsed: URL
  try {
    parsed = new URL(endpoint)
  } catch {
    return { ok: false, reason: 'invalid-endpoint' }
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, reason: 'unsupported-scheme' }
  }
  if (!allowLocalNetwork && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'https-required' }
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!host) return { ok: false, reason: 'missing-host' }
  if (METADATA_HOSTNAMES.has(host) || host.endsWith('.metadata.google.internal')) {
    return { ok: false, reason: 'metadata-host' }
  }

  const ipVer = isIP(host)
  if (ipVer === 4 && isBlockedIpv4(host, allowLocalNetwork)) {
    return { ok: false, reason: 'blocked-ip' }
  }
  if (ipVer === 6 && isBlockedIpv6(host, allowLocalNetwork)) {
    return { ok: false, reason: 'blocked-ip' }
  }

  if (!allowLocalNetwork && ipVer === 0) {
    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    ) {
      return { ok: false, reason: 'blocked-hostname' }
    }
  }

  return { ok: true, endpointUrl: parsed }
}

function safeVaultRedirect(url: URL): string {
  const from = url.searchParams.get('from') ?? ''
  if (from.startsWith('/') && !from.startsWith('//')) {
    return `/upload-demo/vault?from=${encodeURIComponent(from)}`
  }
  return '/upload-demo/vault'
}

function createBoundedSafeFetch(
  baseFetch: typeof fetch,
  options: {
    timeoutMs?: number
    allowLocalNetwork: boolean
    verifyDns: boolean
  },
): typeof fetch {
  const timeoutMs = options.timeoutMs ?? VAULT_PROBE_TIMEOUT_MS
  return async (input, init) => {
    const targetUrl = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    )
    const host = targetUrl.hostname.replace(/^\[|\]$/g, '').toLowerCase()

    if (METADATA_HOSTNAMES.has(host) || isBlockedIpAddress(host, options.allowLocalNetwork)) {
      throw new Error('Целевой адрес заблокирован политикой безопасности (SSRF)')
    }
    if (!options.allowLocalNetwork && targetUrl.protocol !== 'https:') {
      throw new Error('В облачном окружении разрешены только HTTPS-подключения к хранилищу')
    }

    if (options.verifyDns && isIP(host) === 0) {
      const records = await lookup(host, { all: true, verbatim: true })
      if (records.length === 0) {
        throw new Error(`DNS-имя «${host}» не разрешается`)
      }
      for (const rec of records) {
        if (isBlockedIpAddress(rec.address, options.allowLocalNetwork)) {
          throw new Error('DNS-имя хранилища указывает на запрещённый внутренний адрес')
        }
      }
    }

    const deadlineSignal = AbortSignal.timeout(timeoutMs)
    const signal = init?.signal
      ? AbortSignal.any([init.signal, deadlineSignal])
      : deadlineSignal
    return baseFetch(input, { ...init, signal })
  }
}

export interface ProbeStorageOptions {
  readonly allowLocalNetwork?: boolean
}

/**
 * Проверить живое подключение и права S3 / WebDAV ПЕРЕД записью конфига:
 * - отсекает SSRF на внутренние / cloud-metadata адреса (включая проверку DNS);
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
  const allowLocalNetwork = options?.allowLocalNetwork ?? !isCloudEnv()
  const safety = validateStorageTargetUrl(entry.url, { allowLocalNetwork })
  if (!safety.ok) {
    return {
      ok: false,
      path: ['url'],
      message: 'Адрес сервера хранилища запрещён политикой безопасности',
    }
  }

  const timedFetch = createBoundedSafeFetch(fetchOverride ?? globalThis.fetch, {
    allowLocalNetwork,
    verifyDns: fetchOverride === undefined,
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

registerCookieVaultForms(storageVaultSchema, {
  redirectOnSuccess: (event) => safeVaultRedirect(event.url),
  validateEntry: (id, entry) => probeStorageVaultEntry(id, entry),
})
