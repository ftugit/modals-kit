/**
 * Загрузчик страниц и модалок «Диска» (`/drive`, `/drive/[folderId]`,
 * `/drive/node/[id]`, `/drive/trash`).
 *
 * Права и срез считает сервис; здесь только гейт входа и форма ответа для
 * носителя. Ответ всегда `private, no-store`: имена файлов — личные данные.
 */
import type { RequestEvent } from '@sveltejs/kit'
import type { DrivePageData, DrivePickerData, DrivePick } from '#modules/drive/types.js'
import { localPath } from '#core/lib/address/index.js'
import { DRIVE_KEYS, driveDateRange, parseDriveFilters } from '#modules/drive/source.js'
import { DRIVE_MESSAGES } from '#modules/drive/messages.js'
import { resolveDriveAccess } from '#modules/drive/service/access.js'
import { readDriveShares } from '#modules/drive/service/mutate.js'
import { loadDriveSlice } from '#modules/drive/service/query.js'
import { auth } from '#modules/user/base/service/gateway.server.js'
import { db } from '#core/server/db.server.js'

export interface DriveLoadOptions {
  folderId?: string
  nodeId?: string
  trashed?: boolean
}

const empty = (patch: Partial<DrivePageData>): DrivePageData => ({
  enabled: true,
  fact: null,
  folder: null,
  caps: { canRead: false, canWrite: false, canShare: false },
  items: [],
  breadcrumbs: [],
  quota: { used: 0, limit: 0, remaining: 0 },
  trashed: false,
  node: null,
  folders: [],
  shares: [],
  notice: null,
  pick: null,
  sort: 'name',
  search: null,
  type: 'all',
  starred: false,
  pageSize: 30,
  from: null,
  to: null,
  nextCursor: null,
  total: 0,
  paged: false,
  ...patch,
})

export async function loadDrive(
  event: RequestEvent,
  options: DriveLoadOptions = {},
  notice: string | null = null,
): Promise<DrivePageData> {
  event.setHeaders({ 'cache-control': 'private, no-store' })
  const u = auth(event)
  if (!u.enabled) return empty({ enabled: false, fact: 'auth.disabled' })
  const who = await u.actor()
  if (!who.ok) return empty({ fact: who.fact.code })
  const actor = { id: who.value.id, permissions: who.value.permissions ?? [] }
  const noticeParam = notice ?? event.url.searchParams.get('notice')
  const shownNotice = noticeParam && noticeParam in DRIVE_MESSAGES ? noticeParam : null

  if (options.nodeId) {
    const access = await resolveDriveAccess(db, actor, options.nodeId)
    if (!access) return empty({ fact: 'auth.forbidden' })
    const shares = access.caps.canShare
      ? await readDriveShares(db, actor, options.nodeId)
      : null
    return empty({
      node: access.node,
      caps: access.caps,
      shares: shares?.ok ? shares.value.shares : [],
      notice: shownNotice,
    })
  }

  const filters = parseDriveFilters(event.url.searchParams)
  const range = driveDateRange(filters)
  const cursor = event.url.searchParams.get(DRIVE_KEYS.after) || null
  const slice = await loadDriveSlice(db, actor, {
    folderId: options.folderId ?? null,
    trashed: options.trashed === true,
    sort: filters.sort,
    direction: filters.sort === 'name' ? 'asc' : 'desc',
    search: filters.search,
    kind: filters.type === 'all' ? undefined : filters.type,
    starred: filters.starred,
    from: range.from,
    to: range.to,
    cursor,
    limit: filters.pageSize,
  })
  if (!slice.ok) return empty({ fact: 'auth.forbidden' })
  const folder = slice.value.folder
  const items = slice.value.slice.items
  const crumbs = slice.value.slice.breadcrumbs.slice(0, -1)
  const folders: { id: string | null; label: string }[] = []
  // Корень чужого диска не предлагаем: перенос туда сервис всё равно отклонит.
  if (!folder || folder.ownerId === actor.id) folders.push({ id: null, label: 'Корень диска' })
  crumbs.forEach((crumb, index) => {
    folders.push({ id: crumb.id, label: crumbs.slice(0, index + 1).map((item) => item.name).join(' / ') })
  })
  for (const entry of items) {
    if (entry.node.kind === 'folder') folders.push({ id: entry.node.id, label: `↳ ${entry.node.name}` })
  }

  return empty({
    folder,
    caps: slice.value.caps,
    items,
    breadcrumbs: slice.value.slice.breadcrumbs,
    quota: slice.value.slice.quota,
    trashed: slice.value.trashed,
    folders,
    notice: shownNotice,
    pick: pickOf(event),
    sort: slice.value.sort,
    search: slice.value.search,
    type: filters.type,
    starred: slice.value.starred,
    pageSize: filters.pageSize,
    from: filters.from,
    to: filters.to,
    nextCursor: slice.value.slice.cursor,
    total: slice.value.slice.total,
    paged: cursor !== null,
  })
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

const PICKER_PARAM = /^[A-Za-z0-9_-]{1,64}$/

/** Пикер (`/drive/pick`): тот же срез плюс адрес возврата и имя параметра. */
export async function loadDrivePicker(event: RequestEvent): Promise<DrivePickerData> {
  const folderId = event.url.searchParams.get('folder')?.trim() || null
  const browse = await loadDrive(event, { folderId: folderId ?? undefined })
  const from = localPath(event.url.searchParams.get('from')) ?? '/drive'
  const rawParam = event.url.searchParams.get('param') ?? ''
  return {
    browse,
    from,
    param: PICKER_PARAM.test(rawParam) ? rawParam : 'id',
    // Набор `drive.ids` появится отдельным шагом; пока выбор одиночный.
    kind: event.url.searchParams.get('kind') === 'folder' ? 'folder' : 'any',
    folderId,
  }
}
