/**
 * WebDAV-монтирование «Диска» (`plan-drive.md` §4.6): `DavBackend` поверх
 * `service/*`, а не поверх файловой системы.
 *
 * Дерево и права берутся из БД, байты — из `resolveAppStorage`. Каждый запрос
 * аутентифицируется паролем приложения (`service/tokens.ts`), поэтому бэкенд
 * создаётся на запрос с уже известным аккаунтом. Class 2: общий стор блокировок
 * (`drive_dav_lock`) разделяется между инстансами через БД.
 */
import type { Database } from '#core/lib/db/index.js'
import {
  isDavPathWithin,
  weakEtag,
  type DavFileLike,
  type DavResource,
} from '#core/lib/storage/webdav.js'
import {
  createWebdavServer,
  DEFAULT_LOCK_TIMEOUT_SECONDS,
  MAX_LOCK_TIMEOUT_SECONDS,
  type DavBackend,
  type DavLock,
  type DavLockRequest,
  type DavLockStore,
  type DavCopyOptions,
  type DavMoveOptions,
  type DavWriteInput,
  type DavWriteOutcome,
} from '#core/lib/storage/webdav/server.js'
import type { DriveNodeView } from '#core/lib/drive/index.js'
import type { DriveActor } from './types.js'
import { DRIVE_SERVER } from './service/access.js'
import {
  copyDriveNode,
  createDriveFolder,
  liveSiblings,
  moveDriveNode,
  purgeDriveNode,
  renameDriveNode,
  restoreDriveNode,
  trashDriveNode,
  type DriveBytesPort,
} from './service/mutate.js'
import { uploadDriveFile, type DriveUploadStorage } from './service/upload.js'
import { resolveDriveAccess } from './service/access.js'
import { verifyDriveDavToken } from './service/tokens.js'

/** Порт байтов для WebDAV: чтение, запись и удаление. */
export interface DriveDavStorage extends DriveUploadStorage, DriveBytesPort {
  lazy(path: string): Promise<DavFileLike | null>
}

const segmentsOf = (path: string): string[] => path.split('/').filter(Boolean)

/** Узел по DAV-пути в собственном диске аккаунта; `''` — корень. */
async function nodeAtPath(
  db: Database,
  actor: DriveActor,
  path: string,
): Promise<DriveNodeView | null> {
  let parentId: string | null = null
  let node: DriveNodeView | null = null
  for (const segment of segmentsOf(path)) {
    const siblings = await liveSiblings(db, actor.id, parentId)
    node = siblings.find((item) => item.name === segment) ?? null
    if (!node) return null
    parentId = node.id
  }
  return node
}

/** Папка-родитель DAV-пути. `undefined` — папки нет, `null` — корень. */
async function parentFolder(
  db: Database,
  actor: DriveActor,
  path: string,
): Promise<{ readonly node: DriveNodeView | null } | undefined> {
  const segments = segmentsOf(path)
  segments.pop()
  const parentPath = segments.join('/')
  if (!parentPath) return { node: null }
  const node = await nodeAtPath(db, actor, parentPath)
  return node && node.kind === 'folder' ? { node } : undefined
}

function davResource(node: DriveNodeView, path: string): DavResource {
  const base: DavResource = {
    path,
    kind: node.kind === 'folder' ? 'collection' : 'file',
    lastModified: node.updatedAt.getTime(),
    createdAt: node.createdAt.getTime(),
    displayName: node.name,
    ...(node.kind === 'file'
      ? {
          size: node.size,
          contentType: node.contentType ?? 'application/octet-stream',
          etag: weakEtag(node.size, node.updatedAt.getTime()),
        }
      : {}),
  }
  return base
}

const joinPath = (parent: string, name: string): string =>
  parent ? `${parent}/${name}` : name

/** Бэкенд для одного аккаунта. Экспортируется и для unit-тестов. */
export function createDriveDavBackend(
  db: Database,
  actor: DriveActor,
  storage: DriveDavStorage | null,
): DavBackend {
  const folderOf = async (path: string) => {
    const folder = await parentFolder(db, actor, path)
    if (!folder) throw new Error('drive.dav-parent-missing')
    return folder
  }

  /**
   * Замена назначения без потери данных при отказе: старое уходит в корзину
   * (обратимо), и только успешная новая запись её окончательно убирает.
   */
  const replace = async <T>(
    path: string,
    write: () => Promise<T>,
  ): Promise<{ readonly replaced: boolean; readonly value: T }> => {
    const existing = await nodeAtPath(db, actor, path)
    if (!existing) return { replaced: false, value: await write() }
    const trashed = await trashDriveNode(db, actor, { nodeId: existing.id })
    if (!trashed.ok) throw new Error(trashed.code)
    let value: T
    try {
      value = await write()
    } catch (error) {
      // Возврат назначения: удалять его до успешной фиксации замены нельзя.
      await restoreDriveNode(db, actor, { nodeId: existing.id }).catch(() => undefined)
      throw error
    }
    await purgeDriveNode(db, actor, { nodeId: existing.id }, storage ?? undefined).catch(
      () => undefined,
    )
    return { replaced: true, value }
  }

  return {
    async stat(path) {
      if (!path) {
        return { path: '', kind: 'collection', lastModified: Date.now() }
      }
      const node = await nodeAtPath(db, actor, path)
      return node ? davResource(node, path) : null
    },
    async list(path) {
      const node = path ? await nodeAtPath(db, actor, path) : null
      if (path && !node) return []
      if (node && node.kind !== 'folder') return []
      const siblings = await liveSiblings(db, actor.id, node?.id ?? null)
      return siblings.map((child) => davResource(child, joinPath(path, child.name)))
    },
    async read(path) {
      const node = await nodeAtPath(db, actor, path)
      if (!node || node.kind !== 'file' || !node.fileId || !storage) return null
      return storage.lazy(node.fileId)
    },
    async write(path: string, input: DavWriteInput): Promise<DavResource> {
      const folder = await folderOf(path)
      const name = segmentsOf(path).pop() ?? ''
      if (!storage) throw new Error('drive.storage-unavailable')
      const bytes = new Uint8Array(await new Response(input.stream).arrayBuffer())
      const result = await uploadDriveFile(
        db,
        actor,
        {
          parentId: folder.node?.id ?? null,
          name,
          body: bytes,
          size: bytes.byteLength,
          contentType: input.contentType,
          overwrite: input.overwrite,
        },
        { storage },
      )
      if (!result.ok) throw new Error(result.code)
      return davResource(result.value, path)
    },
    async mkdir(path) {
      const folder = await folderOf(path)
      const name = segmentsOf(path).pop() ?? ''
      const result = await createDriveFolder(db, actor, {
        parentId: folder.node?.id ?? null,
        name,
      })
      if (!result.ok) throw new Error(result.code)
      return davResource(result.value, path)
    },
    async remove(path) {
      const node = await nodeAtPath(db, actor, path)
      if (!node) return false
      const trashed = await trashDriveNode(db, actor, { nodeId: node.id })
      if (!trashed.ok) return false
      const purged = await purgeDriveNode(db, actor, { nodeId: node.id }, storage ?? undefined)
      return purged.ok
    },
    async copy(from, to, options: DavCopyOptions): Promise<DavWriteOutcome> {
      const source = await nodeAtPath(db, actor, from)
      if (!source) throw new Error('drive.not-found')
      const folder = await folderOf(to)
      const name = segmentsOf(to).pop() ?? ''
      const destination = await nodeAtPath(db, actor, to)
      if (destination && destination.id === source.id) throw new Error('drive.name-taken')
      if (destination && !options.overwrite) throw new Error('drive.name-taken')
      const written = await replace(to, async () => {
        if (!options.deep && source.kind === 'folder') {
          const created = await createDriveFolder(db, actor, {
            parentId: folder.node?.id ?? null,
            name,
          })
          if (!created.ok) throw new Error(created.code)
        } else {
          const copied = await copyDriveNode(db, actor, {
            nodeId: source.id,
            targetId: folder.node?.id ?? null,
            name,
          })
          if (!copied.ok) throw new Error(copied.code)
        }
      })
      return written.replaced ? 'replaced' : 'created'
    },
    async move(from, to, options: DavMoveOptions): Promise<DavWriteOutcome> {
      const source = await nodeAtPath(db, actor, from)
      if (!source) throw new Error('drive.not-found')
      const folder = await folderOf(to)
      const name = segmentsOf(to).pop() ?? ''
      const destination = await nodeAtPath(db, actor, to)
      if (destination && destination.id === source.id) {
        // Перенос в тот же путь: имя меняется на месте.
        if (name === source.name) return 'created'
        const renamed = await renameDriveNode(db, actor, { nodeId: source.id, name })
        if (!renamed.ok) throw new Error(renamed.code)
        return 'created'
      }
      if (destination && !options.overwrite) throw new Error('drive.name-taken')
      const written = await replace(to, async () => {
        if (name !== source.name) {
          const renamed = await renameDriveNode(db, actor, { nodeId: source.id, name })
          if (!renamed.ok) throw new Error(renamed.code)
        }
        if ((folder.node?.id ?? null) !== source.parentId) {
          const moved = await moveDriveNode(db, actor, {
            nodeId: source.id,
            targetId: folder.node?.id ?? null,
          })
          if (!moved.ok) throw new Error(moved.code)
        }
      })
      return written.replaced ? 'replaced' : 'created'
    },
  }
}

function normalizeDriveLockTimeout(
  seconds: number | undefined,
  options: { defaultSeconds: number; maxSeconds: number },
): number {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return options.defaultSeconds
  }
  return Math.min(Math.floor(seconds), options.maxSeconds)
}

function toDavLock(row: Record<string, unknown>, namespace = ''): DavLock {
  const expiresRaw = row.expires_at
  const expiresAt =
    expiresRaw instanceof Date ? expiresRaw.getTime() : Date.parse(String(expiresRaw))
  const rawPath = String(row.path ?? '')
  const prefix = namespace ? `${namespace}\u0000` : ''
  const path = prefix && rawPath.startsWith(prefix) ? rawPath.slice(prefix.length) : rawPath
  return {
    token: String(row.token),
    path,
    scope: row.scope === 'shared' ? 'shared' : 'exclusive',
    depth: row.depth === '0' ? '0' : 'infinity',
    ...(row.owner != null && String(row.owner) !== '' ? { owner: String(row.owner) } : {}),
    timeoutSeconds: Number(row.timeout_seconds),
    expiresAt,
  }
}

/**
 * Общий (межинстансный) стор блокировок WebDAV поверх БД. Используется вместо
 * `memoryDavLockStore`, чтобы два инстанса приложения видели одну блокировку.
 */
export function createDriveDavLockStore(
  db: Database,
  options: { readonly now?: () => number; readonly namespace?: string } = {},
): DavLockStore {
  const now = options.now ?? Date.now
  // Ключ блокировки содержит пространство аккаунта: одинаковый путь у двух
  // владельцев — две разные блокировки, а не одна общая.
  const namespace = options.namespace ?? ''
  const prefix = namespace ? `${namespace}\u0000` : ''
  const keyOf = (path: string): string => (prefix ? `${prefix}${path}` : path)
  const own = (rows: Record<string, unknown>[]): Record<string, unknown>[] =>
    prefix ? rows.filter((row) => String(row.path ?? '').startsWith(prefix)) : rows
  const prune = async (): Promise<void> => {
    await db.query({ text: 'DELETE FROM public.drive_dav_lock WHERE expires_at <= $1', values: [new Date(now())] })
  }
  return {
    async acquire(input: DavLockRequest) {
      await prune()
      const seconds = normalizeDriveLockTimeout(input.timeoutSeconds, {
        defaultSeconds: DEFAULT_LOCK_TIMEOUT_SECONDS,
        maxSeconds: MAX_LOCK_TIMEOUT_SECONDS,
      })
      const token = `urn:uuid:${crypto.randomUUID()}`
      const expiresAt = now() + seconds * 1000
      await db.query({
        text: `INSERT INTO public.drive_dav_lock
               (token, path, scope, depth, owner, timeout_seconds, expires_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        values: [
          token,
          keyOf(input.path),
          input.scope,
          input.depth,
          input.owner ?? null,
          seconds,
          new Date(expiresAt),
        ],
      })
      return {
        token,
        path: input.path,
        scope: input.scope,
        depth: input.depth,
        ...(input.owner !== undefined ? { owner: input.owner } : {}),
        timeoutSeconds: seconds,
        expiresAt,
      }
    },
    async refresh(token: string, timeoutSeconds?: number) {
      await prune()
      const current = await this.get(token)
      if (!current) return null
      const seconds = normalizeDriveLockTimeout(timeoutSeconds ?? current.timeoutSeconds, {
        defaultSeconds: DEFAULT_LOCK_TIMEOUT_SECONDS,
        maxSeconds: MAX_LOCK_TIMEOUT_SECONDS,
      })
      const expiresAt = now() + seconds * 1000
      const result = await db.query({
        text: `UPDATE public.drive_dav_lock
               SET timeout_seconds = $2, expires_at = $3
               WHERE token = $1
               RETURNING token, path, scope, depth, owner, timeout_seconds, expires_at`,
        values: [token, seconds, new Date(expiresAt)],
      })
      if (!result.rows[0]) return null
      return toDavLock(result.rows[0] as Record<string, unknown>, namespace)
    },
    async release(token: string) {
      await prune()
      const result = await db.query({
        text: 'DELETE FROM public.drive_dav_lock WHERE token = $1',
        values: [token],
      })
      return result.rowCount > 0
    },
    async get(token: string) {
      await prune()
      const result = await db.query({
        text: `SELECT token, path, scope, depth, owner, timeout_seconds, expires_at
               FROM public.drive_dav_lock WHERE token = $1`,
        values: [token],
      })
      const row = result.rows[0]
      if (!row) return null
      if (prefix && !String(row.path ?? '').startsWith(prefix)) return null
      const lock = toDavLock(row as Record<string, unknown>, namespace)
      if (lock.expiresAt <= now()) return null
      return lock
    },
    async covering(path: string) {
      await prune()
      const result = await db.query({
        text: `SELECT token, path, scope, depth, owner, timeout_seconds, expires_at
               FROM public.drive_dav_lock`,
      })
      const timestamp = now()
      return own(result.rows as Record<string, unknown>[])
        .map((row) => toDavLock(row, namespace))
        .filter((lock) => lock.expiresAt > timestamp)
        .filter(
          (lock) =>
            lock.path === path ||
            (lock.depth === 'infinity' && isDavPathWithin(path, lock.path)),
        )
    },
    async within(path: string) {
      await prune()
      const result = await db.query({
        text: `SELECT token, path, scope, depth, owner, timeout_seconds, expires_at
               FROM public.drive_dav_lock`,
      })
      const timestamp = now()
      return own(result.rows as Record<string, unknown>[])
        .map((row) => toDavLock(row, namespace))
        .filter((lock) => lock.expiresAt > timestamp)
        .filter((lock) => isDavPathWithin(lock.path, path))
    },
  }
}

export interface DriveDavOptions {
  readonly db: Database
  readonly storage: DriveDavStorage | null
  /** Ключ HMAC паролей приложений (`AUTH_SEAL_SECRET`). */
  readonly secretKey: string
  readonly basePath?: string
}

/**
 * Обработчик `/api/dav`: проверка пароля приложения → бэкенд аккаунта →
 * протокол. Ответ `401` обязателен с `WWW-Authenticate`, иначе клиенты
 * (Finder, Windows, rclone) не предложат ввести пароль.
 */
export function createDriveDav(options: DriveDavOptions) {
  return {
    async handle(request: Request): Promise<Response> {
      const actor = await verifyDriveDavToken(
        options.db,
        request.headers.get('authorization'),
        options.secretKey,
      )
      if (!actor) {
        return new Response('Unauthorized', {
          status: 401,
          headers: {
            'www-authenticate': 'Basic realm="Drive", charset="UTF-8"',
            'cache-control': 'no-store',
          },
        })
      }
      // Блокировки — в пространстве аккаунта: путь `/Отчёты` у двух
      // владельцев не должен делить один LOCK.
      const locks = createDriveDavLockStore(options.db, { namespace: actor.id })
      const backend = createDriveDavBackend(options.db, actor, options.storage)
      try {
        return await createWebdavServer({
          backend,
          basePath: options.basePath ?? '/api/dav',
          maxDepth: 1,
          locks,
        }).handle(request)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'drive.dav-restore-failed'
        return new Response(message, {
          status: 500,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        })
      }
    },
  }
}

/** Проверка «узел этого аккаунта» для тестов бэкенда. */
export { nodeAtPath, DRIVE_SERVER, resolveDriveAccess }
