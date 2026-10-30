// Защита от SSRF и DNS-rebinding для исходящих подключений к внешним S3 / WebDAV серверам.
//
// Инварианты:
// - все разрешённые DNS-записи проверяются против приватных, link-local, CGNAT, multicast
//   и cloud-metadata диапазонов (`169.254.169.254`, `100.100.100.200`, `fd00:ec2::254`, IPv4-mapped IPv6);
// - в Node-рантайме сокет открывается через `node:http` / `node:https` с callback `lookup`,
//   передающим уже проверенный IP напрямую в TCP/TLS-соединение (`0` повторных DNS-запросов,
//   полная защита от TOCTOU DNS rebinding при сохранении TLS SNI `servername` и проверки сертификата);
// - HTTP-редиректы (`301/302/303/307/308`) перехватываются вручную (до 3 переходов) с полной
//   повторной проверкой целевого `Location` и сбросом `Authorization`/`Cookie` при смене origin;
// - тела запросов и ответов передаются потоково (`ReadableStream` <-> Node stream) без буферизации в ОЗУ.
import { lookup as dnsLookup } from 'node:dns/promises'
import { request as httpRequest, type IncomingMessage, type RequestOptions } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web'
import { parseS3Url } from '#lib/storage/s3.js'
import { isWebdavDsn, parseWebdavUrl } from '#lib/storage/webdav.js'

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_REDIRECT_HOPS = 3
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304])

export const METADATA_HOSTNAMES: ReadonlySet<string> = new Set([
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
])

export function isCloudStorageEnv(): boolean {
  return process.env.VERCEL === '1' || Boolean(process.env.CF_PAGES)
}

function parseIpv4Octets(ip: string): [number, number, number, number] | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN))
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null
  return [nums[0]!, nums[1]!, nums[2]!, nums[3]!]
}

export function isBlockedIpv4(ip: string, allowLocalNetwork: boolean): boolean {
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
    // Carrier-Grade NAT / Tailscale / внутренние облачные сети 100.64.0.0/10
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

export function isBlockedIpv6(rawIp: string, allowLocalNetwork: boolean): boolean {
  const ip = rawIp.replace(/^\[|\]$/g, '').split('%')[0]!.toLowerCase()
  if (ip === '::' || ip === '0:0:0:0:0:0:0:0') return true
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

export function isBlockedIpAddress(ip: string, allowLocalNetwork: boolean): boolean {
  const clean = ip.replace(/^\[|\]$/g, '').split('%')[0]!
  const ver = isIP(clean)
  if (ver === 4) return isBlockedIpv4(clean, allowLocalNetwork)
  if (ver === 6) return isBlockedIpv6(clean, allowLocalNetwork)
  return true
}

export function isBlockedHostname(hostLower: string, allowLocalNetwork: boolean): boolean {
  if (!hostLower) return true
  if (METADATA_HOSTNAMES.has(hostLower) || hostLower.endsWith('.metadata.google.internal')) {
    return true
  }
  if (!allowLocalNetwork && isIP(hostLower) === 0) {
    if (
      hostLower === 'localhost' ||
      hostLower.endsWith('.localhost') ||
      hostLower.endsWith('.local') ||
      hostLower.endsWith('.internal')
    ) {
      return true
    }
  }
  return false
}

export interface StorageUrlSafetyOptions {
  /** Разрешить ли loopback / RFC1918 и нешифрованный `+http://` (только вне облака). */
  readonly allowLocalNetwork?: boolean
}

export function validateHttpEndpointUrl(
  parsed: URL,
  allowLocalNetwork: boolean,
): { readonly ok: true; readonly endpointUrl: URL } | { readonly ok: false; readonly reason: string } {
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, reason: 'unsupported-scheme' }
  }
  if (!allowLocalNetwork && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'https-required' }
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!host) return { ok: false, reason: 'missing-host' }
  if (isBlockedHostname(host, allowLocalNetwork)) {
    return { ok: false, reason: host.includes('metadata') || host === 'instance-data' ? 'metadata-host' : 'blocked-hostname' }
  }

  const ipVer = isIP(host)
  if (ipVer === 4 && isBlockedIpv4(host, allowLocalNetwork)) {
    return { ok: false, reason: 'blocked-ip' }
  }
  if (ipVer === 6 && isBlockedIpv6(host, allowLocalNetwork)) {
    return { ok: false, reason: 'blocked-ip' }
  }

  return { ok: true, endpointUrl: parsed }
}

/**
 * Проверить безопасность целевого адреса хранилища S3 / WebDAV против SSRF.
 */
export function validateStorageTargetUrl(
  rawDsn: string,
  options?: StorageUrlSafetyOptions,
): { readonly ok: true; readonly endpointUrl: URL } | { readonly ok: false; readonly reason: string } {
  const allowLocalNetwork = options?.allowLocalNetwork ?? !isCloudStorageEnv()

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

  return validateHttpEndpointUrl(parsed, allowLocalNetwork)
}

export interface DnsResolvedRecord {
  readonly address: string
  readonly family: 4 | 6
}

export type DnsResolverFn = (hostname: string) => Promise<readonly DnsResolvedRecord[]>

async function defaultDnsResolver(hostname: string): Promise<readonly DnsResolvedRecord[]> {
  const rows = await dnsLookup(hostname, { all: true, verbatim: true })
  return rows.map((r) => ({
    address: r.address,
    family: r.family === 6 ? 6 : 4,
  }))
}

async function resolveAndValidateHost(
  host: string,
  allowLocalNetwork: boolean,
  resolver: DnsResolverFn,
): Promise<readonly DnsResolvedRecord[]> {
  const clean = host.replace(/^\[|\]$/g, '').toLowerCase()
  if (isBlockedHostname(clean, allowLocalNetwork)) {
    throw new Error('Целевой адрес заблокирован политикой безопасности (SSRF)')
  }
  const literalVer = isIP(clean)
  if (literalVer === 4 || literalVer === 6) {
    if (isBlockedIpAddress(clean, allowLocalNetwork)) {
      throw new Error('Целевой IP-адрес заблокирован политикой безопасности (SSRF)')
    }
    return [{ address: clean, family: literalVer }]
  }

  const records = await resolver(clean)
  if (records.length === 0) {
    throw new Error(`DNS-имя «${clean}» не разрешается`)
  }
  for (const rec of records) {
    if (isBlockedIpAddress(rec.address, allowLocalNetwork)) {
      throw new Error('DNS-имя хранилища указывает на запрещённый внутренний адрес (SSRF)')
    }
  }
  return records
}

function toResponseHeaders(raw: IncomingMessage['headers']): Headers {
  const headers = new Headers()
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined) continue
    if (Array.isArray(v)) {
      for (const item of v) headers.append(k, item)
    } else {
      headers.set(k, v)
    }
  }
  return headers
}

async function pumpBodyToRequest(
  body: BodyInit | null | undefined,
  req: ReturnType<typeof httpRequest>,
  signal: AbortSignal,
): Promise<void> {
  if (body == null) {
    req.end()
    return
  }
  if (typeof body === 'string') {
    req.end(Buffer.from(body, 'utf8'))
    return
  }
  if (body instanceof URLSearchParams) {
    req.end(Buffer.from(body.toString(), 'utf8'))
    return
  }
  if (body instanceof ArrayBuffer) {
    req.end(Buffer.from(body))
    return
  }
  if (ArrayBuffer.isView(body)) {
    req.end(Buffer.from(body.buffer, body.byteOffset, body.byteLength))
    return
  }
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    const stream = body.stream() as unknown as NodeWebReadableStream<Uint8Array>
    await pumpWebStream(stream, req, signal)
    return
  }
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
    await pumpWebStream(body as unknown as NodeWebReadableStream<Uint8Array>, req, signal)
    return
  }
  req.end()
}

async function pumpWebStream(
  stream: NodeWebReadableStream<Uint8Array>,
  req: ReturnType<typeof httpRequest>,
  signal: AbortSignal,
): Promise<void> {
  const reader = stream.getReader()
  try {
    while (true) {
      if (signal.aborted) {
        await reader.cancel(signal.reason).catch(() => {})
        throw signal.reason ?? new DOMException('Aborted', 'AbortError')
      }
      const { done, value } = await reader.read()
      if (done) break
      if (value && value.byteLength > 0) {
        const ok = req.write(Buffer.from(value.buffer, value.byteOffset, value.byteLength))
        if (!ok) {
          await new Promise<void>((resolve, reject) => {
            const onDrain = () => {
              cleanup()
              resolve()
            }
            const onError = (err: Error) => {
              cleanup()
              reject(err)
            }
            const cleanup = () => {
              req.off('drain', onDrain)
              req.off('error', onError)
            }
            req.once('drain', onDrain)
            req.once('error', onError)
          })
        }
      }
    }
    req.end()
  } catch (err) {
    await reader.cancel(err).catch(() => {})
    throw err
  }
}

async function executePinnedNodeHop(
  targetUrl: URL,
  method: string,
  headers: Headers,
  body: BodyInit | null | undefined,
  pinnedRecords: readonly DnsResolvedRecord[],
  signal: AbortSignal,
): Promise<Response> {
  const isHttps = targetUrl.protocol === 'https:'
  const cleanHost = targetUrl.hostname.replace(/^\[|\]$/g, '')
  const outHeaders: Record<string, string> = {}
  headers.forEach((value, key) => {
    outHeaders[key] = value
  })
  if (!headers.has('host')) {
    outHeaders['host'] = targetUrl.host
  }

  const primary = pinnedRecords[0]!
  const pinnedLookup: RequestOptions['lookup'] = (_hostname, opts, cb) => {
    const wantAll = typeof opts === 'object' && opts !== null && Boolean(opts.all)
    if (wantAll) {
      ;(cb as (err: NodeJS.ErrnoException | null, addresses: Array<{ address: string; family: number }>) => void)(
        null,
        pinnedRecords.map((r) => ({ address: r.address, family: r.family })),
      )
      return
    }
    ;(cb as (err: NodeJS.ErrnoException | null, address: string, family: number) => void)(
      null,
      primary.address,
      primary.family,
    )
  }

  const reqOpts: RequestOptions & { servername?: string } = {
    protocol: targetUrl.protocol,
    hostname: cleanHost,
    port: targetUrl.port || (isHttps ? 443 : 80),
    path: `${targetUrl.pathname}${targetUrl.search}`,
    method,
    headers: outHeaders,
    lookup: pinnedLookup,
    ...(isHttps && isIP(cleanHost) === 0 ? { servername: cleanHost } : {}),
  }

  return new Promise<Response>((resolve, reject) => {
    const req = (isHttps ? httpsRequest : httpRequest)(reqOpts)
    let settled = false

    const failReq = (err: unknown) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      req.destroy()
      reject(err instanceof Error ? err : new Error(String(err)))
    }

    const onAbort = () => {
      failReq(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    }

    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })

    req.once('error', failReq)
    req.once('response', (res: IncomingMessage) => {
      if (settled) {
        res.destroy()
        return
      }
      settled = true
      const status = res.statusCode ?? 502
      const respHeaders = toResponseHeaders(res.headers)
      if (method === 'HEAD' || NULL_BODY_STATUSES.has(status)) {
        signal.removeEventListener('abort', onAbort)
        res.resume()
        resolve(
          new Response(null, {
            status,
            statusText: res.statusMessage ?? '',
            headers: respHeaders,
          }),
        )
        return
      }
      res.once('close', () => signal.removeEventListener('abort', onAbort))
      const webBody = Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>
      resolve(
        new Response(webBody, {
          status,
          statusText: res.statusMessage ?? '',
          headers: respHeaders,
        }),
      )
    })

    pumpBodyToRequest(body, req, signal).catch(failReq)
  })
}

export interface SafeStorageFetchOptions {
  readonly allowLocalNetwork?: boolean
  readonly timeoutMs?: number
  /** Явный `fetch` (например мок в модульных тестах); при его передаче сетевой сокет не создаётся. */
  readonly baseFetch?: typeof fetch
  /** Переопределение резолвера DNS для детерминированных тестов DNS-rebinding. */
  readonly dnsResolver?: DnsResolverFn
}

/**
 * Создать SSRF-защищённый `fetch` с закреплением DNS-ответа (`lookup` pinning) и проверкой редиректов.
 */
export function createSafeStorageFetch(options?: SafeStorageFetchOptions): typeof fetch {
  const allowLocalNetwork = options?.allowLocalNetwork ?? !isCloudStorageEnv()
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const baseFetch = options?.baseFetch
  const resolver = options?.dnsResolver ?? defaultDnsResolver

  return async (input, init) => {
    const initialUrl = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    )
    let method = (
      init?.method ??
      (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')
    ).toUpperCase()
    const baseHeaders = new Headers(
      init?.headers ??
        (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined),
    )
    let currentBody: BodyInit | null | undefined =
      init?.body !== undefined
        ? init.body
        : typeof Request !== 'undefined' && input instanceof Request
          ? (input.body as BodyInit | null)
          : undefined

    const deadline = AbortSignal.timeout(timeoutMs)
    const callerSignal =
      init?.signal ??
      (typeof Request !== 'undefined' && input instanceof Request ? input.signal : undefined)
    const combinedSignal = callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline

    let currentUrl = initialUrl
    const currentHeaders = new Headers(baseHeaders)

    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
      const check = validateHttpEndpointUrl(currentUrl, allowLocalNetwork)
      if (!check.ok) {
        if (check.reason === 'https-required') {
          throw new Error('В облачном окружении разрешены только HTTPS-подключения к хранилищу')
        }
        throw new Error('Целевой адрес заблокирован политикой безопасности (SSRF)')
      }

      const verifyDns = baseFetch === undefined || options?.dnsResolver !== undefined
      const pinnedRecords = verifyDns
        ? await resolveAndValidateHost(currentUrl.hostname, allowLocalNetwork, resolver)
        : []

      const res = baseFetch
        ? await baseFetch(currentUrl.href, {
            method,
            headers: currentHeaders,
            body: currentBody,
            redirect: 'manual',
            signal: combinedSignal,
            ...(currentBody && typeof ReadableStream !== 'undefined' && currentBody instanceof ReadableStream
              ? ({ duplex: 'half' } as RequestInit)
              : {}),
          })
        : await executePinnedNodeHop(
            currentUrl,
            method,
            currentHeaders,
            currentBody,
            pinnedRecords,
            combinedSignal,
          )

      if (!REDIRECT_STATUSES.has(res.status)) {
        return res
      }

      const location = res.headers.get('location')
      if (!location) return res
      await res.body?.cancel().catch(() => {})

      if (hop === MAX_REDIRECT_HOPS) {
        throw new Error('Превышен лимит перенаправлений сервера хранилища')
      }

      const nextUrl = new URL(location, currentUrl)
      if (nextUrl.origin !== currentUrl.origin) {
        currentHeaders.delete('authorization')
        currentHeaders.delete('cookie')
        currentHeaders.delete('x-amz-security-token')
      }
      if (
        res.status === 303 ||
        ((res.status === 301 || res.status === 302) && method === 'POST')
      ) {
        method = 'GET'
        currentBody = undefined
        currentHeaders.delete('content-length')
        currentHeaders.delete('content-type')
      } else if (
        currentBody &&
        typeof ReadableStream !== 'undefined' &&
        currentBody instanceof ReadableStream
      ) {
        // Однопроходный поток нельзя переотправить по 307/308 на другой адрес без буферизации.
        throw new Error('Сервер хранилища вернул перенаправление во время потоковой передачи')
      }

      currentUrl = nextUrl
    }

    throw new Error('Превышен лимит перенаправлений сервера хранилища')
  }
}
