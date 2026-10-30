/**
 * Боевой пул серверов хранилища приложения (`STORAGE_ACL`, `public.storage_server`).
 *
 * Отделён от демо-песочницы `/upload-demo` (`CookieVault` + `jsonLedger`):
 * - конфигурация серверов S3 / WebDAV хранится в БД (`storage_server`), а их
 *   секреты (`url`, `encryptionKey`) запечатаны `AUTH_SEAL_SECRET` (`iron-webcrypto`,
 *   ротация через `AUTH_SEAL_OLD_KEYS`);
 * - реестр логических файлов и броней — `pgStorageLedger(db, { scope: 'app' })`,
 *   общий кэш/семафоры — `cacheStorageStore(sharedStore)`;
 * - в dev / локальном окружении при отсутствии пишущих серверов в БД автоматически
 *   включается локальная папка `data/storage` (`local_dev`), на облачном деплое
 *   при пустом пуле запись отдаёт машинный код `storage.pool-empty`;
 * - перед сохранением сервера выполняется живая проверка `probeStorageVaultEntry`.
 */
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { AUTH_SEAL_ID, AUTH_SEAL_OLD_KEYS, AUTH_SEAL_SECRET } from '$app/env/private'
import * as Iron from 'iron-webcrypto'
import type { StorageServerMeta, StorageServerView, StorageServersSlice } from '#content/storage-servers/types.js'
import type { StorageVaultEntry } from '#content/storage-vault/schema.js'
import {
  probeStorageVaultEntry,
  validateStorageTargetUrl,
} from '#content/storage-vault/vault.form.server.js'
import type { AuthFact } from '#content/user/error.js'
import type { UserResult } from '#content/user/auth.js'
import { pgStore } from '#hooks/cache-db.js'
import { VAULT_SLOT_ID_RE } from '#hooks/cookie-vault/index.js'
import { cacheStorageStore, pgStorageLedger, storageServer } from '#hooks/storage-db.js'
import { checkGrants, grants, type Database, type DataContext } from '#lib/db/index.js'
import {
  createStorage,
  type Storage,
  type StorageServerEntry,
} from '#lib/storage/index.js'
import { localDriver, localSpool } from '#lib/storage/local.js'
import { maskS3Url, parseS3Url, s3Driver } from '#lib/storage/s3.js'
import { isWebdavDsn, maskWebdavUrl, parseWebdavUrl, webdavDriver } from '#lib/storage/webdav.js'
import { localStore, sharedStore } from './cache.server.js'
import { db as defaultDb } from './db.server.js'
import { createSafeStorageFetch } from './safe-storage-fetch.server.js'

const MB = 1024 * 1024
const MAX_SEALED_CONFIG_CHARS = 16_384
const POOL_CACHE_KEY = 'pool.v1'
const POOL_CACHE_TTL_MS = 10_000
const SYSTEM: DataContext = { principal: { roles: ['server'] } }

export const APP_STORAGE_URL_PREFIX = '/api/storage'
export const DEV_LOCAL_SLOT = 'local_dev'
export const DEV_STORAGE_DIR = resolve('data/storage')
const APP_SPOOL_DIR = join(tmpdir(), 'modals-kit-app-spool')

const RESERVED_SLOTS = new Set([
  'auto',
  'local',
  'local_dev',
  'memory',
  'shard_a',
  'shard_b',
  'split_demo',
])

const gStorageServer = grants(storageServer)
const defaultPoolCache = sharedStore.scope('app-storage-pool')
const sharedAppSpool = localSpool(APP_SPOOL_DIR)

function resolvePoolCache(database?: Database) {
  return database ? pgStore(database).scope('app-storage-pool') : defaultPoolCache
}

export interface SealKeysConfig {
  readonly id: string
  readonly secret: string
  readonly old: Readonly<Record<string, string>>
  readonly enabled: boolean
}

export interface StorageActor {
  readonly id: string
  readonly permissions: readonly string[]
}

export interface AppStorageDeps {
  readonly db?: Database
  readonly sealKeys?: SealKeysConfig
  readonly isCloud?: boolean
  readonly devRootDir?: string
  readonly fetchImpl?: typeof fetch
}

function defaultSealKeys(): SealKeysConfig {
  const id = AUTH_SEAL_ID || 'k1'
  const secret = AUTH_SEAL_SECRET || ''
  const old: Record<string, string> = {}
  const raw = AUTH_SEAL_OLD_KEYS || ''
  if (raw) {
    for (const pair of raw.split(',')) {
      const idx = pair.indexOf(':')
      if (idx > 0) {
        const kid = pair.slice(0, idx).trim()
        const keyVal = pair.slice(idx + 1).trim()
        if (kid && keyVal.length >= 32) old[kid] = keyVal
      }
    }
  }
  return { id, secret, old, enabled: secret.length >= 32 }
}

function isCloudRuntime(override?: boolean): boolean {
  if (override !== undefined) return override
  return process.env.VERCEL === '1' || Boolean(process.env.CF_PAGES)
}

function ok<T>(value: T): UserResult<T> {
  return { ok: true, value }
}

function fail<T = never>(fact: AuthFact): UserResult<T> {
  return { ok: false, fact }
}

function toPrincipal(actor: StorageActor) {
  return { id: actor.id, roles: [...actor.permissions] }
}

async function sealServerConfig(entry: StorageVaultEntry, keys: SealKeysConfig): Promise<string> {
  if (!keys.enabled) {
    throw new Error('AUTH_SEAL_SECRET не задан')
  }
  return Iron.seal(entry, { id: keys.id, secret: keys.secret }, { ...Iron.defaults, ttl: 0 })
}

async function unsealServerConfig(
  sealed: string,
  keys: SealKeysConfig,
): Promise<StorageVaultEntry | null> {
  if (!keys.enabled || !sealed || sealed.length > MAX_SEALED_CONFIG_CHARS) return null
  try {
    const map: Record<string, string> = {
      default: keys.secret,
      ...keys.old,
      [keys.id]: keys.secret,
    }
    return (await Iron.unseal(sealed, map, { ...Iron.defaults, ttl: 0 })) as StorageVaultEntry
  } catch {
    return null
  }
}

function buildMeta(entry: StorageVaultEntry): StorageServerMeta {
  const webdav = isWebdavDsn(entry.url)
  let summary = webdav ? 'webdav://***' : 's3://***'
  try {
    summary = webdav ? maskWebdavUrl(entry.url) : maskS3Url(entry.url)
  } catch {
    summary = webdav ? 'webdav://***' : 's3://***'
  }
  return {
    summary,
    protocol: webdav ? 'webdav' : 's3',
    storageMb: entry.storageMb,
    fileMb: entry.fileMb,
    readOnly: entry.readOnly,
    allowSplit: entry.allowSplit !== false,
    encrypted: Boolean(entry.encryptionKey),
  }
}

function ms(val: unknown): number {
  if (typeof val === 'number') return val
  if (val instanceof Date) return val.getTime()
  if (typeof val === 'string') {
    const t = Date.parse(val)
    if (Number.isFinite(t)) return t
  }
  return Date.now()
}

function mapViewRow(raw: Record<string, unknown>): StorageServerView {
  const rawMeta = (raw.meta ?? {}) as Partial<StorageServerMeta>
  return {
    id: String(raw.id),
    slot: String(raw.slot),
    priority: typeof raw.priority === 'number' ? raw.priority : Number(raw.priority ?? 100),
    meta: {
      summary: String(rawMeta.summary ?? '***'),
      protocol: rawMeta.protocol === 'webdav' ? 'webdav' : 's3',
      storageMb: Number(rawMeta.storageMb ?? 1024),
      fileMb: Number(rawMeta.fileMb ?? 64),
      readOnly: Boolean(rawMeta.readOnly),
      allowSplit: rawMeta.allowSplit !== false,
      encrypted: Boolean(rawMeta.encrypted),
    },
    createdAt: ms(raw.created_at),
    updatedAt: ms(raw.updated_at),
  }
}

interface RawPoolRow {
  readonly id: string
  readonly slot: string
  readonly priority: number
  readonly sealed_config: string
  readonly meta: StorageServerMeta
}

async function loadRawPoolRows(database: Database, useCache: boolean): Promise<RawPoolRow[]> {
  const poolCache = resolvePoolCache(database === defaultDb ? undefined : database)
  if (useCache) {
    const cached = await poolCache.get<RawPoolRow[]>(POOL_CACHE_KEY)
    if (cached) return cached
  }
  const rows = (await database.resource(storageServer).select(SYSTEM, {
    order: [
      ['priority', 'asc'],
      ['slot', 'asc'],
    ],
  })) as unknown as Record<string, unknown>[]
  const mapped: RawPoolRow[] = rows.map((r) => ({
    id: String(r.id),
    slot: String(r.slot),
    priority: typeof r.priority === 'number' ? r.priority : Number(r.priority ?? 100),
    sealed_config: String(r.sealed_config ?? ''),
    meta: mapViewRow(r).meta,
  }))
  if (useCache) {
    await poolCache.set(POOL_CACHE_KEY, mapped, POOL_CACHE_TTL_MS)
  }
  return mapped
}

export async function invalidateAppStoragePoolCache(database?: Database): Promise<void> {
  await resolvePoolCache(database).delete(POOL_CACHE_KEY)
}

export interface ResolvedAppStorage {
  readonly storage: Storage | null
  readonly writable: boolean
  readonly activeMode: 'pool' | 'dev_local' | 'empty'
}

/**
 * Собрать боевой экземпляр `Storage` приложения из серверов БД + dev-фолбэка `data/storage`.
 */
export async function resolveAppStorage(deps: AppStorageDeps = {}): Promise<ResolvedAppStorage> {
  const database = deps.db ?? defaultDb
  const keys = deps.sealKeys ?? defaultSealKeys()
  const cloud = isCloudRuntime(deps.isCloud)
  const useDefaultCache = deps.db === undefined && deps.sealKeys === undefined

  const rows = await loadRawPoolRows(database, useDefaultCache)
  const servers: Record<string, StorageServerEntry> = {}
  const writePool: string[] = []
  const safeFetch = deps.fetchImpl ?? createSafeStorageFetch({ allowLocalNetwork: !cloud })

  for (const row of rows) {
    const entry = await unsealServerConfig(row.sealed_config, keys)
    if (!entry) continue
    if (!validateStorageTargetUrl(entry.url, { allowLocalNetwork: !cloud }).ok) continue
    const driver = isWebdavDsn(entry.url)
      ? webdavDriver(entry.url, {
          readOnly: entry.readOnly,
          publicBaseUrl: APP_STORAGE_URL_PREFIX,
          fetchImpl: safeFetch,
        })
      : s3Driver(entry.url, {
          publicBaseUrl: APP_STORAGE_URL_PREFIX,
          fetchImpl: safeFetch,
        })
    servers[row.slot] = {
      driver,
      statTtlMs: 30_000,
      limits: {
        storageBytes: entry.storageMb * MB,
        fileBytes: entry.fileMb * MB,
      },
      readOnly: entry.readOnly,
      allowSplit: entry.allowSplit !== false,
      ...(entry.encryptionKey ? { key: entry.encryptionKey } : {}),
    }
    if (!entry.readOnly) {
      writePool.push(row.slot)
    }
  }

  if (!cloud) {
    servers[DEV_LOCAL_SLOT] = {
      driver: localDriver({
        rootDir: deps.devRootDir ?? DEV_STORAGE_DIR,
        publicBaseUrl: APP_STORAGE_URL_PREFIX,
      }),
      statTtlMs: 30_000,
      limits: {
        storageBytes: 4 * 1024 * MB,
        fileBytes: 256 * MB,
      },
    }
  }

  let activeMode: 'pool' | 'dev_local' | 'empty'
  let effectiveWritePool: string[]
  if (writePool.length > 0) {
    activeMode = 'pool'
    effectiveWritePool = writePool
  } else if (!cloud) {
    activeMode = 'dev_local'
    effectiveWritePool = [DEV_LOCAL_SLOT]
  } else {
    activeMode = 'empty'
    effectiveWritePool = []
  }

  const serverKeys = Object.keys(servers)
  if (serverKeys.length === 0) {
    return { storage: null, writable: false, activeMode: 'empty' }
  }

  const defaultServer = effectiveWritePool[0] ?? serverKeys[0]!
  const ledger = pgStorageLedger(database, { scope: 'app' })
  const store = useDefaultCache
    ? cacheStorageStore(sharedStore.scope('app-storage'))
    : cacheStorageStore(localStore.scope('app-storage-isolated'))

  const storage = createStorage({
    defaultServer,
    writePool: effectiveWritePool,
    writeStrategy: 'priority',
    cooldownMs: 15_000,
    ledger,
    spool: sharedAppSpool,
    store,
    servers,
  })

  return {
    storage,
    writable: effectiveWritePool.length > 0,
    activeMode,
  }
}

const SAFE_INLINE_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
])

const SERVE_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'content-security-policy':
    "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
}

function withStorageSecurityHeaders(res: Response): Response {
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(SERVE_SECURITY_HEADERS)) {
    headers.set(k, v)
  }
  const ct = (headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
  if (ct && !SAFE_INLINE_IMAGE_MIME.has(ct) && res.status >= 200 && res.status < 300) {
    const disp = headers.get('content-disposition') ?? ''
    if (!/^attachment\b/i.test(disp)) {
      headers.set('content-disposition', 'attachment')
    }
  }
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  })
}

/**
 * Безопасная HTTP-раздача объекта из боевого пула (`/api/storage/[...path]`):
 * - некорректные пути (`..`, `\`, завершающий `/`, `.storage-*`) возвращают `404` вместо `500`;
 * - все ответы несут `X-Content-Type-Options: nosniff` и изолирующий `Content-Security-Policy: sandbox`;
 * - активные типы вне белого списка растровых картинок принудительно отдаются как `attachment`.
 */
export async function serveAppStoragePath(
  path: string,
  request: Request,
  deps?: AppStorageDeps,
): Promise<Response> {
  const resolved = await resolveAppStorage(deps)
  if (!resolved.storage) {
    return new Response('Not Found', { status: 404, headers: SERVE_SECURITY_HEADERS })
  }
  try {
    const res = await resolved.storage.serve(path, request, {
      cacheControl: 'public, max-age=31536000, immutable',
      etag: 'strong',
    })
    return withStorageSecurityHeaders(res)
  } catch (err) {
    if (err instanceof RangeError || err instanceof TypeError) {
      return new Response('Not Found', { status: 404, headers: SERVE_SECURITY_HEADERS })
    }
    throw err
  }
}

const MANAGED_AVATAR_URL_RE = /^\/api\/storage\/(avatars\/[0-9a-f-]{36}\/[A-Za-z0-9._-]+)$/i

/** Извлечь логический путь файла в боевом хранилище из публичного `avatarUrl`. */
export function extractManagedAvatarPath(avatarUrl: string | null | undefined): string | null {
  if (!avatarUrl) return null
  const m = MANAGED_AVATAR_URL_RE.exec(avatarUrl.trim())
  return m ? m[1]! : null
}

function extOfMime(mime: string): string {
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  return 'jpg'
}

async function sha256HexPrefix(bytes: Uint8Array, hexChars = 16): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, hexChars)
}

/**
 * Сохранить готовый проверенный аватар пользователя в боевое хранилище под
 * уникальным неизменяемым путём `avatars/<uid>/<hash>-<nonce>.<ext>`.
 */
export async function saveManagedAvatar(
  targetUid: string,
  file: File,
  deps: AppStorageDeps = {},
): Promise<UserResult<{ path: string; url: string }>> {
  const resolved = await resolveAppStorage(deps)
  if (!resolved.storage || !resolved.writable) {
    return fail({ code: 'storage.pool-empty' })
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const hash = await sha256HexPrefix(bytes, 16)
    const nonce = crypto.randomUUID().slice(0, 8)
    const ext = extOfMime(file.type)
    const path = `avatars/${targetUid}/${hash}-${nonce}.${ext}`
    const stored = await resolved.storage.put({
      path,
      body: bytes,
      contentType: file.type || 'image/jpeg',
      size: bytes.byteLength,
      server: 'auto',
    })
    return ok({
      path: stored.path,
      url: stored.url ?? `${APP_STORAGE_URL_PREFIX}/${stored.path}`,
    })
  } catch {
    return fail({ code: 'storage.unavailable' })
  }
}

/**
 * Немедленно физически удалить прежний аватар из боевого хранилища (best-effort).
 * Игнорирует внешние `https://`-ссылки и старые `data:image/...` строки.
 */
export async function removeManagedAvatarByUrl(
  avatarUrl: string | null | undefined,
  deps: AppStorageDeps = {},
): Promise<boolean> {
  const path = extractManagedAvatarPath(avatarUrl)
  if (!path) return false
  try {
    const resolved = await resolveAppStorage(deps)
    if (!resolved.storage) return false
    return await resolved.storage.del(path)
  } catch {
    return false
  }
}

/* ── Управление пулом серверов (`STORAGE_ACL`) ─────────────────────── */

export async function listStorageServers(
  actor: StorageActor,
  deps: AppStorageDeps = {},
): Promise<UserResult<StorageServersSlice>> {
  const principal = toPrincipal(actor)
  const caps = checkGrants(principal, {
    canRead: gStorageServer.select,
    canEdit: gStorageServer.insert,
  })
  if (!caps.canRead) return fail({ code: 'auth.forbidden' })

  const database = deps.db ?? defaultDb
  const cloud = isCloudRuntime(deps.isCloud)
  const ctx: DataContext = { principal }
  const rows = (await database.resource(storageServer).select(ctx, {
    order: [
      ['priority', 'asc'],
      ['slot', 'asc'],
    ],
  })) as unknown as Record<string, unknown>[]

  const items = rows.map(mapViewRow)
  const hasWritable = items.some((i) => !i.meta.readOnly)
  const activeMode: 'pool' | 'dev_local' | 'empty' = hasWritable
    ? 'pool'
    : !cloud
      ? 'dev_local'
      : 'empty'

  return ok({
    items,
    activeMode,
    hasDevFallback: !cloud,
    canEdit: caps.canEdit,
  })
}

export interface SaveStorageServerInput {
  readonly id?: string | null
  readonly slot: string
  /** Пустая строка при обновлении существующего сервера сохраняет прежний `url`. */
  readonly url?: string
  /** Пустая строка при обновлении сохраняет прежний `encryptionKey` (если не выставлен `clearEncryptionKey`). */
  readonly encryptionKey?: string
  readonly clearEncryptionKey?: boolean
  readonly storageMb: number
  readonly fileMb: number
  readonly priority?: number
  readonly allowSplit?: boolean
  readonly readOnly?: boolean
}

function sanitizeProbeDetail(raw: string): string {
  const trimmed = raw
    .replace(/(?:s3|webdavs?):\/\/[^\s]+/gi, '[dsn]')
    .replace(/\s+/g, ' ')
    .trim()
  return trimmed.length > 160 ? `${trimmed.slice(0, 157)}...` : trimmed
}

export async function saveStorageServer(
  actor: StorageActor,
  input: SaveStorageServerInput,
  deps: AppStorageDeps = {},
): Promise<UserResult<StorageServersSlice>> {
  const principal = toPrincipal(actor)
  const keys = deps.sealKeys ?? defaultSealKeys()
  if (!keys.enabled) return fail({ code: 'auth.disabled' })

  const database = deps.db ?? defaultDb
  const cloud = isCloudRuntime(deps.isCloud)
  const api = database.resource(storageServer)

  const editId = input.id?.trim() || null
  let existingRow: Record<string, unknown> | undefined
  let slot: string

  if (editId) {
    if (!checkGrants(principal, gStorageServer.update)) {
      return fail({ code: 'auth.forbidden' })
    }
    const found = (await api.select(SYSTEM, {
      filter: { field: 'id', op: 'eq', value: editId },
    })) as unknown as Record<string, unknown>[]
    existingRow = found[0]
    if (!existingRow) return fail({ code: 'storage.not-found' })
    slot = String(existingRow.slot)
  } else {
    if (!checkGrants(principal, gStorageServer.insert)) {
      return fail({ code: 'auth.forbidden' })
    }
    slot = String(input.slot ?? '').trim().toLowerCase()
    if (!VAULT_SLOT_ID_RE.test(slot)) {
      return fail({ code: 'storage.slot-invalid', path: 'slot' })
    }
    if (RESERVED_SLOTS.has(slot)) {
      return fail({ code: 'storage.slot-reserved', path: 'slot' })
    }
    const bySlot = ((await api.select(SYSTEM, {
      filter: { field: 'slot', op: 'eq', value: slot },
    })) as unknown as Record<string, unknown>[])[0]
    if (bySlot) {
      return fail({ code: 'storage.slot-taken', path: 'slot' })
    }
  }

  if (!VAULT_SLOT_ID_RE.test(slot)) {
    return fail({ code: 'storage.slot-invalid', path: 'slot' })
  }
  if (RESERVED_SLOTS.has(slot)) {
    return fail({ code: 'storage.slot-reserved', path: 'slot' })
  }

  const prevEntry = existingRow
    ? await unsealServerConfig(String(existingRow.sealed_config ?? ''), keys)
    : null

  const rawUrl = String(input.url ?? '').trim() || prevEntry?.url || ''
  if (!rawUrl) {
    return fail({ code: 'storage.url-invalid', path: 'url' })
  }
  try {
    if (isWebdavDsn(rawUrl)) parseWebdavUrl(rawUrl)
    else parseS3Url(rawUrl)
  } catch {
    return fail({ code: 'storage.url-invalid', path: 'url' })
  }

  const urlSafety = validateStorageTargetUrl(rawUrl, { allowLocalNetwork: !cloud })
  if (!urlSafety.ok) {
    return fail({ code: 'storage.url-blocked', path: 'url' })
  }

  const storageMb = Number(input.storageMb)
  const fileMb = Number(input.fileMb)
  const priority = input.priority !== undefined ? Number(input.priority) : 100
  if (
    !Number.isInteger(storageMb) ||
    storageMb < 1 ||
    storageMb > 1_048_576 ||
    !Number.isInteger(fileMb) ||
    fileMb < 1 ||
    fileMb > 1_048_576 ||
    fileMb > storageMb ||
    !Number.isInteger(priority) ||
    priority < 0 ||
    priority > 10_000
  ) {
    return fail({ code: 'storage.limits-invalid', path: 'file_mb' })
  }

  const rawEncKey = String(input.encryptionKey ?? '').trim()
  if (
    rawEncKey &&
    (rawEncKey.length < 8 || rawEncKey.length > 256 || /[\u0000-\u001f\u007f]/.test(rawEncKey))
  ) {
    return fail({ code: 'storage.key-invalid', path: 'encryption_key' })
  }
  const encryptionKey = input.clearEncryptionKey
    ? undefined
    : rawEncKey || prevEntry?.encryptionKey || undefined

  const entry: StorageVaultEntry = {
    url: rawUrl,
    storageMb,
    fileMb,
    readOnly: Boolean(input.readOnly),
    allowSplit: input.allowSplit !== false,
    ...(encryptionKey ? { encryptionKey } : {}),
  }

  const verdict = await probeStorageVaultEntry(slot, entry, deps.fetchImpl, {
    allowLocalNetwork: !cloud,
  })
  if (!verdict.ok) {
    const targetField = verdict.path?.[0] === 'encryption_key' ? 'encryption_key' : 'url'
    return fail({
      code: 'storage.probe-failed',
      path: targetField,
      args: { detail: sanitizeProbeDetail(verdict.message) },
    })
  }

  const sealed = await sealServerConfig(entry, keys)
  const meta = buildMeta(entry)
  const actorCtx: DataContext = { principal }

  if (existingRow) {
    await api.update(actorCtx, String(existingRow.id), {
      sealed_config: sealed,
      meta,
      priority,
    })
  } else {
    await api.insert(actorCtx, {
      slot,
      sealed_config: sealed,
      meta,
      priority,
    })
  }

  await invalidateAppStoragePoolCache(deps.db)
  return listStorageServers(actor, deps)
}

export async function removeStorageServer(
  actor: StorageActor,
  id: string,
  deps: AppStorageDeps = {},
): Promise<UserResult<StorageServersSlice>> {
  const principal = toPrincipal(actor)
  if (!checkGrants(principal, gStorageServer.delete)) {
    return fail({ code: 'auth.forbidden' })
  }
  const database = deps.db ?? defaultDb
  const api = database.resource(storageServer)
  const targetId = id.trim()
  if (!targetId) return fail({ code: 'storage.not-found' })

  const existing = (await api.select(SYSTEM, {
    filter: { field: 'id', op: 'eq', value: targetId },
  })) as unknown as Record<string, unknown>[]
  if (!existing[0]) return fail({ code: 'storage.not-found' })

  await api.delete({ principal }, targetId, { hard: true })
  await invalidateAppStoragePoolCache(deps.db)
  return listStorageServers(actor, deps)
}
