/**
 * Загрузчики «Диска» (`plan-drive-repair.md` §4.3, §5).
 *
 * Один `load` на носитель: страница отдаёт снапшот первой порции, модалка и
 * догрузка зовут тот же `load` через `preloadData`. Права и срез считает
 * сервис; здесь только гейт входа и форма ответа. Ответ всегда
 * `private, no-store`: имена файлов — личные данные.
 */
import type { RequestEvent } from '@sveltejs/kit'
import { localPath } from '#core/lib/address/index.js'
import {
  DEFAULT_DRIVE_QUOTA_BYTES,
  driveQuota,
  type DriveCapabilities,
  type DriveEntry,
  type DriveNodeView,
  type DriveQuotaView,
} from '#core/lib/drive/index.js'
import type { AuthErrorCode } from '#modules/user/base/model/error.js'
import { driveMessage } from '#modules/drive/messages.js'
import type { DriveOperationName } from '#modules/drive/operations.js'
import { driveOperationAction } from '#modules/drive/operations.js'
import { resolveDriveAccess } from '#modules/drive/service/access.js'
import { readDriveShares } from '#modules/drive/service/mutate.js'
import { driveUsedBytes, loadDrivePage } from '#modules/drive/service/query.js'
import { listDriveDavTokens } from '#modules/drive/service/tokens.js'
import {
  DRIVE_KEYS,
  DRIVE_PAGE_DEFAULT,
  DRIVE_PAGE_SIZES,
  driveDateRange,
  driveFilterExtras,
  driveIdentityExtra,
  driveIdentityPath,
  driveSnapshot,
  parseDriveFilters,
  parseDriveIdentity,
  parseDriveIds,
  type DriveListIdentity,
} from '#modules/drive/source.js'
import type {
  DriveListItem,
  DriveListRouteData,
  DriveNodePageData,
  DriveOperationData,
  DrivePickerData,
  DriveShareView,
  DrivePick,
} from '#modules/drive/types.js'
import { auth } from '#modules/user/base/service/gateway.server.js'
import { db } from '#core/server/db.server.js'

const EMPTY_CAPS: DriveCapabilities = { canRead: false, canWrite: false, canShare: false }
const EMPTY_QUOTA: DriveQuotaView = { used: 0, limit: 0, remaining: 0 }

interface Actor {
  readonly id: string
  readonly permissions: readonly string[]
}

async function actorOf(event: RequestEvent): Promise<{ enabled: boolean; actor: Actor | null; fact: AuthErrorCode | null }> {
  const u = auth(event)
  if (!u.enabled) return { enabled: false, actor: null, fact: 'auth.disabled' }
  const who = await u.actor()
  if (!who.ok) return { enabled: true, actor: null, fact: who.fact.code }
  return {
    enabled: true,
    actor: { id: who.value.id, permissions: who.value.permissions ?? [] },
    fact: null,
  }
}

const toItem = (entry: DriveEntry): DriveListItem => ({ ...entry, id: entry.node.id })

function shownNotice(event: RequestEvent): string | null {
  const value = event.url.searchParams.get('notice')
  if (!value) return null
  // Неизвестный код не показываем как успех: словарь — единственный источник.
  return driveMessage(value) === value ? null : value
}

function foldersOf(
  folder: DriveNodeView | null,
  items: readonly DriveEntry[],
  crumbs: readonly { id: string; name: string }[],
): { id: string | null; label: string }[] {
  const out: { id: string | null; label: string }[] = []
  if (!folder || crumbs.length === 0) out.push({ id: null, label: 'Корень диска' })
  crumbs.slice(0, -1).forEach((crumb, index) => {
    out.push({
      id: crumb.id,
      label: crumbs
        .slice(0, index + 1)
        .map((item) => item.name)
        .join(' / '),
    })
  })
  for (const entry of items) {
    if (entry.node.kind === 'folder') out.push({ id: entry.node.id, label: `↳ ${entry.node.name}` })
  }
  return out
}

function emptyList(
  identity: DriveListIdentity,
  patch: Partial<DriveListRouteData> = {},
): DriveListRouteData {
  return {
    snapshot: null,
    fact: null,
    enabled: true,
    identity: driveIdentityExtra(identity),
    pathname: driveIdentityPath(identity),
    folder: null,
    caps: EMPTY_CAPS,
    quota: EMPTY_QUOTA,
    breadcrumbs: [],
    trashed: identity.kind === 'trash',
    folders: [],
    notice: null,
    pick: null,
    ...patch,
  }
}

/** Список «Диска»: `?drive=N` плюс фильтры как `extra`-ключи. */
export async function loadDriveList(
  event: RequestEvent,
  identity: DriveListIdentity,
  /** Ограничение пикера: применяется сервером до totals и нарезки страницы. */
  overrides: { kind?: 'file' | 'folder' } = {},
): Promise<DriveListRouteData> {
  event.setHeaders({ 'cache-control': 'private, no-store' })
  const gate = await actorOf(event)
  if (!gate.actor) return emptyList(identity, { enabled: gate.enabled, fact: gate.fact })

  const filters = parseDriveFilters(event.url.searchParams)
  const ids = parseDriveIds(event.url.searchParams.get(DRIVE_KEYS.ids))
  const range = driveDateRange(filters)
  const pageRaw = Number(event.url.searchParams.get(DRIVE_KEYS.page) ?? '1')
  const page = Number.isFinite(pageRaw) ? Math.max(1, Math.trunc(pageRaw)) : 1

  const result = await loadDrivePage(db, gate.actor, {
    folderId: identity.kind === 'folder' ? identity.id : null,
    trashed: identity.kind === 'trash',
    sort: filters.sort,
    direction: filters.sort === 'name' ? 'asc' : 'desc',
    search: filters.search,
    kind: filters.type === 'all' ? overrides.kind : filters.type,
    starred: filters.starred,
    from: range.from,
    to: range.to,
    ids: ids ?? undefined,
    page,
    pageSize: filters.pageSize,
  })
  if (!result.ok) {
    const fact: AuthErrorCode =
      result.code === 'drive.not-found' ? 'auth.forbidden' : 'auth.forbidden'
    return emptyList(identity, { fact, notice: shownNotice(event) })
  }

  const data = result.value
  const items = data.items.map(toItem)
  const extra = driveFilterExtras(filters, ids)
  return {
    ...emptyList(identity),
    snapshot: driveSnapshot(
      {
        items,
        page: data.page,
        pageSize: data.pageSize,
        total: data.total,
        totalPages: data.totalPages,
        hasNext: data.hasNext,
        hasPrev: data.hasPrev,
      },
      driveIdentityExtra(identity),
      extra,
    ),
    folder: data.folder,
    caps: data.caps,
    quota: data.quota,
    breadcrumbs: data.breadcrumbs,
    trashed: data.trashed,
    folders: foldersOf(data.folder, data.items, data.breadcrumbs),
    notice: shownNotice(event),
    pick: pickOf(event),
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Возврат пикера: `pick=move|copy`, `node`, `target_id` (пусто — корень). */
function pickOf(event: RequestEvent): DrivePick | null {
  const op = event.url.searchParams.get('pick')
  const nodeId = event.url.searchParams.get('node') ?? ''
  if (op !== 'move' && op !== 'copy') return null
  if (!UUID.test(nodeId)) return null
  if (!event.url.searchParams.has('target_id')) return null
  const target = event.url.searchParams.get('target_id') ?? ''
  if (target && !UUID.test(target)) return null
  return { nodeId, op, targetId: target || null }
}

/** Карточка узла: страница и модалка `drive.node`. */
export async function loadDriveNode(event: RequestEvent, nodeId: string): Promise<DriveNodePageData> {
  event.setHeaders({ 'cache-control': 'private, no-store' })
  const gate = await actorOf(event)
  const denied = (fact: AuthErrorCode): DriveNodePageData => ({
    enabled: gate.enabled,
    fact,
    node: null,
    caps: EMPTY_CAPS,
    shares: [],
    quota: EMPTY_QUOTA,
    downloadHref: null,
  })
  if (!gate.actor) return denied(gate.fact ?? 'auth.forbidden')

  const access = await resolveDriveAccess(db, gate.actor, nodeId)
  if (!access) return denied('auth.forbidden')
  const read = access.caps.canShare ? await readDriveShares(db, gate.actor, nodeId) : null
  const shares: readonly DriveShareView[] = read?.ok ? read.value.shares : []
  const used = await driveUsedBytes(db, access.node.ownerId)
  return {
    enabled: true,
    fact: null,
    node: access.node,
    caps: access.caps,
    shares,
    quota: driveQuota(used, DEFAULT_DRIVE_QUOTA_BYTES),
    downloadHref:
      access.node.kind === 'file' && access.node.fileId
        ? `/api/drive/${access.node.id}/download`
        : null,
  }
}

const PICKER_PARAM = /^[A-Za-z0-9_-]{1,64}$/

/** Пикер (`/drive/pick`): тот же список плюс адрес возврата и имя параметра. */
export async function loadDrivePicker(event: RequestEvent): Promise<DrivePickerData> {
  const folderId = event.url.searchParams.get('folder')?.trim() || null
  const identity: DriveListIdentity =
    folderId && UUID.test(folderId) ? { kind: 'folder', id: folderId } : { kind: 'root' }
  const kind = event.url.searchParams.get('kind') === 'folder' ? 'folder' : 'any'
  const list = await loadDriveList(event, identity, kind === 'folder' ? { kind } : {})
  const from = localPath(event.url.searchParams.get('from')) ?? '/drive'
  const rawParam = event.url.searchParams.get('param') ?? ''
  return {
    list,
    from,
    param: PICKER_PARAM.test(rawParam) ? rawParam : 'id',
    kind,
    folderId,
  }
}

function textParam(event: RequestEvent, name: string): string {
  return event.url.searchParams.get(name)?.trim() ?? ''
}

function optionalUuid(event: RequestEvent, name: string): string | null {
  const value = textParam(event, name)
  return UUID.test(value) ? value : null
}

/**
 * Данные операции: одна форма ответа на все строки матрицы. `initial` строит
 * компонент формы, поэтому страница и модалка получают одинаковые значения.
 */
export async function loadDriveOperation(
  event: RequestEvent,
  op: DriveOperationName,
): Promise<DriveOperationData> {
  event.setHeaders({ 'cache-control': 'private, no-store' })
  const returnTo = localPath(event.url.searchParams.get('return_to')) ?? '/drive'
  const gate = await actorOf(event)
  const denied = (fact: AuthErrorCode): DriveOperationData => ({
    enabled: gate.enabled,
    fact,
    returnTo,
    action: driveOperationAction(op),
    parentId: null,
    parent: null,
    node: null,
    caps: EMPTY_CAPS,
    folders: [],
    shares: [],
    tokens: [],
    values: {
      name: '',
      targetId: null,
      starred: false,
      uid: '',
      role: 'viewer',
      tokenId: textParam(event, 'token_id'),
      label: '',
    },
    quota: EMPTY_QUOTA,
    filters: { search: '', sort: 'name', type: 'all', starred: false, pageSize: DRIVE_PAGE_DEFAULT, from: '', to: '' },
  })
  if (!gate.actor) return denied(gate.fact ?? 'auth.forbidden')

  const nodeId = optionalUuid(event, 'node_id')
  const parentId = optionalUuid(event, 'parent_id')
  const base = denied('auth.forbidden')

  if (op === 'dav-issue' || op === 'dav-revoke') {
    const tokens = await listDriveDavTokens(db, gate.actor)
    return {
      ...base,
      fact: tokens.ok ? null : 'auth.forbidden',
      tokens: tokens.ok ? tokens.value : [],
    }
  }

  if (op === 'filters') {
    const filters = parseDriveFilters(event.url.searchParams)
    return {
      ...base,
      fact: null,
      caps: { canRead: true, canWrite: true, canShare: true },
      filters: {
        search: filters.search ?? '',
        sort: filters.sort,
        type: filters.type,
        starred: filters.starred,
        pageSize: filters.pageSize,
        from: filters.from ?? '',
        to: filters.to ?? '',
      },
    }
  }

  if (op === 'mkdir' || op === 'upload') {
    if (!parentId) {
      const used = await driveUsedBytes(db, gate.actor.id)
      return {
        ...base,
        fact: null,
        caps: { canRead: true, canWrite: true, canShare: true },
        quota: driveQuota(used, DEFAULT_DRIVE_QUOTA_BYTES),
      }
    }
    const access = await resolveDriveAccess(db, gate.actor, parentId)
    if (!access || access.node.kind !== 'folder' || !access.caps.canWrite || access.node.trashedAt) {
      return base
    }
    const used = await driveUsedBytes(db, access.node.ownerId)
    return {
      ...base,
      fact: null,
      parentId: access.node.id,
      parent: access.node,
      caps: access.caps,
      folders: [{ id: access.node.id, label: access.node.name }],
      quota: driveQuota(used, DEFAULT_DRIVE_QUOTA_BYTES),
    }
  }

  if (!nodeId) return base
  const access = await resolveDriveAccess(db, gate.actor, nodeId)
  if (!access) return base
  const node = access.node
  const canShare = access.caps.canShare
  const writable = access.caps.canWrite && node.trashedAt === null
  const trashed = node.trashedAt !== null

  if (op === 'purge' && !trashed) return { ...base, fact: 'auth.forbidden' }

  const needsWrite = op !== 'share' && op !== 'unshare'
  if (needsWrite && !(op === 'restore' || op === 'purge' ? access.caps.canWrite : writable)) {
    return base
  }
  if (!needsWrite && !canShare) return base

  const shareRead = canShare ? await readDriveShares(db, gate.actor, nodeId) : null
  const folders = op === 'move' || op === 'copy' ? await targetFolders(gate.actor, node) : []
  const used = await driveUsedBytes(db, node.ownerId)

  return {
    ...base,
    fact: null,
    node,
    caps: access.caps,
    folders,
    shares: shareRead?.ok ? shareRead.value.shares : [],
    quota: driveQuota(used, DEFAULT_DRIVE_QUOTA_BYTES),
    values: {
      name: node.name,
      targetId: node.parentId,
      starred: node.starred,
      uid: textParam(event, 'uid'),
      role: 'viewer',
      tokenId: textParam(event, 'token_id'),
      label: '',
    },
  }
}

/** Куда можно перенести/скопировать: свои корень/предки/папки среза. */
async function targetFolders(
  actor: Actor,
  node: DriveNodeView,
): Promise<{ id: string | null; label: string }[]> {
  const out: { id: string | null; label: string }[] = []
  if (node.ownerId === actor.id) out.push({ id: null, label: 'Корень диска' })
  let current = node.parentId
  const chain: DriveNodeView[] = []
  while (current) {
    const parent = await resolveDriveAccess(db, actor, current)
    if (!parent || parent.node.kind !== 'folder') break
    chain.unshift(parent.node)
    current = parent.node.parentId
  }
  chain.forEach((folder, index) => {
    out.push({
      id: folder.id,
      label: chain
        .slice(0, index + 1)
        .map((item) => item.name)
        .join(' / '),
    })
  })
  return out
}

/** Размер порции из адреса (для страницы фильтров). */
export function drivePageSizeOf(event: RequestEvent): number {
  const size = Number(event.url.searchParams.get(DRIVE_KEYS.size))
  return (DRIVE_PAGE_SIZES as readonly number[]).includes(size) ? size : DRIVE_PAGE_DEFAULT
}
