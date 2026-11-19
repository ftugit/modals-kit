/**
 * Срез папки «Диска» (`plan-drive-repair.md` §3.2, §4.1).
 *
 * Один авторизованный конвейер (`authorizedEntries`) на два режима: курсорный
 * (`loadDriveSlice`, старые callers) и страничный (`loadDrivePage`, native
 * `Listing`). Режимы взаимоисключающие: `page`/`pageSize` в курсорном вызове не
 * участвуют, курсор в страничном игнорируется.
 *
 * Права проверяет `service/access.ts`; этот файл читает строки серверным
 * контекстом только после решения о доступе. Список собирается в памяти:
 * у папки редко больше сотни детей, а сортировка и курсор уже описаны чистым
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
  type DriveBreadcrumb,
  type DriveCapabilities,
  type DriveEntry,
  type DriveNodeView,
  type DriveQuotaView,
  type DriveShareRole,
  type DriveSort,
  type DriveSortDirection,
} from '#core/lib/drive/index.js'
import type { Database, Filter } from '#core/lib/db/index.js'
import type { DriveActor, DriveRouteData, DriveResult } from '../types.js'
import {
  canDriveReadAll,
  driveCaps,
  driveCrumbPath,
  driveRootCaps,
  driveSharesFor,
  resolveDriveAccess,
  DRIVE_SERVER,
} from './access.js'
import { DriveScanLimitError, readDriveRows } from './paging.js'
import { driveFail, driveOk } from './result.js'

/** Предел порции по умолчанию. */
export const DRIVE_PAGE_DEFAULT = 50

/** Верхняя граница порции: больше — уже не листинг. */
export const DRIVE_PAGE_MAX = 100

/** Предел выбранного набора: длиннее — не пикер, а выгрузка. */
export const DRIVE_IDS_MAX = 200

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
  /** Область живого диска: текущая папка или весь свой диск. */
  scope?: 'folder' | 'global'
  /** Только файлы или только папки; пусто — все узлы. */
  kind?: 'file' | 'folder'
  /** Границы изменения, миллисекунды; `null` — без границы. */
  from?: number | null
  to?: number | null
  /** Предел квоты в байтах; по умолчанию `DEFAULT_DRIVE_QUOTA_BYTES`. */
  quotaLimit?: number
  /**
   * Ограничение по выбранным узлам: отсутствует — обычный список, `[]` — явно
   * пустой набор, непустой массив — только эти узлы (ACL считается для каждого).
   */
  ids?: readonly string[] | null
}

/** Страничный режим: тот же конвейер, но окно задаёт номер страницы. */
export interface DrivePageArgs extends Omit<DriveSliceArgs, 'cursor' | 'limit'> {
  page?: number
  pageSize?: number
}

/** Результат страничного режима — проекция для нативного `Listing`. */
export interface DrivePageSlice {
  readonly folder: DriveNodeView | null
  readonly caps: DriveCapabilities
  readonly items: readonly DriveEntry[]
  readonly total: number
  readonly page: number
  readonly pageSize: number
  readonly totalPages: number
  readonly hasNext: boolean
  readonly hasPrev: boolean
  readonly breadcrumbs: readonly DriveBreadcrumb[]
  readonly quota: DriveQuotaView
  readonly sort: DriveSort
  readonly direction: DriveSortDirection
  readonly trashed: boolean
  readonly starred: boolean
  readonly search: string | null
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

/** Номер страницы: целое от 1; всё остальное — первая. */
export function drivePageNumber(value?: number | null): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1
  return Math.max(1, Math.trunc(value))
}

/** Размер по умолчанию: у имени — по возрастанию, у времени и размера — по убыванию. */
export function driveSortDefaults(sort: DriveSort): DriveSortDirection {
  return sort === 'name' ? 'asc' : 'desc'
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

/** Выбранный набор: дедупликация, порядок сохраняется, длина ограничена. */
export function driveSelectedIds(raw: readonly string[] | null | undefined): string[] | null {
  if (raw === null || raw === undefined) return null
  const out: string[] = []
  const seen = new Set<string>()
  for (const id of raw) {
    const value = typeof id === 'string' ? id.trim() : ''
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
    if (out.length >= DRIVE_IDS_MAX) break
  }
  return out
}

interface AuthorizedList {
  readonly folder: DriveNodeView | null
  readonly caps: DriveCapabilities
  readonly entries: readonly DriveEntry[]
  readonly sort: DriveSort
  readonly direction: DriveSortDirection
  readonly trashed: boolean
  readonly starred: boolean
  readonly search: string | null
}

/**
 * Авторизованный срез без окна: сортировка, фильтры и права уже применены.
 * Ошибки доступа не различают «нет узла» и «нет права» (`drive.not-found`):
 * перебор id не должен открывать чужие имена.
 */
async function authorizedEntries(
  db: Database,
  actor: DriveActor,
  args: DriveSliceArgs,
): Promise<DriveResult<AuthorizedList>> {
  const sort: DriveSort = isSort(args.sort) ? args.sort : 'name'
  const direction: DriveSortDirection = isDirection(args.direction)
    ? args.direction
    : driveSortDefaults(sort)
  const search = typeof args.search === 'string' ? args.search.trim().slice(0, DRIVE_NAME_MAX) : ''
  const trashed = args.trashed === true
  const starred = args.starred === true
  const scope = args.scope === 'global' ? 'global' : 'folder'
  const folderId = args.folderId?.trim() || null
  const selected = driveSelectedIds(args.ids)

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

  // Явно пустой набор: список пуст, но папка и крошки остаются её.
  if (selected !== null && selected.length === 0) {
    return driveOk({
      folder,
      caps,
      entries: [],
      sort,
      direction,
      trashed,
      starred,
      search: search || null,
    })
  }

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
  if (selected !== null) {
    // Выбранные узлы читаются по id в пределах своего диска: папка-источник
    // может быть любой, ACL каждого узла проверяется ниже отдельно.
    and.push({ field: 'id', op: 'in', value: selected })
  } else if (!trashed) {
    // `global` не добавляет `parent_id` только на своём живом диске. Чужая
    // папка по ссылке остаётся своим поддеревом, корзина — плоской.
    const global = scope === 'global' && ownerId === actor.id
    if (!global) {
      and.push(
        folder
          ? { field: 'parent_id', op: 'eq', value: folder.id }
          : { field: 'parent_id', op: 'isNull' },
      )
    }
  }

  let nodes: DriveNodeView[]
  try {
    nodes = await readDriveRows(db, { and })
  } catch (error) {
    if (error instanceof DriveScanLimitError) return driveFail('drive.traversal-limit')
    throw error
  }
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

  const entries: DriveEntry[] = []
  for (const node of nodes) {
    if (node.ownerId === actor.id) {
      entries.push({ node, caps: driveCaps(actor, actor.id, null) })
      continue
    }
    // Чужой узел: роль наследуется от его папок, поэтому считается доступ
    // каждого выбранного узла, а не только текущего среза.
    if (selected !== null) {
      const access = await resolveDriveAccess(db, actor, node.id)
      if (!access) continue
      entries.push({ node: access.node, caps: access.caps })
      continue
    }
    const role = strongest(parentRole, direct.get(node.id) ?? null)
    entries.push({ node, caps: driveCaps(actor, node.ownerId, role) })
  }
  entries.sort((a, b) => compareDriveEntries(a, b, sort, direction))

  return driveOk({
    folder,
    caps,
    entries,
    sort,
    direction,
    trashed,
    starred,
    search: search || null,
  })
}

function quotaLimitOf(value?: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, value)
    : DEFAULT_DRIVE_QUOTA_BYTES
}

/** Срез папки в курсорном режиме: окно задаёт непрозрачный указатель. */
export async function loadDriveSlice(
  db: Database,
  actor: DriveActor,
  args: DriveSliceArgs = {},
): Promise<DriveResult<DriveRouteData>> {
  const list = await authorizedEntries(db, actor, args)
  if (!list.ok) return driveFail(list.code)
  const limit = drivePageLimit(args.limit)
  const cursor = decodeDriveCursor(args.cursor)
  const { entries } = list.value
  const afterCursor = cursor ? entries.filter((entry) => isAfterDriveCursor(entry, cursor)) : entries
  const page = afterCursor.slice(0, limit)
  const last = page[page.length - 1]
  const nextCursor = afterCursor.length > limit && last ? driveCursorFor(last, list.value.sort, list.value.direction) : null
  const ownerId = list.value.folder?.ownerId ?? actor.id
  const used = await driveUsedBytes(db, ownerId)

  return driveOk({
    folder: list.value.folder,
    caps: list.value.caps,
    slice: {
      items: page,
      total: entries.length,
      cursor: nextCursor ? encodeDriveCursor(nextCursor) : null,
      breadcrumbs: list.value.folder ? await driveCrumbPath(db, list.value.folder) : [],
      quota: driveQuota(used, quotaLimitOf(args.quotaLimit)),
    },
    sort: list.value.sort,
    direction: list.value.direction,
    trashed: list.value.trashed,
    starred: list.value.starred,
    search: list.value.search,
  })
}

/**
 * Срез папки в страничном режиме (`?drive=N`). Итоги считаются по полному
 * разрешённому набору: фильтрация и сортировка выполнены до среза окна.
 * Страница вне диапазона — пустой массив с запрошенным номером и верными
 * итогами, а не окно под другим ключом.
 */
export async function loadDrivePage(
  db: Database,
  actor: DriveActor,
  args: DrivePageArgs = {},
): Promise<DriveResult<DrivePageSlice>> {
  const list = await authorizedEntries(db, actor, args)
  if (!list.ok) return driveFail(list.code)
  const page = drivePageNumber(args.page)
  const pageSize = drivePageLimit(args.pageSize)
  const { entries } = list.value
  const total = entries.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = (page - 1) * pageSize
  const items = entries.slice(start, start + pageSize)
  const ownerId = list.value.folder?.ownerId ?? actor.id
  const used = await driveUsedBytes(db, ownerId)

  return driveOk({
    folder: list.value.folder,
    caps: list.value.caps,
    items,
    total,
    page,
    pageSize,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
    breadcrumbs: list.value.folder ? await driveCrumbPath(db, list.value.folder) : [],
    quota: driveQuota(used, quotaLimitOf(args.quotaLimit)),
    sort: list.value.sort,
    direction: list.value.direction,
    trashed: list.value.trashed,
    starred: list.value.starred,
    search: list.value.search,
  })
}
