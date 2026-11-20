/**
 * Загрузчики «Диска» (`plan-drive-repair.md` §4.3, §5).
 *
 * Один `load` на носитель: страница отдаёт снапшот первой порции, модалка и
 * догрузка зовут тот же `load` через `preloadData`. Права и срез считает
 * сервис; здесь только гейт входа и форма ответа. Ответ всегда
 * `private, no-store`: имена файлов — личные данные.
 */
import { error, redirect, type RequestEvent } from '@sveltejs/kit'
import { AUTH_SEAL_SECRET } from '$app/env/private'
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
import { driveFilterValues } from '#modules/drive/filters-form.js'
import { driveStarredRoute } from '#modules/drive/routes.js'
import { driveStorageGate } from './operations.server.js'
import {
  DRIVE_KEYS,
  DRIVE_PAGE_DEFAULT,
  DRIVE_PAGE_SIZES,
  driveDateRange,
  driveIdentityExtra,
  driveIdentityPath,
  driveSnapshot,
  parseDriveFilters,
  parseDriveIdentity,
  parseDriveIds,
  type DriveListIdentity,
} from '#modules/drive/source.js'
import { decodeDriveList, encodeDriveListExtra, resolveDriveList } from '#modules/drive/list-codec.js'
import {
  parseDriveIdsUrl,
  parseFilterOwner,
  parsePickerMode,
  parsePickerStep,
  pickerFrom,
} from '#modules/drive/picker-url.js'
import type {
  DriveFiltersPageData,
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

/** Имена получателей доступа: без права/строки остаётся uid, экран не падает. */
async function driveUserLabels(
  event: RequestEvent,
  uids: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (uids.length === 0) return out
  const result = await auth(event).listSeedUsers({
    ids: [...uids],
    nickname: true,
    page: 1,
    pageSize: Math.min(100, uids.length),
  })
  if (!result.ok) return out
  for (const user of result.value.items) out.set(user.id, user.nickname ?? user.id)
  return out
}

/** Опции `subjects` — только уже выбранные получатели (план §2.7), без списка всех аккаунтов. */
async function driveSubjectOptions(
  event: RequestEvent,
  uids: readonly string[],
): Promise<{ value: string; label: string }[]> {
  if (uids.length === 0) return []
  const labels = await driveUserLabels(event, uids)
  return uids.map((uid) => ({ value: uid, label: labels.get(uid) ?? uid }))
}

async function withShareLabels(
  event: RequestEvent,
  shares: readonly DriveShareView[],
): Promise<DriveShareView[]> {
  if (shares.length === 0) return []
  const labels = await driveUserLabels(event, shares.map((share) => share.uid))
  return shares.map((share) => ({ ...share, label: labels.get(share.uid) ?? share.uid }))
}

const davEnabled = (): boolean => (AUTH_SEAL_SECRET ?? '').length >= 32

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
    pick: null,
    ...patch,
  }
}

/** Список «Диска»: `?drive=N` плюс фильтры как `extra`-ключи. */
export async function loadDriveList(
  event: RequestEvent,
  identity: DriveListIdentity,
  /** Ограничение пикера: применяется сервером до totals и нарезки страницы. */
  overrides: { kind?: 'file' | 'folder'; ids?: readonly string[] } = {},
): Promise<DriveListRouteData> {
  event.setHeaders({ 'cache-control': 'private, no-store' })
  const gate = await actorOf(event)
  if (!gate.actor) return emptyList(identity, { enabled: gate.enabled, fact: gate.fact })

  // Старые ссылки `?drive.starred=1` — отдельный список, а не скрытый фильтр.
  if (identity.kind !== 'starred') {
    const old = event.url.searchParams.get(DRIVE_KEYS.starred)
    if (old === '1' || old === 'true') redirect(307, driveStarredRoute.href())
  }

  const decoded = decodeDriveList(event.url.searchParams, identity)
  const state = resolveDriveList(decoded.state, overrides.ids !== undefined ? { ids: overrides.ids } : {}).state
  const filters = { ...state.filters, pageSize: state.pageSize }
  const ids = state.ids
  const range = driveDateRange(filters)
  const page = state.page

  const result = await loadDrivePage(db, gate.actor, {
    folderId: identity.kind === 'folder' ? identity.id : null,
    trashed: identity.kind === 'trash',
    sort: filters.sort,
    direction: filters.sort === 'name' ? 'asc' : 'desc',
    search: filters.search,
    kind: filters.type === 'all' ? overrides.kind : filters.type,
    scope: identity.kind === 'starred' ? 'global' : filters.scope,
    starred: identity.kind === 'starred',
    from: range.from,
    to: range.to,
    ids: ids ?? undefined,
    page,
    pageSize: filters.pageSize,
  })
  if (!result.ok) {
    return emptyList(identity, { fact: 'auth.forbidden' })
  }

  const data = result.value
  const items = data.items.map(toItem)
  const extra = encodeDriveListExtra(state)
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
  const shares: readonly DriveShareView[] = read?.ok ? await withShareLabels(event, read.value.shares) : []
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
  const mode = parsePickerMode(event.url.searchParams.get('mode'))
  const step = mode === 'multiple' ? parsePickerStep(event.url.searchParams.get('upicks')) : 'pick'
  const filterOwner = mode === 'multiple' ? parseFilterOwner(event.url.searchParams.get('filter_owner')) : null
  const pickedUrl = mode === 'multiple' ? parseDriveIdsUrl(event.url.searchParams.get('picked')) : { ids: [], overflow: false }
  const idsUrl = mode === 'multiple' ? parseDriveIdsUrl(event.url.searchParams.get(DRIVE_KEYS.ids)) : { ids: [], overflow: false }
  if (pickedUrl.overflow) throw error(400, 'drive.picked-too-long')
  if (idsUrl.overflow) throw error(400, 'drive.ids-too-long')
  const picked = step === 'chosen' ? (idsUrl.ids ?? []) : (pickedUrl.ids ?? [])
  const list = await loadDriveList(event, identity, {
    ...(kind === 'folder' ? { kind } : {}),
    ...(step === 'chosen' ? { ids: picked } : {}),
  })
  const from = pickerFrom(event.url.searchParams.get('from'))
  const rawParam = event.url.searchParams.get('param') ?? ''
  const total = list.snapshot?.totalItems
  const totalItems = typeof total === 'number' && Number.isFinite(total) && total >= 0 ? total : null
  const hiddenCount = totalItems === null ? null : picked.length - totalItems
  return {
    list,
    from,
    param: PICKER_PARAM.test(rawParam) ? rawParam : 'id',
    kind,
    folderId,
    mode,
    step,
    picked,
    totalItems,
    hiddenCount,
    filterOwner,
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
  const blank = (fact: AuthErrorCode): DriveOperationData => ({
    enabled: gate.enabled,
    fact,
    returnTo,
    action: driveOperationAction(op),
    parentId: null,
    parent: null,
    node: null,
    caps: EMPTY_CAPS,
    shares: [],
    subjectOptions: [],
    tokens: [],
    storageError: null,
    davEnabled: davEnabled(),
    values: {
      name: '',
      targetId: null,
      targetLabel: 'Корень диска',
      starred: false,
      subjects: [],
      uid: '',
      role: 'viewer',
      tokenId: textParam(event, 'token_id'),
      label: '',
    },
    quota: EMPTY_QUOTA,
  })
  if (!gate.actor) return blank(gate.fact ?? 'auth.forbidden')

  const nodeId = optionalUuid(event, 'node_id')
  const parentId = optionalUuid(event, 'parent_id')
  const base = blank('auth.forbidden')

  if (op === 'dav-issue' || op === 'dav-revoke') {
    const tokens = await listDriveDavTokens(db, gate.actor)
    return {
      ...base,
      fact: tokens.ok ? null : 'auth.forbidden',
      tokens: tokens.ok ? tokens.value : [],
    }
  }

  if (op === 'mkdir' || op === 'upload') {
    const storageError = op === 'upload' ? (await driveStorageGate()).code : null
    if (!parentId) {
      const used = await driveUsedBytes(db, gate.actor.id)
      return {
        ...base,
        storageError,
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
      storageError,
      fact: null,
      parentId: access.node.id,
      parent: access.node,
      caps: access.caps,
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
  const used = await driveUsedBytes(db, node.ownerId)
  const shares = shareRead?.ok ? await withShareLabels(event, shareRead.value.shares) : []
  const targetId = optionalUuid(event, 'target_id') ?? node.parentId
  const target = targetId ? await resolveDriveAccess(db, gate.actor, targetId) : null
  const sharing = op === 'share'
  const selectedSubjects = sharing
    ? textParam(event, 'subjects')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : []

  return {
    ...base,
    fact: null,
    node,
    caps: access.caps,
    shares,
    subjectOptions: sharing ? await driveSubjectOptions(event, selectedSubjects) : [],
    quota: driveQuota(used, DEFAULT_DRIVE_QUOTA_BYTES),
    values: {
      name: node.name,
      targetId,
      targetLabel: target?.node.name ?? 'Корень диска',
      starred: node.starred,
      subjects: selectedSubjects,
      uid: textParam(event, 'uid'),
      role: 'viewer',
      tokenId: textParam(event, 'token_id'),
      label: '',
    },
  }
}

/** Размер порции из адреса (для страницы фильтров). */
export function drivePageSizeOf(event: RequestEvent): number {
  const size = Number(event.url.searchParams.get(DRIVE_KEYS.size))
  return (DRIVE_PAGE_SIZES as readonly number[]).includes(size) ? size : DRIVE_PAGE_DEFAULT
}

/** Доступы узла: страница-fallback модалки `drive.access`. */
export async function loadDriveAccess(event: RequestEvent): Promise<DriveNodePageData> {
  const nodeId = optionalUuid(event, 'node_id')
  if (!nodeId) {
    event.setHeaders({ 'cache-control': 'private, no-store' })
    const gate = await actorOf(event)
    return {
      enabled: gate.enabled,
      fact: 'auth.forbidden',
      node: null,
      caps: EMPTY_CAPS,
      shares: [],
      quota: EMPTY_QUOTA,
      downloadHref: null,
    }
  }
  const data = await loadDriveNode(event, nodeId)
  if (data.fact) return data
  if (!data.caps.canShare) return { ...data, fact: 'auth.forbidden', shares: [] }
  return data
}

/** Фильтры списка: страница-fallback модалки `drive.filters` для no-JS. */
export async function loadDriveFilters(event: RequestEvent): Promise<DriveFiltersPageData> {
  event.setHeaders({ 'cache-control': 'private, no-store' })
  const sp = event.url.searchParams
  const from = localPath(sp.get('from')) ?? '/drive'
  const fromUrl = new URL(from, 'http://local.invalid')
  // Значения фильтров приходят из адреса списка; query самой страницы может
  // уточнить их (например, после ручного GET), но `from` остаётся носителем.
  const merged = new URLSearchParams(fromUrl.searchParams)
  for (const [key, value] of sp.entries()) {
    if (key !== 'from') merged.set(key, value)
  }
  const filters = parseDriveFilters(merged)
  const values = driveFilterValues(
    {
      ord: filters.sort,
      type: filters.type,
              scope: filters.scope,
        from: filters.from ?? '',
      to: filters.to ?? '',
    },
    filters.pageSize,
  )

  const resetUrl = new URL(from, 'http://local.invalid')
  for (const key of [
    DRIVE_KEYS.sort,
    DRIVE_KEYS.type,
    DRIVE_KEYS.scope,
    DRIVE_KEYS.from,
    DRIVE_KEYS.to,
    DRIVE_KEYS.page,
    DRIVE_KEYS.size,
  ]) {
    resetUrl.searchParams.delete(key)
  }
  const resetHref = resetUrl.search
    ? `${resetUrl.pathname}${resetUrl.search}`
    : resetUrl.pathname

  const gate = await actorOf(event)
  return {
    enabled: gate.enabled,
    fact: gate.actor ? null : (gate.fact ?? 'auth.forbidden'),
    values,
    backHref: from,
    resetHref,
    scopeLocked: fromUrl.pathname === '/drive/trash',
  }
}
