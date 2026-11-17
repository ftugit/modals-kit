/**
 * Срез папки «Диска» (`plan-drive.md` §4.4): дети, крошки, сортировка,
 * курсор, поиск, звёздочка, корзина и квота.
 *
 * Права проверяет `service/access.ts`; этот файл читает строки серверным
 * контекстом только после решения о доступе. Список собирается в памяти:
 * у папки редко больше сотни детей, а курсор и сортировка уже описаны чистым
 * ядром (`#core/lib/drive/listing`), поэтому SQL-дубликат правила здесь не
 * заводится.
 */
import {
  compareDriveEntries,
  decodeDriveCursor,
  DEFAULT_DRIVE_QUOTA_BYTES,
  driveCursorFor,
  driveQuota,
  encodeDriveCursor,
  isAfterDriveCursor,
  DRIVE_NAME_MAX,
  DRIVE_SORTS,
  type DriveCapabilities,
  type DriveEntry,
  type DriveNodeView,
  type DriveShareRole,
  type DriveSort,
  type DriveSortDirection,
} from '#core/lib/drive/index.js'
import type { Database, Filter } from '#core/lib/db/index.js'
import { driveNode } from '../schema.js'
import type { DriveActor, DriveRouteData, DriveResult } from '../types.js'
import {
  canDriveReadAll,
  driveCaps,
  driveCrumbPath,
  driveRootCaps,
  driveSharesFor,
  resolveDriveAccess,
  toDriveNodeView,
  DRIVE_SERVER,
} from './access.js'
import { driveFail, driveOk } from './result.js'

/** Предел порции по умолчанию. */
export const DRIVE_PAGE_DEFAULT = 50

/** Верхняя граница порции: больше — уже не листинг. */
export const DRIVE_PAGE_MAX = 100

export interface DriveSliceArgs {
  /** `null` — корень диска. */
  folderId?: string | null
  sort?: DriveSort
  direction?: DriveSortDirection
  cursor?: string | null
  limit?: number
  search?: string | null
  starred?: boolean
  trashed?: boolean
  /** Только файлы или только папки; пусто — все узлы. */
  kind?: 'file' | 'folder'
  /** Границы изменения, миллисекунды; `null` — без границы. */
  from?: number | null
  to?: number | null
  /** Предел квоты в байтах; по умолчанию `DEFAULT_DRIVE_QUOTA_BYTES`. */
  quotaLimit?: number
}

const isSort = (value: unknown): value is DriveSort =>
  typeof value === 'string' && (DRIVE_SORTS as readonly string[]).includes(value)

const isDirection = (value: unknown): value is DriveSortDirection =>
  value === 'asc' || value === 'desc'

/** Предел порции: число приводится к целому и зажимается в допустимые рамки. */
export function drivePageLimit(value?: number | null): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DRIVE_PAGE_DEFAULT
  return Math.min(DRIVE_PAGE_MAX, Math.max(1, Math.trunc(value)))
}

/** Размер по умолчанию: у имени — по возрастанию, у времени и размера — по убыванию. */
export function driveSortDefaults(sort: DriveSort): DriveSortDirection {
  return sort === 'name' ? 'asc' : 'desc'
}

/**
 * Все строки среза страницами по пределу драйвера. Цикл ограничен: битые
 * данные не должны держать запрос вечно.
 */
async function readAll(db: Database, filter: Filter): Promise<DriveNodeView[]> {
  const api = db.resource(driveNode)
  const pageSize = db.limits.maxPageSize
  const out: DriveNodeView[] = []
  for (let page = 1; page <= 100; page++) {
    const rows = await api.select(DRIVE_SERVER, { filter, page, limit: pageSize })
    const list = rows as unknown as Record<string, unknown>[]
    for (const row of list) out.push(toDriveNodeView(row))
    if (list.length < pageSize) break
  }
  return out
}

/** Занятое место: логическая сумма живых файлов владельца, без учёта дедупликации. */
export async function driveUsedBytes(db: Database, ownerId: string): Promise<number> {
  const { rows } = await db.query<{ used: string }>({
    text: `SELECT COALESCE(SUM(size), 0)::text AS used FROM public.drive_node
           WHERE owner_id = $1 AND kind = 'file' AND trashed_at IS NULL`,
    values: [ownerId],
  })
  const used = Number(rows[0]?.used ?? 0)
  return Number.isFinite(used) ? used : 0
}

/** В корзине показываются только корни удалённых поддеревьев. */
function trashedRoots(nodes: readonly DriveNodeView[]): DriveNodeView[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const trashed = new Set(nodes.filter((node) => node.trashedAt !== null).map((node) => node.id))
  return nodes.filter((node) => {
    const seen = new Set<string>()
    let parentId = node.parentId
    while (parentId && !seen.has(parentId)) {
      if (trashed.has(parentId)) return false
      seen.add(parentId)
      parentId = byId.get(parentId)?.parentId ?? null
    }
    return true
  })
}

const ROLE_RANK: Record<DriveShareRole, number> = { viewer: 1, editor: 2 }

const strongest = (a: DriveShareRole | null, b: DriveShareRole | null): DriveShareRole | null => {
  if (a === null) return b
  if (b === null) return a
  return ROLE_RANK[a] >= ROLE_RANK[b] ? a : b
}

/**
 * Срез папки. Ошибки доступа не различают «нет узла» и «нет права»
 * (`drive.not-found`): перебор id не должен открывать чужие имена.
 */
export async function loadDriveSlice(
  db: Database,
  actor: DriveActor,
  args: DriveSliceArgs = {},
): Promise<DriveResult<DriveRouteData>> {
  const sort: DriveSort = isSort(args.sort) ? args.sort : 'name'
  const direction: DriveSortDirection = isDirection(args.direction)
    ? args.direction
    : driveSortDefaults(sort)
  const limit = drivePageLimit(args.limit)
  const cursor = decodeDriveCursor(args.cursor)
  const search = typeof args.search === 'string' ? args.search.trim().slice(0, DRIVE_NAME_MAX) : ''
  const trashed = args.trashed === true
  const starred = args.starred === true
  const folderId = args.folderId?.trim() || null

  let folder: DriveNodeView | null = null
  let caps: DriveCapabilities = driveRootCaps(actor)
  let ownerId = actor.id
  let parentRole: DriveShareRole | null = null

  if (folderId) {
    const access = await resolveDriveAccess(db, actor, folderId)
    if (!access) return driveFail('drive.not-found')
    folder = access.node
    caps = access.caps
    ownerId = folder.ownerId
    parentRole = access.role
    if (folder.kind !== 'folder') return driveFail('drive.not-folder')
  }
  if (!caps.canRead) return driveFail('drive.not-found')
  // Корзина — дело владельца (и аудита): чужой доступ на папку её не открывает.
  if (trashed && ownerId !== actor.id && !canDriveReadAll(actor)) return driveFail('drive.forbidden')

  const and: Filter[] = [
    { field: 'owner_id', op: 'eq', value: ownerId },
    trashed ? { field: 'trashed_at', op: 'isNotNull' } : { field: 'trashed_at', op: 'isNull' },
  ]
  if (starred) and.push({ field: 'starred', op: 'eq', value: true })
  if (args.kind === 'file' || args.kind === 'folder')
    and.push({ field: 'kind', op: 'eq', value: args.kind })
  if (typeof args.from === 'number' && Number.isFinite(args.from))
    and.push({ field: 'updated_at', op: 'gte', value: new Date(args.from).toISOString() })
  if (typeof args.to === 'number' && Number.isFinite(args.to))
    and.push({ field: 'updated_at', op: 'lte', value: new Date(args.to).toISOString() })
  if (search) and.push({ field: 'name', op: 'icontains', value: search })
  // Поиск и звёздочка — по всему своему диску; обычный листинг — дети папки.
  // На чужой (доступной по ссылке) папке искать глубже её детей не даём.
  if (!search && !starred && !trashed) {
    and.push(
      folder
        ? { field: 'parent_id', op: 'eq', value: folder.id }
        : { field: 'parent_id', op: 'isNull' },
    )
  } else if (search && folder && ownerId !== actor.id) {
    and.push({ field: 'parent_id', op: 'eq', value: folder.id })
  }

  let nodes = await readAll(db, { and })
  if (trashed) nodes = trashedRoots(nodes)

  // Прямые доступы детей читаются одной выборкой: унаследованная роль папки
  // остаётся базой, собственная выдача на ребёнка может её усилить.
  const direct = new Map<string, DriveShareRole>()
  const needsShares = ownerId !== actor.id || nodes.some((node) => node.ownerId !== actor.id)
  if (needsShares && nodes.length > 0) {
    const shares = await driveSharesFor(db, actor.id, nodes.map((node) => node.id))
    for (const share of shares) {
      const best = strongest(direct.get(share.nodeId) ?? null, share.role)
      if (best) direct.set(share.nodeId, best)
    }
  }

  const entries: DriveEntry[] = nodes.map((node) => {
    const role = node.ownerId === actor.id ? null : strongest(parentRole, direct.get(node.id) ?? null)
    return { node, caps: driveCaps(actor, node.ownerId, role) }
  })
  entries.sort((a, b) => compareDriveEntries(a, b, sort, direction))

  const afterCursor = cursor ? entries.filter((entry) => isAfterDriveCursor(entry, cursor)) : entries
  const page = afterCursor.slice(0, limit)
  const last = page[page.length - 1]
  const nextCursor = afterCursor.length > limit && last ? driveCursorFor(last, sort, direction) : null

  const used = await driveUsedBytes(db, ownerId)
  const quotaLimit =
    typeof args.quotaLimit === 'number' && Number.isFinite(args.quotaLimit)
      ? Math.max(0, args.quotaLimit)
      : DEFAULT_DRIVE_QUOTA_BYTES

  return driveOk({
    folder,
    caps,
    slice: {
      items: page,
      total: entries.length,
      cursor: nextCursor ? encodeDriveCursor(nextCursor) : null,
      breadcrumbs: folder ? await driveCrumbPath(db, folder) : [],
      quota: driveQuota(used, quotaLimit),
    },
    sort,
    direction,
    trashed,
    starred,
    search: search || null,
  })
}
