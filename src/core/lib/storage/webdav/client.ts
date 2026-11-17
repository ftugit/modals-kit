// Потоковый драйвер WebDAV (Облако Mail.ru, Nextcloud, Яндекс.Диск, Apache/Nginx DAV)
// на чистом Web `fetch` + `ReadableStream`, без `node:*` и без зависимостей от фреймворков.
//
// Потоковая архитектура и безопасность:
// - `0` буферизации файла целиком в памяти: `put()` отдаёт `ReadableStream` напрямую через
//   `fetch(..., { method: 'PUT', body, duplex: 'half' })` с `Content-Length` (если известен `size`)
//   или chunked-передачей; `lazy()` читает диапазоны через `GET` с `Range: bytes=start-end` (`206`).
// - Автоматическое создание родительских коллекций через `MKCOL` с кэшированием уже проверенных
//   директорий в памяти экземпляра (исключает `409 Conflict` на Облаке Mail.ru без повторных
//   сетевых запросов на каждый файл).
// - Строгая изоляция `basePath` (защита от выхода в личный корень облака) и жёсткий предохранитель
//   `readOnly` на самом драйвере (любые `put`/`del`/`copyObject`/`MKCOL` мгновенно отклоняются
//   ошибкой `StorageReadOnlyError` до отправки сетевого запроса).

import { normalizeStoragePath, StorageReadOnlyError } from './index.js'
import { basenameOfStoragePath } from './memory.js'
import { StreamFile } from './stream-file.js'
import type { DriverPutInput, DriverStoredMeta, StorageDriver } from './types.js'

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const PROPFIND_META_BODY =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<d:propfind xmlns:d="DAV:"><d:prop>' +
  '<d:resourcetype/><d:getcontentlength/><d:getcontenttype/><d:getlastmodified/><d:getetag/>' +
  '</d:prop></d:propfind>'

export interface WebdavDriverOptions {
  /** Базовый HTTP/HTTPS endpoint сервера WebDAV (например `https://webdav.cloud.mail.ru`). */
  readonly endpoint: string
  /** Логин пользователя (например email `user@mail.ru`). */
  readonly username: string
  /** Пароль внешнего приложения WebDAV. */
  readonly password: string
  /** Изолирующий подкаталог внутри облака (все операции строго ограничены `basePath`). */
  readonly basePath?: string
  /** Запретить любые мутирующие запросы (`PUT`, `MKCOL`, `DELETE`, `COPY`) на уровне драйвера. */
  readonly readOnly?: boolean
  /** Базовый публичный URL раздачи (если есть). */
  readonly publicBaseUrl?: string
  /** Пользовательская функция `fetch` (для детерминированных тестов без внешней сети). */
  readonly fetchImpl?: typeof fetch
}

export interface WebdavListedObject extends DriverStoredMeta {
  readonly etag?: string
}

export interface WebdavDriver extends StorageDriver {
  readonly kind: 'webdav'
  readonly readOnly: boolean
  readonly basePath?: string
  /** Нативное серверное копирование WebDAV `COPY` (`Destination` + `Overwrite`). */
  copyObject(
    fromPath: string,
    toPath: string,
    options?: { readonly overwrite?: boolean; readonly signal?: AbortSignal },
  ): Promise<DriverStoredMeta>
  /** Выборка файлов подкаталога через `PROPFIND` (`Depth: 1`). */
  listObjects(subPrefix?: string, signal?: AbortSignal): Promise<readonly WebdavListedObject[]>
}

export type WebdavDriverInput = string | URL | WebdavDriverOptions

/**
 * Чистое UTF-8 -> Base64 кодирование по RFC 4648 без `Buffer` и без `btoa`,
 * работающее одинаково в Node, Bun, Cloudflare Workers и браузерах с любыми UTF-8 паролями.
 */
function encodeUtf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!
    out +=
      BASE64_ALPHABET[(n >>> 18) & 63]! +
      BASE64_ALPHABET[(n >>> 12) & 63]! +
      BASE64_ALPHABET[(n >>> 6) & 63]! +
      BASE64_ALPHABET[n & 63]!
  }
  const rem = bytes.length - i
  if (rem === 1) {
    const n = bytes[i]! << 16
    out += BASE64_ALPHABET[(n >>> 18) & 63]! + BASE64_ALPHABET[(n >>> 12) & 63]! + '=='
  } else if (rem === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8)
    out +=
      BASE64_ALPHABET[(n >>> 18) & 63]! +
      BASE64_ALPHABET[(n >>> 12) & 63]! +
      BASE64_ALPHABET[(n >>> 6) & 63]! +
      '='
  }
  return out
}

function safeDecodeComponent(part: string): string {
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}

/**
 * Подготовить DSN-строку WebDAV перед `new URL(...)`, чтобы корректно принимать
 * человеческие email-логины с незакодированным `@` (например `webdav://user@mail.ru:pass@webdav.cloud.mail.ru/dir`).
 */
function normalizeRawWebdavDsnString(raw: string): string {
  const trimmed = raw.trim()
  const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(trimmed)
  if (!schemeMatch) return trimmed

  const scheme = schemeMatch[1]!
  const afterScheme = schemeMatch[2]!
  const slashIdx = afterScheme.search(/[/?#]/)
  const authority = slashIdx >= 0 ? afterScheme.slice(0, slashIdx) : afterScheme
  const tail = slashIdx >= 0 ? afterScheme.slice(slashIdx) : ''

  const lastAt = authority.lastIndexOf('@')
  if (lastAt <= 0) return trimmed

  const userInfo = authority.slice(0, lastAt)
  const hostPort = authority.slice(lastAt + 1)
  const colonIdx = userInfo.indexOf(':')
  if (colonIdx < 0) return trimmed

  const rawUser = safeDecodeComponent(userInfo.slice(0, colonIdx))
  const rawPass = safeDecodeComponent(userInfo.slice(colonIdx + 1))
  return `${scheme}://${encodeURIComponent(rawUser)}:${encodeURIComponent(rawPass)}@${hostPort}${tail}`
}

const WEBDAV_PROTOCOLS = new Set([
  'webdav:',
  'webdavs:',
  'dav:',
  'davs:',
  'webdav+http:',
  'webdav+https:',
  'dav+http:',
  'dav+https:',
])

export function isWebdavDsn(raw: string | URL): boolean {
  if (raw instanceof URL) {
    return WEBDAV_PROTOCOLS.has(raw.protocol.toLowerCase())
  }
  const m = /^([a-z][a-z0-9+.-]*:)\/\//i.exec(String(raw).trim())
  return Boolean(m?.[1] && WEBDAV_PROTOCOLS.has(m[1].toLowerCase()))
}

/**
 * Разобрать единую DSN-ссылку WebDAV:
 * `webdav://<username>:<password>@<host[:port]>[/<basePath>][?readOnly=1]`
 * (`webdav://` и `webdavs://` используют HTTPS; `webdav+http://` — HTTP для локальных стендов).
 */
export function parseWebdavUrl(
  raw: string | URL,
  overrides?: Partial<Omit<WebdavDriverOptions, 'endpoint' | 'username' | 'password'>>,
): WebdavDriverOptions {
  let u: URL
  try {
    u =
      raw instanceof URL
        ? new URL(raw.toString())
        : new URL(normalizeRawWebdavDsnString(String(raw)))
  } catch {
    throw new TypeError(
      '[storage/webdav] некорректный формат DSN-ссылки WebDAV (ожидался webdav://user:password@host[/basePath])',
    )
  }

  const proto = u.protocol.toLowerCase()
  if (!WEBDAV_PROTOCOLS.has(proto)) {
    throw new TypeError(
      `[storage/webdav] неподдерживаемая схема «${u.protocol}» (ожидалась webdav://, webdavs:// или webdav+http://)`,
    )
  }

  const username = safeDecodeComponent(u.username || '')
  const password = safeDecodeComponent(u.password || '')
  if (!username || !password) {
    throw new TypeError(
      '[storage/webdav] в ссылке webdav:// отсутствуют учётные данные (user:password@host)',
    )
  }
  if (!u.host) {
    throw new TypeError('[storage/webdav] в ссылке webdav:// отсутствует хост endpoint')
  }

  const pathSegments = u.pathname
    .split('/')
    .filter(Boolean)
    .map((seg) => safeDecodeComponent(seg))
  const joinedPrefix = pathSegments.join('/')
  const basePath =
    overrides?.basePath ?? (joinedPrefix ? normalizeStoragePath(joinedPrefix) : undefined)

  const isPlainHttp = proto === 'webdav+http:' || proto === 'dav+http:'
  const endpoint = `${isPlainHttp ? 'http' : 'https'}://${u.host}`

  const roParam = u.searchParams.get('readOnly')?.trim().toLowerCase()
  const readOnly =
    overrides?.readOnly ?? (roParam === '1' || roParam === 'true' ? true : undefined)
  const publicBaseUrl =
    overrides?.publicBaseUrl ?? (u.searchParams.get('publicBaseUrl')?.trim() || undefined)

  return {
    endpoint,
    username,
    password,
    ...(basePath ? { basePath } : {}),
    ...(readOnly !== undefined ? { readOnly } : {}),
    ...(publicBaseUrl ? { publicBaseUrl } : {}),
    ...(overrides?.fetchImpl ? { fetchImpl: overrides.fetchImpl } : {}),
  }
}

/**
 * Собрать единую DSN-строку `webdav://...` из параметров подключения (с безопасным URL-кодированием).
 */
export function formatWebdavUrl(
  options: Pick<WebdavDriverOptions, 'endpoint' | 'username' | 'password' | 'basePath' | 'readOnly'>,
): string {
  const endpointUrl = new URL(options.endpoint)
  const scheme = endpointUrl.protocol === 'http:' ? 'webdav+http' : 'webdav'
  const user = encodeURIComponent(options.username)
  const pass = encodeURIComponent(options.password)
  const cleanEndpointPath = endpointUrl.pathname.split('/').filter(Boolean).join('/')
  const combinedBase = [
    cleanEndpointPath,
    options.basePath ? normalizeStoragePath(options.basePath) : '',
  ]
    .filter(Boolean)
    .join('/')
  const suffix = combinedBase ? `/${encodeWebdavPath(combinedBase)}` : ''
  const qs = options.readOnly ? '?readOnly=1' : ''
  return `${scheme}://${user}:${pass}@${endpointUrl.host}${suffix}${qs}`
}

/**
 * Безопасная витрина ссылки `webdav://***@host[/basePath]` без логина и пароля (для логов и UI куки-сейфа).
 */
export function maskWebdavUrl(raw: string | URL): string {
  const parsed = parseWebdavUrl(raw)
  const endpointUrl = new URL(parsed.endpoint)
  const scheme = endpointUrl.protocol === 'http:' ? 'webdav+http' : 'webdav'
  const suffix = parsed.basePath ? `/${parsed.basePath}` : ''
  return `${scheme}://***@${endpointUrl.host}${suffix}`
}

/** Максимальный размер XML-ответа `PROPFIND` (`8 МиБ`), защита от переполнения памяти. */
const MAX_PROPFIND_XML_BYTES = 8 * 1024 * 1024

const NAMED_XML_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

function encodeRfc3986(seg: string): string {
  return encodeURIComponent(seg).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

function encodeWebdavPath(cleanPath: string): string {
  return cleanPath
    .split('/')
    .filter(Boolean)
    .map((seg) => encodeRfc3986(seg))
    .join('/')
}

function decodeXmlEntities(raw: string): string {
  return raw.replace(
    /&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos);/g,
    (entity, token: string) => {
      if (token.startsWith('#x')) {
        const cp = Number.parseInt(token.slice(2), 16)
        return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff
          ? String.fromCodePoint(cp)
          : entity
      }
      if (token.startsWith('#')) {
        const cp = Number.parseInt(token.slice(1), 10)
        return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff
          ? String.fromCodePoint(cp)
          : entity
      }
      return NAMED_XML_ENTITIES[token] ?? entity
    },
  )
}

function decodeHrefPathname(href: string): string {
  let rawPath = href.trim()
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rawPath)) {
    try {
      rawPath = new URL(rawPath).pathname
    } catch {
      // оставляем как есть
    }
  }
  rawPath = rawPath.split('?')[0]!.split('#')[0]!
  if (!rawPath.startsWith('/')) rawPath = `/${rawPath}`
  const decoded = rawPath
    .split('/')
    .map((s) => safeDecodeComponent(s))
    .join('/')
    .replace(/\/+/g, '/')
  return decoded.length > 1 ? decoded.replace(/\/+$/, '') : decoded
}

async function readBoundedXml(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new RangeError(
          `[storage/webdav] ответ PROPFIND превысил лимит ${maxBytes} байт`,
        )
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const merged = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    merged.set(c, off)
    off += c.byteLength
  }
  return new TextDecoder().decode(merged)
}

function extractDavTag(xmlBlock: string, localName: string): string | null {
  const re = new RegExp(
    `<(?:[A-Za-z0-9_.-]+:)?${localName}(?:\\s[^/>]*)?>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_.-]+:)?${localName}\\s*>`,
    'i',
  )
  const m = re.exec(xmlBlock)
  return m ? decodeXmlEntities(m[1]!.trim()) : null
}

function hasDavCollectionResourceType(xmlBlock: string): boolean {
  const rt = extractDavTag(xmlBlock, 'resourcetype')
  if (!rt) return false
  return /<(?:[A-Za-z0-9_.-]+:)?collection\b/i.test(rt)
}

interface ParsedDavResponseItem {
  readonly href: string
  readonly isCollection: boolean
  readonly size: number
  readonly contentType: string
  readonly lastModified: number
  readonly etag?: string
}

function parsePropfindResponses(xml: string): ParsedDavResponseItem[] {
  const items: ParsedDavResponseItem[] = []
  const responseRe =
    /<(?:[A-Za-z0-9_.-]+:)?response(?:\s[^/>]*)?>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?response\s*>/gi
  let match: RegExpExecArray | null
  while ((match = responseRe.exec(xml)) !== null) {
    const block = match[1]!
    const href = extractDavTag(block, 'href') ?? ''
    // Собираем только успешные 2xx секции propstat (никогда не читаем теги из 404/403 propstat!)
    const propstatRe =
      /<(?:[A-Za-z0-9_.-]+:)?propstat(?:\s[^/>]*)?>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?propstat\s*>/gi
    const okPropstats: string[] = []
    let sawPropstat = false
    let pm: RegExpExecArray | null
    while ((pm = propstatRe.exec(block)) !== null) {
      sawPropstat = true
      const statusText = extractDavTag(pm[1]!, 'status') ?? ''
      if (/\b2\d\d\b/.test(statusText) || !statusText) {
        okPropstats.push(pm[1]!)
      }
    }
    const propSource = sawPropstat ? okPropstats.join('\n') : block

    const isCollection = hasDavCollectionResourceType(propSource)
    const lenRaw = extractDavTag(propSource, 'getcontentlength')
    const parsedLen = lenRaw !== null && lenRaw !== '' ? Number(lenRaw) : 0
    const size = Number.isFinite(parsedLen) && parsedLen >= 0 ? Math.trunc(parsedLen) : 0
    const contentType =
      extractDavTag(propSource, 'getcontenttype')?.split(';')[0]?.trim() ||
      'application/octet-stream'
    const mtimeRaw = extractDavTag(propSource, 'getlastmodified')
    const parsedMtime = mtimeRaw ? Date.parse(mtimeRaw) : Number.NaN
    const lastModified = Number.isFinite(parsedMtime) ? parsedMtime : 0
    const rawEtag = extractDavTag(propSource, 'getetag')?.replace(/^W\//i, '').replace(/^"|"$/g, '')

    items.push({
      href,
      isCollection,
      size,
      contentType,
      lastModified,
      ...(rawEtag ? { etag: rawEtag } : {}),
    })
  }
  return items
}

/**
 * Построить потоковый драйвер WebDAV (`kind: 'webdav'`) из объекта настроек
 * или из одной DSN-строки `webdav://user:password@host[/basePath]`.
 */
export function webdavDriver(
  input: WebdavDriverInput,
  urlOverrides?: Partial<Omit<WebdavDriverOptions, 'endpoint' | 'username' | 'password'>>,
): WebdavDriver {
  const options =
    typeof input === 'string' || input instanceof URL
      ? parseWebdavUrl(input, urlOverrides)
      : input

  if (!options.endpoint || !options.username || !options.password) {
    throw new TypeError(
      '[storage/webdav] webdavDriver: обязательны endpoint, username и password',
    )
  }

  let parsedEndpoint: URL
  try {
    parsedEndpoint = new URL(options.endpoint)
  } catch {
    throw new TypeError(`[storage/webdav] некорректный URL endpoint: «${options.endpoint}»`)
  }

  const endpointPathSegments = parsedEndpoint.pathname
    .split('/')
    .filter(Boolean)
    .map((s) => safeDecodeComponent(s))
  const cleanBasePath = options.basePath ? normalizeStoragePath(options.basePath) : undefined
  const fullRootSegments = [
    ...endpointPathSegments,
    ...(cleanBasePath ? cleanBasePath.split('/') : []),
  ]
  const origin = parsedEndpoint.origin
  const readOnly = Boolean(options.readOnly)
  const fetchFn = options.fetchImpl ?? globalThis.fetch
  const authHeader = `Basic ${encodeUtf8Base64(`${options.username}:${options.password}`)}`

  // Кэш уже созданных/подтверждённых директорий и карта выполняющихся MKCOL (без параллельных гонок 409/423)
  const ensuredCollections = new Set<string>()
  const inflightCollections = new Map<string, Promise<void>>()

  function assertWritable(): void {
    if (readOnly) {
      throw new StorageReadOnlyError(`webdav:${parsedEndpoint.host}`)
    }
  }

  function fullKeySegments(cleanRelativePath?: string): string[] {
    if (!cleanRelativePath) return [...fullRootSegments]
    return [...fullRootSegments, ...cleanRelativePath.split('/')]
  }

  function buildTargetUrl(cleanRelativePath?: string, asCollection = false): string {
    const segs = fullKeySegments(cleanRelativePath)
    if (segs.length === 0) return `${origin}/`
    const encoded = segs.map((s) => encodeRfc3986(s)).join('/')
    return `${origin}/${encoded}${asCollection ? '/' : ''}`
  }

  async function ensureSingleCollection(accum: string): Promise<void> {
    if (ensuredCollections.has(accum)) return
    const existing = inflightCollections.get(accum)
    if (existing) {
      await existing
      return
    }

    const task = (async () => {
      const colUrl = `${origin}/${accum}/`
      const res = await fetchFn(colUrl, {
        method: 'MKCOL',
        redirect: 'manual',
        headers: {
          authorization: authHeader,
        },
      })
      await res.arrayBuffer().catch(() => undefined)

      // 201 Created / 200 / 204 — создано; 405 Method Not Allowed — коллекция уже существует (Облако Mail.ru / Nginx / Nextcloud)
      if (
        res.status === 201 ||
        res.status === 200 ||
        res.status === 204 ||
        res.status === 405
      ) {
        ensuredCollections.add(accum)
        return
      }

      throw new Error(
        `[storage/webdav] MKCOL «/${accum}/» завершился со статусом ${res.status}`,
      )
    })()

    inflightCollections.set(accum, task)
    try {
      await task
    } finally {
      inflightCollections.delete(accum)
    }
  }

  async function ensureParentCollections(
    cleanFilePath: string,
    signal?: AbortSignal,
  ): Promise<void> {
    assertWritable()
    const fileSegs = cleanFilePath.split('/')
    fileSegs.pop() // убираем само имя файла
    const dirSegments = [...fullRootSegments, ...fileSegs]
    if (dirSegments.length === 0) return

    let accum = ''
    for (const seg of dirSegments) {
      signal?.throwIfAborted()
      const encSeg = encodeRfc3986(seg)
      accum = accum ? `${accum}/${encSeg}` : encSeg
      if (ensuredCollections.has(accum)) continue
      if (signal) {
        await Promise.race([
          ensureSingleCollection(accum),
          new Promise<never>((_, reject) => {
            if (signal.aborted) {
              reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
              return
            }
            const onAbort = () =>
              reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
            signal.addEventListener('abort', onAbort, { once: true })
            void ensureSingleCollection(accum).then(
              () => signal.removeEventListener('abort', onAbort),
              () => signal.removeEventListener('abort', onAbort),
            )
          }),
        ])
      } else {
        await ensureSingleCollection(accum)
      }
    }
  }

  function monitorPutStream(
    source: ReadableStream<Uint8Array>,
    expectedSize: number | undefined,
    signal: AbortSignal | undefined,
    onDone: (total: number) => void,
  ): ReadableStream<Uint8Array> {
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
    let seen = 0

    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          signal?.throwIfAborted()
          if (!reader) {
            reader = source.getReader()
          }
          const { done, value } = await reader.read()
          signal?.throwIfAborted()
          if (done) {
            reader.releaseLock()
            reader = null
            if (expectedSize !== undefined && seen !== expectedSize) {
              throw new RangeError(
                `[storage/webdav] поток оборвался раньше заявленного размера: ${seen} !== ${expectedSize}`,
              )
            }
            onDone(seen)
            controller.close()
            return
          }
          seen += value.byteLength
          if (expectedSize !== undefined && seen > expectedSize) {
            throw new RangeError(
              `[storage/webdav] поток превысил заявленный размер: ${seen} > ${expectedSize}`,
            )
          }
          controller.enqueue(value)
        } catch (err) {
          if (reader) {
            await reader.cancel(err).catch(() => undefined)
            reader.releaseLock()
            reader = null
          }
          controller.error(err)
        }
      },
      async cancel(reason) {
        if (reader) {
          await reader.cancel(reason).catch(() => undefined)
          reader.releaseLock()
          reader = null
        }
      },
    })
  }

  return {
    kind: 'webdav',
    readOnly,
    ...(cleanBasePath ? { basePath: cleanBasePath } : {}),
    ...(options.publicBaseUrl ? { publicBaseUrl: options.publicBaseUrl } : {}),

    async put(input: DriverPutInput): Promise<DriverStoredMeta> {
      assertWritable()
      input.signal?.throwIfAborted()
      const cleanPath = normalizeStoragePath(input.path)

      await ensureParentCollections(cleanPath, input.signal)

      let streamedBytes = 0
      const targetUrl = buildTargetUrl(cleanPath)
      const headers: Record<string, string> = {
        authorization: authHeader,
        'content-type': input.contentType || 'application/octet-stream',
      }
      if (input.size !== undefined) {
        headers['content-length'] = String(input.size)
      }

      const bodyInit: BodyInit =
        input.size === 0
          ? new Uint8Array(0)
          : monitorPutStream(input.stream, input.size, input.signal, (n) => {
              streamedBytes = n
            })

      if (input.size === 0) {
        // Дренируем пустой поток, чтобы освободить блокировки читателя и убедиться, что в нём 0 байт
        const r = input.stream.getReader()
        try {
          const { done, value } = await r.read()
          if (!done && value && value.byteLength > 0) {
            throw new RangeError('[storage/webdav] поток превысил заявленный размер: > 0')
          }
        } finally {
          r.releaseLock()
        }
      }

      const init: RequestInit & { duplex?: 'half' } = {
        method: 'PUT',
        redirect: 'manual',
        headers,
        body: bodyInit,
        ...(input.size === 0 ? {} : { duplex: 'half' }),
        ...(input.signal ? { signal: input.signal } : {}),
      }

      const res = await fetchFn(targetUrl, init as RequestInit)
      const errText = res.ok ? '' : await res.text().catch(() => '')
      if (res.ok) {
        await res.arrayBuffer().catch(() => undefined)
      } else {
        throw new Error(
          `[storage/webdav] PUT «${cleanPath}» завершился со статусом ${res.status}${errText ? `: ${errText.slice(0, 180)}` : ''}`,
        )
      }

      return {
        path: cleanPath,
        size: input.size ?? streamedBytes,
        contentType: input.contentType || 'application/octet-stream',
        lastModified: input.lastModified,
      }
    },

    async head(path: string): Promise<DriverStoredMeta | null> {
      const cleanPath = normalizeStoragePath(path)
      const targetUrl = buildTargetUrl(cleanPath)
      const expectedPath = `/${fullKeySegments(cleanPath).join('/')}`

      const propRes = await fetchFn(targetUrl, {
        method: 'PROPFIND',
        redirect: 'manual',
        headers: {
          authorization: authHeader,
          depth: '0',
          'content-type': 'application/xml; charset=utf-8',
        },
        body: PROPFIND_META_BODY,
      })

      if (propRes.status === 404 || propRes.status === 410) {
        await propRes.arrayBuffer().catch(() => undefined)
        return null
      }

      if (propRes.status === 207 || propRes.status === 200) {
        const xml = await readBoundedXml(propRes, MAX_PROPFIND_XML_BYTES)
        if (!/<(?:[A-Za-z0-9_.-]+:)?multistatus\b/i.test(xml)) {
          throw new Error(
            `[storage/webdav] некорректный ответ PROPFIND «${cleanPath}» (${propRes.status}): отсутствует multistatus XML`,
          )
        }
        const items = parsePropfindResponses(xml)
        const matched =
          items.find((it) => !it.href || decodeHrefPathname(it.href) === expectedPath) ??
          null
        if (!matched || matched.isCollection) {
          return null
        }
        return {
          path: cleanPath,
          size: matched.size,
          contentType: matched.contentType,
          lastModified: matched.lastModified || Date.now(),
        }
      }

      await propRes.arrayBuffer().catch(() => undefined)

      // Фолбэк на классический HTTP HEAD для упрощённых HTTP-DAV стендов без PROPFIND
      if (propRes.status === 405 || propRes.status === 501) {
        const headRes = await fetchFn(targetUrl, {
          method: 'HEAD',
          redirect: 'manual',
          headers: { authorization: authHeader },
        })
        if (headRes.status === 404 || headRes.status === 410) return null
        if (!headRes.ok) {
          throw new Error(
            `[storage/webdav] HEAD «${cleanPath}» завершился со статусом ${headRes.status}`,
          )
        }
        const lenHeader = headRes.headers.get('content-length')
        const size = lenHeader ? Math.max(0, Math.trunc(Number(lenHeader))) : 0
        const contentType =
          headRes.headers.get('content-type')?.split(';')[0]?.trim() ||
          'application/octet-stream'
        const mtimeHeader = headRes.headers.get('last-modified')
        const parsedMtime = mtimeHeader ? Date.parse(mtimeHeader) : Number.NaN
        return {
          path: cleanPath,
          size: Number.isFinite(size) ? size : 0,
          contentType,
          lastModified: Number.isFinite(parsedMtime) ? parsedMtime : Date.now(),
        }
      }

      throw new Error(
        `[storage/webdav] PROPFIND «${cleanPath}» завершился со статусом ${propRes.status}`,
      )
    },

    async lazy(path: string): Promise<StreamFile | null> {
      const cleanPath = normalizeStoragePath(path)
      const meta = await this.head(cleanPath)
      if (!meta) return null

      const fileName = basenameOfStoragePath(cleanPath)
      const targetUrl = buildTargetUrl(cleanPath)

      return new StreamFile(
        {
          byteLength: meta.size,
          stream(start = 0, end = meta.size) {
            const clampedStart = Math.max(0, Math.min(start, meta.size))
            const clampedEnd = Math.max(clampedStart, Math.min(end, meta.size))
            if (clampedEnd <= clampedStart || meta.size === 0) {
              return new ReadableStream<Uint8Array<ArrayBuffer>>({
                start(c) {
                  c.close()
                },
              })
            }

            let upstreamReader: ReadableStreamDefaultReader<Uint8Array> | null = null
            let sliceRemaining = clampedEnd - clampedStart
            let dropPrefix = 0

            return new ReadableStream<Uint8Array<ArrayBuffer>>({
              async pull(controller) {
                try {
                  if (!upstreamReader) {
                    const res = await fetchFn(targetUrl, {
                      method: 'GET',
                      redirect: 'manual',
                      headers: {
                        authorization: authHeader,
                        range: `bytes=${clampedStart}-${clampedEnd - 1}`,
                      },
                    })
                    if (res.status !== 206 && res.status !== 200) {
                      await res.arrayBuffer().catch(() => undefined)
                      throw new Error(
                        `[storage/webdav] GET Range «${cleanPath}» завершился со статусом ${res.status}`,
                      )
                    }
                    if (!res.body) {
                      controller.close()
                      return
                    }
                    // Если сервер проигнорировал Range и вернул 200 целиком — аккуратно отрезаем префикс и хвост на потоке
                    if (res.status === 200 && clampedStart > 0) {
                      dropPrefix = clampedStart
                    }
                    upstreamReader = res.body.getReader()
                  }

                  while (sliceRemaining > 0) {
                    const { done, value } = await upstreamReader.read()
                    if (done) {
                      upstreamReader.releaseLock()
                      upstreamReader = null
                      controller.close()
                      return
                    }
                    let chunk = value
                    if (dropPrefix > 0) {
                      if (chunk.byteLength <= dropPrefix) {
                        dropPrefix -= chunk.byteLength
                        continue
                      }
                      chunk = chunk.subarray(dropPrefix)
                      dropPrefix = 0
                    }
                    if (chunk.byteLength > sliceRemaining) {
                      chunk = chunk.subarray(0, sliceRemaining)
                    }
                    sliceRemaining -= chunk.byteLength
                    const out = new Uint8Array(new ArrayBuffer(chunk.byteLength))
                    out.set(chunk)
                    controller.enqueue(out)
                    if (sliceRemaining <= 0) {
                      await upstreamReader.cancel().catch(() => undefined)
                      upstreamReader.releaseLock()
                      upstreamReader = null
                      controller.close()
                    }
                    return
                  }
                } catch (err) {
                  if (upstreamReader) {
                    await upstreamReader.cancel(err).catch(() => undefined)
                    upstreamReader.releaseLock()
                    upstreamReader = null
                  }
                  controller.error(err)
                }
              },
              async cancel(reason) {
                if (upstreamReader) {
                  await upstreamReader.cancel(reason).catch(() => undefined)
                  upstreamReader.releaseLock()
                  upstreamReader = null
                }
              },
            })
          },
        },
        fileName,
        { type: meta.contentType, lastModified: meta.lastModified },
      )
    },

    async del(path: string): Promise<boolean> {
      assertWritable()
      const cleanPath = normalizeStoragePath(path)
      const targetUrl = buildTargetUrl(cleanPath)
      const res = await fetchFn(targetUrl, {
        method: 'DELETE',
        redirect: 'manual',
        headers: { authorization: authHeader },
      })
      await res.arrayBuffer().catch(() => undefined)
      if (res.status === 404 || res.status === 410) {
        return false
      }
      if (res.ok) {
        return true
      }
      throw new Error(
        `[storage/webdav] DELETE «${cleanPath}» завершился со статусом ${res.status}`,
      )
    },

    async copyObject(
      fromPath: string,
      toPath: string,
      copyOptions?: { readonly overwrite?: boolean; readonly signal?: AbortSignal },
    ): Promise<DriverStoredMeta> {
      assertWritable()
      copyOptions?.signal?.throwIfAborted()
      const cleanFrom = normalizeStoragePath(fromPath)
      const cleanTo = normalizeStoragePath(toPath)

      await ensureParentCollections(cleanTo, copyOptions?.signal)

      const srcUrl = buildTargetUrl(cleanFrom)
      const dstUrl = buildTargetUrl(cleanTo)
      const res = await fetchFn(srcUrl, {
        method: 'COPY',
        redirect: 'manual',
        headers: {
          authorization: authHeader,
          destination: dstUrl,
          overwrite: copyOptions?.overwrite === false ? 'F' : 'T',
        },
        ...(copyOptions?.signal ? { signal: copyOptions.signal } : {}),
      })
      await res.arrayBuffer().catch(() => undefined)
      if (!res.ok) {
        throw new Error(
          `[storage/webdav] COPY «${cleanFrom}» -> «${cleanTo}» завершился со статусом ${res.status}`,
        )
      }

      const copiedMeta = await this.head(cleanTo)
      if (!copiedMeta) {
        throw new Error(
          `[storage/webdav] после COPY объект «${cleanTo}» не обнаружен через PROPFIND`,
        )
      }
      return copiedMeta
    },

    async listObjects(
      subPrefix?: string,
      signal?: AbortSignal,
    ): Promise<readonly WebdavListedObject[]> {
      const cleanSub = subPrefix?.trim() ? normalizeStoragePath(subPrefix) : undefined
      const colUrl = buildTargetUrl(cleanSub, true)
      const res = await fetchFn(colUrl, {
        method: 'PROPFIND',
        redirect: 'manual',
        headers: {
          authorization: authHeader,
          depth: '1',
          'content-type': 'application/xml; charset=utf-8',
        },
        body: PROPFIND_META_BODY,
        ...(signal ? { signal } : {}),
      })
      if (res.status === 404 || res.status === 410) {
        await res.arrayBuffer().catch(() => undefined)
        return []
      }
      if (res.status !== 207 && res.status !== 200) {
        await res.arrayBuffer().catch(() => undefined)
        throw new Error(
          `[storage/webdav] PROPFIND Depth:1 завершился со статусом ${res.status}`,
        )
      }

      const xml = await readBoundedXml(res, MAX_PROPFIND_XML_BYTES)
      if (!/<(?:[A-Za-z0-9_.-]+:)?multistatus\b/i.test(xml)) {
        throw new Error(
          `[storage/webdav] некорректный ответ PROPFIND Depth:1 (${res.status}): отсутствует multistatus XML`,
        )
      }
      const parsed = parsePropfindResponses(xml)
      const rootPathPrefix =
        fullRootSegments.length > 0 ? `/${fullRootSegments.join('/')}/` : '/'
      const scopedSegs = fullKeySegments(cleanSub)
      const scopedFolderPrefix =
        scopedSegs.length > 0 ? `/${scopedSegs.join('/')}/` : '/'

      const results: WebdavListedObject[] = []
      for (const item of parsed) {
        if (item.isCollection || !item.href) continue
        const decodedHref = `${decodeHrefPathname(item.href)}`
        // Защита HREF-ESCAPE: отбрасываем любые href вне запрошенной подпапки и вне basePath
        if (!decodedHref.startsWith(scopedFolderPrefix) || !decodedHref.startsWith(rootPathPrefix)) {
          continue
        }
        const rel = decodedHref.slice(rootPathPrefix.length).replace(/\/+$/, '')
        if (!rel) continue
        let normalizedRel: string
        try {
          normalizedRel = normalizeStoragePath(rel)
        } catch {
          continue
        }
        results.push({
          path: normalizedRel,
          size: item.size,
          contentType: item.contentType,
          lastModified: item.lastModified || Date.now(),
          ...(item.etag ? { etag: item.etag } : {}),
        })
      }
      return results
    },
  }
}
