// Серверная сторона WebDAV: `Request` → `Response` поверх абстрактного `DavBackend`.
//
// Ядро намеренно не знает ни про `#core/lib/db`, ни про модель «Облако»/«Диск»:
// бэкенд даёт дерево ресурсов и байты, обработчик отвечает за протокол
// (RFC 4918): методы, XML `multistatus`, заголовки, блокировки и коды ответов.
// `GET`/`HEAD` отдаются через `createFileResponse` из `@remix-run/response/file`
// (тот же пакет, что использует клиентский драйвер `@remix-run/lazy-file`),
// поэтому `Range`, `If-Range`, `If-None-Match` и `304`/`412`/`416` совпадают
// с обычной раздачей файлов приложения.

import { createFileResponse } from '@remix-run/response/file'
import {
  davBaseName,
  davHttpDate,
  davIsoDate,
  davParentPath,
  davStatusLine,
  DavPathError,
  encodeDavHref,
  escapeXml,
  isDavPathWithin,
  normalizeDavBasePath,
  parseBasicAuthorization,
  parseDavDepth,
  parseDavDestination,
  parseDavLockTokens,
  parseDavOverwrite,
  pathnameToDavPath,
  timingSafeStringEqual,
  weakEtag,
  type DavDepth,
  type DavFileLike,
  type DavKind,
  type DavResource,
} from './protocol.js'

/** Что бэкенд умеет отдать на `PROPFIND`/`GET`; контракт намеренно узкий. */
export interface DavBackend {
  /** Описание ресурса или `null`; `etag` файла обязан совпадать с `GET` (см. {@link weakEtag}). */
  stat(path: string): Promise<DavResource | null>
  /** Прямые дети коллекции (глубина `1`); порядок задаёт бэкенд. */
  list(path: string): Promise<readonly DavResource[]>
  /** Открыть файл для `GET`/`HEAD`; `null` — файла нет. */
  read(path: string): Promise<DavFileLike | null>
  /** Создать или заменить файл. */
  write(path: string, input: DavWriteInput): Promise<DavResource>
  /** Создать одну коллекцию (родитель уже проверен обработчиком). */
  mkdir(path: string): Promise<DavResource>
  /** Удалить файл или коллекцию со всем содержимым. */
  remove(path: string): Promise<boolean>
  /** Скопировать ресурс; `deep: false` — только саму коллекцию без детей. */
  copy(from: string, to: string, options: DavCopyOptions): Promise<DavWriteOutcome>
  /** Перенести ресурс (для коллекций — вместе с детьми). */
  move(from: string, to: string, options: DavMoveOptions): Promise<DavWriteOutcome>
}

export interface DavWriteInput {
  readonly stream: ReadableStream<Uint8Array>
  readonly size?: number
  readonly contentType: string
  readonly overwrite: boolean
}

export interface DavCopyOptions {
  readonly deep: boolean
  readonly overwrite: boolean
}

export interface DavMoveOptions {
  readonly overwrite: boolean
}

export type DavWriteOutcome = 'created' | 'replaced'

export type DavLockScope = 'exclusive' | 'shared'

/** Блокировка ресурса (`LOCK`). */
export interface DavLock {
  /** Токен в форме `urn:uuid:…` (уходит в `Lock-Token` и `If`). */
  readonly token: string
  readonly path: string
  readonly scope: DavLockScope
  readonly depth: '0' | 'infinity'
  readonly owner?: string
  readonly timeoutSeconds: number
  readonly expiresAt: number
}

export interface DavLockRequest {
  readonly path: string
  readonly scope: DavLockScope
  readonly depth: '0' | 'infinity'
  readonly owner?: string
  readonly timeoutSeconds?: number
}

/**
 * Хранилище блокировок. `memoryDavLockStore()` годится для одного инстанса;
 * приложение с несколькими инстансами подставляет общий стор (БД/кэш).
 */
export interface DavLockStore {
  acquire(input: DavLockRequest): Promise<DavLock>
  refresh(token: string, timeoutSeconds?: number): Promise<DavLock | null>
  release(token: string): Promise<boolean>
  get(token: string): Promise<DavLock | null>
  /** Блокировки, накрывающие путь: сам путь или предок с `Depth: infinity`. */
  covering(path: string): Promise<readonly DavLock[]>
  /** Блокировки внутри пути (для рекурсивных `DELETE`/`MOVE`). */
  within(path: string): Promise<readonly DavLock[]>
}

export interface MemoryDavLockStoreOptions {
  readonly now?: () => number
  readonly defaultTimeoutSeconds?: number
  readonly maxTimeoutSeconds?: number
  readonly tokenFactory?: () => string
}

export const DEFAULT_LOCK_TIMEOUT_SECONDS = 3600
export const MAX_LOCK_TIMEOUT_SECONDS = 7 * 24 * 60 * 60

function normalizeLockTimeout(
  seconds: number | undefined,
  options: { defaultSeconds: number; maxSeconds: number },
): number {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return options.defaultSeconds
  }
  return Math.min(Math.floor(seconds), options.maxSeconds)
}

/** Блокировки в памяти процесса: достаточно одному инстансу и тестам. */
export function memoryDavLockStore(
  options: MemoryDavLockStoreOptions = {},
): DavLockStore {
  const now = options.now ?? Date.now
  const defaultSeconds = options.defaultTimeoutSeconds ?? DEFAULT_LOCK_TIMEOUT_SECONDS
  const maxSeconds = options.maxTimeoutSeconds ?? MAX_LOCK_TIMEOUT_SECONDS
  const tokenFactory = options.tokenFactory ?? (() => `urn:uuid:${crypto.randomUUID()}`)
  const locks = new Map<string, DavLock>()

  const prune = (): void => {
    const timestamp = now()
    for (const [token, lock] of locks) {
      if (lock.expiresAt <= timestamp) locks.delete(token)
    }
  }

  const covering = (path: string, timestamp: number): readonly DavLock[] =>
    [...locks.values()].filter(
      (lock) =>
        lock.expiresAt > timestamp &&
        (lock.path === path || (lock.depth === 'infinity' && isDavPathWithin(path, lock.path))),
    )

  return {
    async acquire(input) {
      prune()
      const timestamp = now()
      const token = tokenFactory()
      const lock: DavLock = {
        token,
        path: input.path,
        scope: input.scope,
        depth: input.depth,
        ...(input.owner !== undefined ? { owner: input.owner } : {}),
        timeoutSeconds: normalizeLockTimeout(input.timeoutSeconds, {
          defaultSeconds,
          maxSeconds,
        }),
        expiresAt: timestamp + normalizeLockTimeout(input.timeoutSeconds, {
          defaultSeconds,
          maxSeconds,
        }) * 1000,
      }
      locks.set(token, lock)
      return lock
    },
    async refresh(token, timeoutSeconds) {
      prune()
      const current = locks.get(token)
      if (!current) return null
      const seconds = normalizeLockTimeout(timeoutSeconds ?? current.timeoutSeconds, {
        defaultSeconds,
        maxSeconds,
      })
      const next: DavLock = {
        ...current,
        timeoutSeconds: seconds,
        expiresAt: now() + seconds * 1000,
      }
      locks.set(token, next)
      return next
    },
    async release(token) {
      prune()
      return locks.delete(token)
    },
    async get(token) {
      prune()
      return locks.get(token) ?? null
    },
    async covering(path) {
      prune()
      return covering(path, now())
    },
    async within(path) {
      prune()
      const timestamp = now()
      return [...locks.values()].filter(
        (lock) => lock.expiresAt > timestamp && isDavPathWithin(lock.path, path),
      )
    },
  }
}

export interface MemoryDavBackendOptions {
  readonly now?: () => number
  /** Потолок одного файла в памяти (по умолчанию 64 МиБ). */
  readonly maxBytes?: number
}

interface MemoryFile {
  readonly bytes: Uint8Array
  readonly contentType: string
  readonly lastModified: number
}

/** Полноценный in-memory бэкенд: тесты, демо, стенд без БД. */
export function memoryDavBackend(options: MemoryDavBackendOptions = {}): DavBackend {
  const now = options.now ?? Date.now
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024
  const files = new Map<string, MemoryFile>()
  const collections = new Set<string>([''])
  const collectionTimes = new Map<string, number>([['', now()]])

  const fileResource = (path: string, file: MemoryFile): DavResource => ({
    path,
    kind: 'file',
    size: file.bytes.byteLength,
    contentType: file.contentType,
    lastModified: file.lastModified,
    etag: weakEtag(file.bytes.byteLength, file.lastModified),
    createdAt: file.lastModified,
  })

  const collectionResource = (path: string): DavResource => ({
    path,
    kind: 'collection',
    lastModified: collectionTimes.get(path) ?? now(),
    createdAt: collectionTimes.get(path) ?? now(),
  })

  const childPaths = (path: string): string[] => {
    const direct = new Map<string, DavKind>()
    for (const filePath of files.keys()) {
      if (davParentPath(filePath) === path) direct.set(filePath, 'file')
    }
    for (const collection of collections) {
      if (collection !== '' && davParentPath(collection) === path) {
        direct.set(collection, 'collection')
      }
    }
    return [...direct.keys()].sort((a, b) => davBaseName(a).localeCompare(davBaseName(b)))
  }

  const readStream = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice())
        controller.close()
      },
    })

  const writeCollectionTree = (from: string, to: string): void => {
    collections.add(to)
    collectionTimes.set(to, now())
    for (const child of childPaths(from)) {
      const target = `${to}/${davBaseName(child)}`
      if (files.has(child)) {
        const file = files.get(child)!
        files.set(target, { ...file })
      } else {
        writeCollectionTree(child, target)
      }
    }
  }

  const outcomeOf = (path: string): DavWriteOutcome =>
    files.has(path) || collections.has(path) ? 'replaced' : 'created'

  return {
    async stat(path) {
      const file = files.get(path)
      if (file) return fileResource(path, file)
      if (collections.has(path)) return collectionResource(path)
      return null
    },

    async list(path) {
      return childPaths(path).map((child) => {
        const file = files.get(child)
        return file ? fileResource(child, file) : collectionResource(child)
      })
    },

    async read(path) {
      const file = files.get(path)
      if (!file) return null
      const { bytes, contentType, lastModified } = file
      const name = davBaseName(path) || 'download'
      return {
        name,
        size: bytes.byteLength,
        type: contentType,
        lastModified,
        stream: () => readStream(bytes),
        arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer,
        slice(start = 0, end = bytes.byteLength) {
          const chunk = bytes.slice(
            Math.max(0, Math.min(start, bytes.byteLength)),
            Math.max(0, Math.min(end, bytes.byteLength)),
          )
          return { stream: () => readStream(chunk) }
        },
      }
    },

    async write(path, input) {
      if (collections.has(path)) {
        throw new Error(`[storage/webdav] «${path}» — коллекция, запись файла запрещена`)
      }
      const bytes = await collectDavStream(input.stream, { maxBytes, size: input.size })
      const lastModified = now()
      files.set(path, {
        bytes,
        contentType: input.contentType || 'application/octet-stream',
        lastModified,
      })
      return fileResource(path, files.get(path)!)
    },

    async mkdir(path) {
      if (files.has(path) || collections.has(path)) {
        throw new Error(`[storage/webdav] «${path}» уже существует`)
      }
      collections.add(path)
      const timestamp = now()
      collectionTimes.set(path, timestamp)
      return collectionResource(path)
    },

    async remove(path) {
      if (files.delete(path)) return true
      if (!collections.has(path)) return false
      const prefix = `${path}/`
      for (const filePath of [...files.keys()]) {
        if (filePath.startsWith(prefix)) files.delete(filePath)
      }
      for (const collection of [...collections]) {
        if (collection === path || collection.startsWith(prefix)) {
          collections.delete(collection)
          collectionTimes.delete(collection)
        }
      }
      return true
    },

    async copy(from, to, copyOptions) {
      const outcome = outcomeOf(to)
      const file = files.get(from)
      if (file) {
        files.set(to, { ...file, lastModified: now() })
        return outcome
      }
      if (!collections.has(from)) {
        throw new Error(`[storage/webdav] источник «${from}» не найден`)
      }
      if (copyOptions.deep) {
        writeCollectionTree(from, to)
      } else {
        collections.add(to)
        collectionTimes.set(to, now())
      }
      return outcome
    },

    async move(from, to, moveOptions) {
      const outcome = outcomeOf(to)
      const file = files.get(from)
      if (file) {
        files.set(to, { ...file, lastModified: now() })
        files.delete(from)
        return outcome
      }
      if (!collections.has(from)) {
        throw new Error(`[storage/webdav] источник «${from}» не найден`)
      }
      writeCollectionTree(from, to)
      if (files.delete(from)) return outcome
      const prefix = `${from}/`
      for (const filePath of [...files.keys()]) {
        if (filePath.startsWith(prefix)) files.delete(filePath)
      }
      for (const collection of [...collections]) {
        if (collection === from || collection.startsWith(prefix)) {
          collections.delete(collection)
          collectionTimes.delete(collection)
        }
      }
      void moveOptions
      return outcome
    },
  }
}

async function collectDavStream(
  stream: ReadableStream<Uint8Array>,
  options: { readonly maxBytes: number; readonly size?: number },
): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > options.maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new RangeError(
          `[storage/webdav] тело превысило лимит ${options.maxBytes} байт`,
        )
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  if (options.size !== undefined && options.size !== total) {
    throw new RangeError(
      `[storage/webdav] тело не совпало с Content-Length: ${total} !== ${options.size}`,
    )
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged
}

export interface WebdavServerOptions {
  readonly backend: DavBackend
  /** Префикс монтирования в URL (`'/dav'`); на href он возвращается. */
  readonly basePath?: string
  readonly realm?: string
  /** `null` — объявлять только Class 1 и отвечать `501` на `LOCK`/`UNLOCK`. */
  readonly locks?: DavLockStore | null
  /** Максимальная поддерживаемая глубина `PROPFIND`: по умолчанию `1`. */
  readonly maxDepth?: 0 | 1 | 'infinity'
  readonly authorize?: (request: Request) => boolean | Promise<boolean>
  readonly now?: () => number
  readonly maxPropfindBodyBytes?: number
  readonly maxLockBodyBytes?: number
}

export interface WebdavServer {
  readonly supportsLocks: boolean
  handle(request: Request): Promise<Response>
}

/** Basic-проверка для `authorize` (пароль приложения, не `seed`). */
export function basicAuthGuard(options: {
  readonly username: string
  readonly password: string
}): (request: Request) => boolean {
  return (request) => {
    const credentials = parseBasicAuthorization(request.headers.get('authorization'))
    if (!credentials) return false
    return (
      timingSafeStringEqual(credentials.username, options.username) &&
      timingSafeStringEqual(credentials.password, options.password)
    )
  }
}

const ALLOW_METHODS = [
  'OPTIONS',
  'PROPFIND',
  'PROPPATCH',
  'GET',
  'HEAD',
  'PUT',
  'DELETE',
  'MKCOL',
  'COPY',
  'MOVE',
] as const

const LOCK_METHODS = ['LOCK', 'UNLOCK'] as const

const XML_DECLARATION = '<?xml version="1.0" encoding="utf-8"?>'

interface RequestedProp {
  readonly namespace: string
  readonly name: string
}

type PropfindMode = 'allprop' | 'propname' | 'prop'

interface PropfindRequest {
  readonly mode: PropfindMode
  readonly props: readonly RequestedProp[]
}

const SUPPORTED_PROPS = new Set([
  'resourcetype',
  'displayname',
  'getcontentlength',
  'getcontenttype',
  'getlastmodified',
  'getetag',
  'creationdate',
  'supportedlock',
  'lockdiscovery',
])

function parsePropfindBody(xml: string): PropfindRequest {
  const source = xml.trim()
  if (!source) return { mode: 'allprop', props: [] }

  const namespaces = new Map<string, string>([['D', 'DAV:'], ['d', 'DAV:']])
  for (const match of source.matchAll(/xmlns(?::([A-Za-z0-9_.-]+))?\s*=\s*"([^"]*)"/g)) {
    namespaces.set(match[1] ?? '', match[2] ?? '')
  }

  if (/<(?:[A-Za-z0-9_.-]+:)?propname\b/i.test(source)) {
    return { mode: 'propname', props: [] }
  }

  const propBlock = /<(?:[A-Za-z0-9_.-]+:)?prop(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?prop\s*>/i.exec(
    source,
  )
  if (!propBlock?.[1]) return { mode: 'allprop', props: [] }

  const props: RequestedProp[] = []
  for (const match of propBlock[1].matchAll(
    /<([A-Za-z0-9_.-]+:)?([A-Za-z0-9_.-]+)(?:\s[^>]*)?\/?>/g,
  )) {
    const prefix = match[1]?.slice(0, -1) ?? ''
    const name = match[2]?.toLowerCase()
    if (!name || name === 'prop') continue
    props.push({ namespace: namespaces.get(prefix) ?? 'DAV:', name })
  }
  return { mode: 'prop', props }
}

function parseProppatchProps(xml: string): readonly RequestedProp[] {
  const props: RequestedProp[] = []
  const namespaces = new Map<string, string>([['D', 'DAV:'], ['d', 'DAV:']])
  for (const match of xml.matchAll(/xmlns(?::([A-Za-z0-9_.-]+))?\s*=\s*"([^"]*)"/g)) {
    namespaces.set(match[1] ?? '', match[2] ?? '')
  }
  for (const match of xml.matchAll(/<([A-Za-z0-9_.-]+:)?([A-Za-z0-9_.-]+)(?:\s[^>]*)?\/?>/g)) {
    const prefix = match[1]?.slice(0, -1) ?? ''
    const name = match[2]?.toLowerCase()
    if (
      !name ||
      ['propertyupdate', 'set', 'remove', 'prop'].includes(name)
    ) {
      continue
    }
    props.push({ namespace: namespaces.get(prefix) ?? 'DAV:', name })
  }
  return props
}

function isDavNamespace(namespace: string): boolean {
  return namespace === 'DAV:' || namespace === 'DAV'
}

function renderPropValue(
  name: string,
  resource: DavResource,
  locks: readonly DavLock[],
): string | null {
  switch (name) {
    case 'resourcetype':
      return resource.kind === 'collection' ? '<D:resourcetype><D:collection/></D:resourcetype>' : '<D:resourcetype/>'
    case 'displayname':
      return `<D:displayname>${escapeXml(resource.displayName ?? (davBaseName(resource.path) || '/'))}</D:displayname>`
    case 'getcontentlength':
      return resource.kind === 'file'
        ? `<D:getcontentlength>${resource.size ?? 0}</D:getcontentlength>`
        : null
    case 'getcontenttype':
      return resource.kind === 'file'
        ? `<D:getcontenttype>${escapeXml(resource.contentType ?? 'application/octet-stream')}</D:getcontenttype>`
        : null
    case 'getlastmodified':
      return `<D:getlastmodified>${davHttpDate(resource.lastModified ?? 0)}</D:getlastmodified>`
    case 'getetag':
      return resource.kind === 'file'
        ? `<D:getetag>${escapeXml(resource.etag ?? '')}</D:getetag>`
        : null
    case 'creationdate':
      return `<D:creationdate>${davIsoDate(resource.createdAt ?? resource.lastModified ?? 0)}</D:creationdate>`
    case 'supportedlock':
      return (
        '<D:supportedlock>' +
        '<D:lockentry><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockentry>' +
        '<D:lockentry><D:lockscope><D:shared/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockentry>' +
        '</D:supportedlock>'
      )
    case 'lockdiscovery':
      return `<D:lockdiscovery>${locks.map(renderActiveLock).join('')}</D:lockdiscovery>`
    default:
      return null
  }
}

function renderActiveLock(lock: DavLock): string {
  return (
    '<D:activelock>' +
    `<D:locktype><D:write/></D:locktype>` +
    `<D:lockscope>${lock.scope === 'exclusive' ? '<D:exclusive/>' : '<D:shared/>'}</D:lockscope>` +
    `<D:depth>${lock.depth}</D:depth>` +
    (lock.owner ? `<D:owner>${escapeXml(lock.owner)}</D:owner>` : '') +
    `<D:timeout>Second-${lock.timeoutSeconds}</D:timeout>` +
    `<D:locktoken><D:href>${escapeXml(lock.token)}</D:href></D:locktoken>` +
    `<D:lockroot><D:href>${escapeXml(lock.path === '' ? '/' : `/${lock.path}`)}</D:href></D:lockroot>` +
    '</D:activelock>'
  )
}

function renderPropstat(props: readonly string[], status: number): string {
  if (props.length === 0) return ''
  return (
    '<D:propstat><D:prop>' +
    props.join('') +
    `</D:prop><D:status>${davStatusLine(status)}</D:status></D:propstat>`
  )
}

interface DavHrefOptions {
  readonly basePath: string
}

function renderDavResponse(
  resource: DavResource,
  locks: readonly DavLock[],
  request: PropfindRequest,
  options: DavHrefOptions,
): string {
  const wanted: readonly string[] =
    request.mode === 'prop'
      ? request.props.filter((prop) => isDavNamespace(prop.namespace)).map((prop) => prop.name)
      : [...SUPPORTED_PROPS]

  const ok: string[] = []
  const missing: string[] = []
  for (const name of wanted) {
    if (!SUPPORTED_PROPS.has(name)) {
      missing.push(`<D:${name}/>`)
      continue
    }
    if (request.mode === 'propname') {
      ok.push(`<D:${name}/>`)
      continue
    }
    const value = renderPropValue(name, resource, locks)
    if (value === null) {
      if (request.mode === 'prop') missing.push(`<D:${name}/>`)
      continue
    }
    ok.push(value)
  }

  // Неподдерживаемые (не-DAV) свойства из тела запроса тоже попадают в 404.
  if (request.mode === 'prop') {
    for (const prop of request.props) {
      if (!isDavNamespace(prop.namespace)) {
        missing.push(`<X:${prop.name || 'prop'}/>`)
      }
    }
  }

  return (
    '<D:response>' +
    `<D:href>${escapeXml(encodeDavHref(resource.path, resource.kind, options.basePath))}</D:href>` +
    renderPropstat(ok, 200) +
    renderPropstat(missing, 404) +
    '</D:response>'
  )
}

function renderMultistatus(responses: readonly string[]): string {
  return `${XML_DECLARATION}\n<D:multistatus xmlns:D="DAV:" xmlns:X="urn:modals-kit:unsupported">${responses.join('')}</D:multistatus>`
}

function xmlResponse(body: string, status = 207, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/xml; charset=utf-8', ...headers },
  })
}

function err(status: number, message: string, headers: Record<string, string> = {}): Response {
  return new Response(message, { status, headers })
}

function parseDavTimeout(
  header: string | null,
  options: { readonly defaultSeconds: number; readonly maxSeconds: number },
): number {
  if (!header) return options.defaultSeconds
  const match = /Second-(\d+)/i.exec(header)
  if (!match?.[1]) {
    return /Infinite/i.test(header) ? options.maxSeconds : options.defaultSeconds
  }
  const seconds = Number.parseInt(match[1], 10)
  if (!Number.isFinite(seconds) || seconds <= 0) return options.defaultSeconds
  return Math.min(seconds, options.maxSeconds)
}

function parseLockInfo(body: string): {
  readonly scope: DavLockScope
  readonly owner?: string
} | null {
  if (!body.trim()) return null
  if (!/<(?:[A-Za-z0-9_.-]+:)?lockinfo\b/i.test(body)) return null
  const scope: DavLockScope = /<(?:[A-Za-z0-9_.-]+:)?shared\b/i.test(body)
    ? 'shared'
    : 'exclusive'
  const ownerMatch =
    /<(?:[A-Za-z0-9_.-]+:)?owner(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?owner\s*>/i.exec(
      body,
    )
  const owner = ownerMatch?.[1]
    ? ownerMatch[1]
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : ''
  return { scope, ...(owner ? { owner } : {}) }
}

function firstOutcome(outcome: DavWriteOutcome): number {
  return outcome === 'created' ? 201 : 204
}

/**
 * Создать WebDAV-обработчик. Он не привязан к маршруту: приложение вызывает
 * `handle(request)` из `+server.ts` и подставляет свой `DavBackend`.
 */
export function createWebdavServer(options: WebdavServerOptions): WebdavServer {
  const backend = options.backend
  const basePath = normalizeDavBasePath(options.basePath)
  const realm = options.realm ?? 'webdav'
  const locks = options.locks === undefined ? memoryDavLockStore() : options.locks
  const supportsLocks = locks !== null
  const maxDepth = options.maxDepth ?? 1
  const maxPropfindBodyBytes = options.maxPropfindBodyBytes ?? 1024 * 1024
  const maxLockBodyBytes = options.maxLockBodyBytes ?? 64 * 1024
  const allow = [...ALLOW_METHODS, ...(supportsLocks ? LOCK_METHODS : [])]
  const davClass = supportsLocks ? '1, 2' : '1'

  const lockState = async (target: string): Promise<readonly DavLock[]> =>
    locks ? await locks.covering(target) : []

  const lockedResponse = async (request: Request, target: string, recursive = false): Promise<Response | null> => {
    if (!locks) return null
    const tokens = parseDavLockTokens(request.headers)
    const covering = await locks.covering(target)
    const within = recursive ? await locks.within(target) : []
    const blocking = [...covering, ...within].filter((lock) => !tokens.includes(lock.token))
    return blocking.length > 0 ? err(423, 'Locked') : null
  }

  const requireParentCollection = async (target: string): Promise<Response | null> => {
    if (target === '') return null
    const parent = await backend.stat(davParentPath(target))
    if (!parent || parent.kind !== 'collection') {
      return err(409, 'Conflict: parent collection does not exist')
    }
    return null
  }

  const propfind = async (request: Request, target: string): Promise<Response> => {
    const raw = await readBoundedText(request, maxPropfindBodyBytes)
    const parsed = parsePropfindBody(raw)
    const depth = parseDavDepth(request.headers.get('depth'), '1')
    if (depth === null) return err(400, 'Bad Request: invalid Depth')
    if (depth === 'infinity' && maxDepth !== 'infinity') {
      return err(403, 'Forbidden: infinite Depth is not supported')
    }

    const resource = await backend.stat(target)
    if (!resource) return err(404, 'Not Found')

    const responses: string[] = [
      renderDavResponse(resource, await lockState(resource.path), parsed, { basePath }),
    ]
    if (resource.kind === 'collection' && depth !== '0') {
      const children = await backend.list(resource.path)
      for (const child of children) {
        responses.push(
          renderDavResponse(child, await lockState(child.path), parsed, { basePath }),
        )
      }
      if (depth === 'infinity') {
        const walk = async (prefix: string): Promise<void> => {
          for (const child of await backend.list(prefix)) {
            responses.push(
              renderDavResponse(child, await lockState(child.path), parsed, { basePath }),
            )
            if (child.kind === 'collection') await walk(child.path)
          }
        }
        for (const child of children) {
          if (child.kind === 'collection') await walk(child.path)
        }
      }
    }
    return xmlResponse(renderMultistatus(responses))
  }

  const getFile = async (request: Request, target: string, head: boolean): Promise<Response> => {
    const file = await backend.read(target)
    if (!file) return err(404, 'Not Found')
    const probe = await createFileResponse(
      file,
      head ? new Request(request.url, { method: 'GET', headers: request.headers }) : request,
      { etag: 'weak', acceptRanges: true },
    )
    if (!head) return probe
    return new Response(null, { status: probe.status, headers: probe.headers })
  }

  const put = async (request: Request, target: string): Promise<Response> => {
    if (target === '') return err(405, 'Method Not Allowed')
    const conflict = await requireParentCollection(target)
    if (conflict) return conflict
    const existing = await backend.stat(target)
    if (existing?.kind === 'collection') return err(405, 'Method Not Allowed')
    const locked = await lockedResponse(request, target)
    if (locked) return locked

    const lengthHeader = request.headers.get('content-length')
    const size =
      lengthHeader !== null && /^\d+$/.test(lengthHeader.trim())
        ? Number(lengthHeader)
        : undefined
    const stream =
      request.body ??
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close()
        },
      })
    const resource = await backend.write(target, {
      stream,
      ...(size !== undefined ? { size } : {}),
      contentType: request.headers.get('content-type') ?? 'application/octet-stream',
      overwrite: existing !== null,
    })
    const status = existing ? 204 : 201
    const headers: Record<string, string> = {}
    if (resource.etag) headers.etag = resource.etag
    return new Response(null, { status, headers })
  }

  const del = async (request: Request, target: string): Promise<Response> => {
    if (target === '') return err(403, 'Forbidden: cannot delete the mount root')
    const locked = await lockedResponse(request, target, true)
    if (locked) return locked
    const removed = await backend.remove(target)
    return removed ? new Response(null, { status: 204 }) : err(404, 'Not Found')
  }

  const mkcol = async (request: Request, target: string): Promise<Response> => {
    if (target === '') return err(405, 'Method Not Allowed')
    const body = await request.arrayBuffer()
    if (body.byteLength > 0) return err(415, 'Unsupported Media Type')
    const existing = await backend.stat(target)
    if (existing) return err(405, 'Method Not Allowed')
    const conflict = await requireParentCollection(target)
    if (conflict) return conflict
    const locked = await lockedResponse(request, target)
    if (locked) return locked
    await backend.mkdir(target)
    return new Response(null, { status: 201 })
  }

  const transfer = async (
    request: Request,
    from: string,
    to: string,
    move: boolean,
  ): Promise<Response> => {
    if (from === '') return err(403, 'Forbidden: cannot move the mount root')
    if (from === to) return err(403, 'Forbidden: source and destination are the same')
    if (move && isDavPathWithin(to, from)) {
      return err(409, 'Conflict: cannot move a collection into itself')
    }
    const source = await backend.stat(from)
    if (!source) return err(404, 'Not Found')
    const conflict = await requireParentCollection(to)
    if (conflict) return conflict
    const destination = await backend.stat(to)
    const overwrite = parseDavOverwrite(request.headers.get('overwrite'))
    if (destination && !overwrite) return err(412, 'Precondition Failed')
    const lockedSource = await lockedResponse(request, from, true)
    if (lockedSource) return lockedSource
    const lockedDestination = await lockedResponse(request, to, true)
    if (lockedDestination) return lockedDestination

    let deep = true
    if (!move && source.kind === 'collection') {
      const depth = parseDavDepth(request.headers.get('depth'), 'infinity')
      if (depth === null || depth === '1') return err(400, 'Bad Request: invalid Depth')
      deep = depth === 'infinity'
    }
    const outcome = move
      ? await backend.move(from, to, { overwrite })
      : await backend.copy(from, to, { deep, overwrite })
    return new Response(null, { status: firstOutcome(outcome) })
  }

  const lock = async (request: Request, target: string): Promise<Response> => {
    if (!locks) return err(501, 'Not Implemented')
    const body = await readBoundedText(request, maxLockBodyBytes)
    const info = parseLockInfo(body)
    const now = options.now?.() ?? Date.now()

    if (!info) {
      const token = parseDavLockTokens(request.headers)[0]
      if (!token) return err(400, 'Bad Request: lockinfo body or If header required')
      const existing = await locks.get(token)
      if (!existing) return err(412, 'Precondition Failed')
      const refreshed = await locks.refresh(token)
      if (!refreshed) return err(412, 'Precondition Failed')
      return xmlResponse(
        `${XML_DECLARATION}\n<D:prop xmlns:D="DAV:"><D:lockdiscovery>${renderActiveLock(refreshed)}</D:lockdiscovery></D:prop>`,
        200,
      )
    }

    const resource = await backend.stat(target)
    if (!resource) return err(404, 'Not Found')
    const timeoutSeconds = parseDavTimeout(request.headers.get('timeout'), {
      defaultSeconds: DEFAULT_LOCK_TIMEOUT_SECONDS,
      maxSeconds: MAX_LOCK_TIMEOUT_SECONDS,
    })
    const depthHeader = parseDavDepth(request.headers.get('depth'), 'infinity')
    if (depthHeader === null || depthHeader === '1') return err(400, 'Bad Request: invalid Depth')
    const depth = depthHeader === '0' ? '0' : 'infinity'

    const covering = (await locks.covering(target)).filter((item) => item.expiresAt > now)
    const hasExclusive = covering.some((item) => item.scope === 'exclusive')
    if (covering.length > 0 && (hasExclusive || info.scope === 'exclusive')) {
      return err(423, 'Locked')
    }

    const created = await locks.acquire({
      path: target,
      scope: info.scope,
      depth,
      ...(info.owner ? { owner: info.owner } : {}),
      timeoutSeconds,
    })
    return xmlResponse(
      `${XML_DECLARATION}\n<D:prop xmlns:D="DAV:"><D:lockdiscovery>${renderActiveLock(created)}</D:lockdiscovery></D:prop>`,
      201,
      { 'lock-token': `<${created.token}>` },
    )
  }

  const unlock = async (request: Request, target: string): Promise<Response> => {
    if (!locks) return err(501, 'Not Implemented')
    const token = parseDavLockTokens(request.headers)[0]
    if (!token) return err(400, 'Bad Request: Lock-Token header required')
    const existing = await locks.get(token)
    if (!existing || existing.path !== target) return err(409, 'Conflict')
    await locks.release(token)
    return new Response(null, { status: 204 })
  }

  const proppatch = async (request: Request, target: string): Promise<Response> => {
    const resource = await backend.stat(target)
    if (!resource) return err(404, 'Not Found')
    const locked = await lockedResponse(request, target)
    if (locked) return locked
    const body = await readBoundedText(request, maxPropfindBodyBytes)
    const props = parseProppatchProps(body)
    // Мёртвые свойства не хранятся: честно отвечаем 403 в propstat, а не 200.
    const failed = props.map((prop) => `<D:${prop.name}/>`)
    return xmlResponse(
      renderMultistatus([
        '<D:response>' +
          `<D:href>${escapeXml(encodeDavHref(resource.path, resource.kind, basePath))}</D:href>` +
          (failed.length > 0 ? renderPropstat(failed, 403) : renderPropstat([], 200)) +
          '</D:response>',
      ]),
    )
  }

  const dispatch = async (request: Request): Promise<Response> => {
    if (options.authorize) {
      const allowed = await options.authorize(request)
      if (!allowed) {
        return err(401, 'Unauthorized', {
          'www-authenticate': `Basic realm="${realm}", charset="UTF-8"`,
        })
      }
    }

    const target = pathnameToDavPath(new URL(request.url).pathname, basePath)
    switch (request.method.toUpperCase()) {
      case 'OPTIONS':
        return new Response(null, {
          status: 200,
          headers: {
            allow: allow.join(', '),
            dav: davClass,
            'ms-author-via': 'DAV',
          },
        })
      case 'PROPFIND':
        return propfind(request, target)
      case 'PROPPATCH':
        return proppatch(request, target)
      case 'GET':
        return getFile(request, target, false)
      case 'HEAD':
        return getFile(request, target, true)
      case 'PUT':
        return put(request, target)
      case 'DELETE':
        return del(request, target)
      case 'MKCOL':
        return mkcol(request, target)
      case 'COPY': {
        const destination = parseDavDestination(request, basePath)
        return transfer(request, target, destination, false)
      }
      case 'MOVE': {
        const destination = parseDavDestination(request, basePath)
        return transfer(request, target, destination, true)
      }
      case 'LOCK':
        return lock(request, target)
      case 'UNLOCK':
        return unlock(request, target)
      default:
        return err(405, 'Method Not Allowed', { allow: allow.join(', ') })
    }
  }

  return {
    supportsLocks,
    async handle(request) {
      try {
        return await dispatch(request)
      } catch (error) {
        if (error instanceof DavPathError) return err(400, error.message)
        console.error('[storage/webdav] ошибка обработчика:', error)
        return err(500, 'Internal Server Error')
      }
    },
  }
}

async function readBoundedText(request: Request, maxBytes: number): Promise<string> {
  if (!request.body) return ''
  const reader = request.body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let text = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new DavPathError(`тело запроса превысило лимит ${maxBytes} байт`)
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
  } finally {
    reader.releaseLock()
  }
  return text
}
