// Общие примитивы протокола WebDAV (RFC 4918) для обеих сторон:
// - клиента-драйвера `#core/lib/storage/webdav/client.js`;
// - серверного обработчика `#core/lib/storage/webdav/server.js`.
//
// Здесь только чистая работа с `Request`/`URL`/строками: без `node:*`, без DOM
// (`DOMParser`), без фреймворков, поэтому модуль одинаково исполняется в Node.js,
// Bun, Cloudflare Workers и Vercel Functions.

/** Вид ресурса в DAV-дереве. */
export type DavKind = 'collection' | 'file'

/** Глубина обхода в `PROPFIND`/`COPY`/`LOCK` (`Depth`). */
export type DavDepth = '0' | '1' | 'infinity'

/**
 * Описание ресурса, которое сервер отдаёт в `PROPFIND` и `stat`.
 *
 * `etag` обязан совпадать с заголовком `ETag`, который сервер выставит на `GET`.
 * Для файлов, отдаваемых через `createFileResponse` (`@remix-run/response/file`),
 * это {@link weakEtag}: `W/"<size>-<lastModified>"`.
 */
export interface DavResource {
  /** Относительный путь внутри корня монтирования (`''` — сам корень). */
  readonly path: string
  readonly kind: DavKind
  readonly size?: number
  readonly contentType?: string
  readonly lastModified?: number
  readonly etag?: string
  /** Время создания, если бэкенд его знает (`creationdate`). */
  readonly createdAt?: number
  /** Имя для `displayname`; по умолчанию — последний сегмент пути. */
  readonly displayName?: string
}

/**
 * Минимальный файловый контракт для `createFileResponse`.
 * Ему удовлетворяют `StreamFile` (`@remix-run/lazy-file`) и обычный `File`.
 */
export interface DavFileLike {
  readonly name: string
  readonly size: number
  readonly type: string
  readonly lastModified: number
  stream(): ReadableStream<Uint8Array>
  arrayBuffer(): Promise<ArrayBuffer>
  slice(
    start?: number,
    end?: number,
    contentType?: string,
  ): { stream(): ReadableStream<Uint8Array> }
}

/** Ошибка разбора DAV-пути (ответ `400 Bad Request`). */
export class DavPathError extends Error {
  constructor(message: string) {
    super(`[storage/webdav] ${message}`)
    this.name = 'DavPathError'
  }
}

/** Человеческие причины статусов, которые использует обработчик. */
const REASON_PHRASES: Readonly<Record<number, string>> = {
  200: 'OK',
  201: 'Created',
  204: 'No Content',
  207: 'Multi-Status',
  304: 'Not Modified',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  412: 'Precondition Failed',
  415: 'Unsupported Media Type',
  416: 'Range Not Satisfiable',
  423: 'Locked',
  424: 'Failed Dependency',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  507: 'Insufficient Storage',
}

/** `HTTP/1.1 404 Not Found` — строка статуса для `propstat`/`status`. */
export function davStatusLine(status: number): string {
  return `HTTP/1.1 ${status} ${REASON_PHRASES[status] ?? 'Unknown'}`
}

/** Экранирование текста и значений атрибутов в XML. */
export function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (ch) =>
      ch === '&'
        ? '&amp;'
        : ch === '<'
          ? '&lt;'
          : ch === '>'
            ? '&gt;'
            : ch === '"'
              ? '&quot;'
              : '&apos;',
  )
}

function encodeRfc3986(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

/** Сегмент DAV-пути, закодированный по RFC 3986 (как в клиентском драйвере). */
export function encodeDavSegment(segment: string): string {
  return encodeRfc3986(segment)
}

/**
 * `href` для ответа сервера: абсолютный путь от корня сайта, с префиксом
 * монтирования и завершающим `/` у коллекций (`'/dav/folder/'`).
 */
export function encodeDavHref(
  path: string,
  kind: DavKind = 'file',
  basePath = '',
): string {
  const prefix = normalizeDavBasePath(basePath)
  const segments = [prefix, path]
    .filter(Boolean)
    .join('/')
    .split('/')
    .filter(Boolean)
    .map(encodeRfc3986)
  const suffix = kind === 'collection' ? '/' : ''
  return `/${segments.join('/')}${suffix}`
}

/** Нормализовать префикс монтирования (`'/dav/'` → `'dav'`). */
export function normalizeDavBasePath(basePath: string | undefined): string {
  if (!basePath) return ''
  return basePath
    .split('/')
    .filter((segment) => segment && segment !== '.')
    .join('/')
}

function safeDecodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    throw new DavPathError(`некорректный процент-код в сегменте «${segment}»`)
  }
}

/**
 * Разобрать URL-путь запроса в относительный DAV-путь.
 *
 * - отбрасывает query/hash;
 * - декодирует каждый сегмент;
 * - запрещает `.`/`..`, `/`, `\` и управляющие символы внутри сегмента;
 * - возвращает путь без ведущего и замыкающего `/` (`''` — корень).
 */
export function decodeDavPath(rawPathname: string): string {
  const raw = rawPathname.split('?')[0]!.split('#')[0]!
  const segments: string[] = []
  for (const rawSegment of raw.split('/')) {
    if (!rawSegment) continue
    if (rawSegment === '.' || rawSegment === '..') {
      throw new DavPathError('выход за пределы корня (`..`) запрещён')
    }
    const segment = safeDecodeSegment(rawSegment)
    if (segment === '.' || segment === '..') {
      throw new DavPathError('выход за пределы корня (`..`) запрещён')
    }
    if (segment.includes('/') || segment.includes('\\') || segment.includes('\0')) {
      throw new DavPathError('недопустимый символ в сегменте пути')
    }
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(segment)) {
      throw new DavPathError('управляющие символы в сегменте пути запрещены')
    }
    segments.push(segment)
  }
  return segments.join('/')
}

/** Относительный DAV-путь из `URL.pathname` с учётом префикса монтирования. */
export function pathnameToDavPath(pathname: string, basePath = ''): string {
  const prefix = normalizeDavBasePath(basePath)
  const decoded = decodeDavPath(pathname)
  if (!prefix) return decoded
  if (decoded === prefix) return ''
  if (!decoded.startsWith(`${prefix}/`)) {
    throw new DavPathError(`путь вне корня монтирования «/${prefix}»`)
  }
  return decoded.slice(prefix.length + 1)
}

/** Родительский DAV-путь (`'a/b/c'` → `'a/b'`, `'a'` → `''`). */
export function davParentPath(path: string): string {
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index)
}

/** Последний сегмент DAV-пути (`'a/b/c.txt'` → `'c.txt'`). */
export function davBaseName(path: string): string {
  const index = path.lastIndexOf('/')
  return index < 0 ? path : path.slice(index + 1)
}

/**
 * Разобрать заголовок `Depth`. Возвращает `null` для неизвестного значения —
 * сервер отвечает `400`, а не угадывает.
 */
export function parseDavDepth(value: string | null, fallback: DavDepth = '1'): DavDepth | null {
  if (value === null || value.trim() === '') return fallback
  const normalized = value.trim().toLowerCase()
  if (normalized === '0' || normalized === '1') return normalized
  if (normalized === 'infinity') return 'infinity'
  return null
}

/** Разобрать `Destination` (абсолютный URI или путь) в DAV-путь. */
export function parseDavDestination(
  request: Request,
  basePath = '',
): string {
  const header = request.headers.get('destination')
  if (!header) throw new DavPathError('заголовок Destination обязателен')
  let pathname: string
  try {
    pathname = new URL(header, request.url).pathname
  } catch {
    throw new DavPathError(`некорректный Destination «${header}»`)
  }
  return pathnameToDavPath(pathname, basePath)
}

/** `Overwrite: F` — запрет перезаписи; по умолчанию `T` (`true`). */
export function parseDavOverwrite(value: string | null): boolean {
  return value?.trim().toUpperCase() !== 'F'
}

/** `true`, если путь `inner` лежит внутри `outer` (или равен ему). */
export function isDavPathWithin(inner: string, outer: string): boolean {
  if (outer === '') return true
  return inner === outer || inner.startsWith(`${outer}/`)
}

/** `W/"<size>-<lastModified>"` — тот же ETag, что строит `createFileResponse`. */
export function weakEtag(size: number, lastModified: number): string {
  return `W/"${size}-${lastModified}"`
}

/** HTTP-дата в формате RFC 1123 (`getlastmodified`). */
export function davHttpDate(timestamp: number): string {
  return new Date(Number.isFinite(timestamp) ? timestamp : 0).toUTCString()
}

/** ISO-8601 с миллисекундами (`creationdate`). */
export function davIsoDate(timestamp: number): string {
  return new Date(Number.isFinite(timestamp) ? timestamp : 0).toISOString()
}

/**
 * Вытащить lock-токены из заголовков `If` и `Lock-Token`.
 *
 * Поддерживается практическая часть RFC 4918: `If: (<urn:uuid:…>)`,
 * `If: <http://host/path> (<urn:uuid:…>)`, `Lock-Token: <urn:uuid:…>`.
 * `Not`-условия намеренно не разбираются: сервер проверяет только владение токеном.
 */
export function parseDavLockTokens(headers: Headers): readonly string[] {
  const sources = [headers.get('if'), headers.get('lock-token')]
  const tokens = new Set<string>()
  for (const source of sources) {
    if (!source) continue
    for (const match of source.matchAll(/<([^>]+)>/g)) {
      const token = match[1]?.trim()
      if (token && token.startsWith('urn:uuid:')) tokens.add(token)
    }
  }
  return [...tokens]
}

/** Разобрать `Authorization: Basic …` без `Buffer`/`atob` (UTF-8, как в клиенте). */
export function parseBasicAuthorization(
  header: string | null,
): { readonly username: string; readonly password: string } | null {
  if (!header) return null
  const match = /^Basic\s+(.+)$/i.exec(header.trim())
  if (!match?.[1]) return null
  let decoded: string
  try {
    decoded = new TextDecoder().decode(base64ToBytes(match[1].trim()))
  } catch {
    return null
  }
  const colon = decoded.indexOf(':')
  if (colon < 0) return null
  return { username: decoded.slice(0, colon), password: decoded.slice(colon + 1) }
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const BASE64_LOOKUP: Readonly<Record<string, number>> = Object.fromEntries(
  [...BASE64_ALPHABET].map((ch, index) => [ch, index]),
)

function base64ToBytes(text: string): Uint8Array {
  const clean = text.replace(/[\s=]/g, '')
  if (/[^A-Za-z0-9+/]/.test(clean)) throw new TypeError('некорректный base64')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let buffer = 0
  let bits = 0
  let offset = 0
  for (const ch of clean) {
    const value = BASE64_LOOKUP[ch]
    if (value === undefined) throw new TypeError('некорректный base64')
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[offset++] = (buffer >> bits) & 0xff
    }
  }
  return out.subarray(0, offset)
}

/** Сравнение строк за постоянное время (Basic-пароль не утекает по таймингам). */
export function timingSafeStringEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left)
  const b = new TextEncoder().encode(right)
  let diff = a.byteLength ^ b.byteLength
  const length = Math.max(a.byteLength, b.byteLength)
  for (let i = 0; i < length; i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  }
  return diff === 0
}
