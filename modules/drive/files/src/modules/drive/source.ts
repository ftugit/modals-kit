/**
 * Источник и регистрация пагинатора списка «Диска» (`plan-drive-repair.md` §4.3).
 *
 * Один конвейер на все носители: первая порция приходит снапшотом из `load`
 * списка (тот же `load` исполняет модалка через `preloadData`), следующие
 * порции в браузере догружает источник — тоже через `preloadData` на адрес
 * списка (`?drive=N`). Отдельного REST-роута у списка нет.
 *
 * Ключи `extra` (`?drive.q`, `?drive.ord`, …) объявлены один раз здесь:
 * их понимают и URL-адаптер, и `load` маршрута. Размер порции и страница —
 * ключи пагинатора (`drive`, `drive.size`).
 */
import { preloadData } from '$app/navigation'
import {
  driveListKey,
  driveListKeyFromSnapshot,
  driveListStateFromExtra,
  encodeDriveListQuery,
} from './list-codec.js'
import type { DriveSort } from '#core/lib/drive/index.js'
import {
  createUrlAdapter,
  defineListExtras,
  definePaginator,
  defineSource,
  extraField,
  hasPaginator,
  type ExtraSearchSpec,
  type PageResponse,
  type PaginatorState,
} from '#core/lib/paginate/index.js'
import type { DriveListItem, DriveListRouteData } from './types.js'
import { driveFolderRoute, driveRootRoute, driveStarredRoute, driveTrashRoute } from './routes.js'

/** Имя пагинатора списка. Одно на страницу, модалку и пикер. */
export const DRIVE_NAME = 'drive-list'
/** Базовый адресный ключ порции: `?drive=2`, `?drive.size=50`. */
export const DRIVE_PAGE_PARAM = 'drive'
export const DRIVE_PAGE_DEFAULT = 30
export const DRIVE_PAGE_SIZES = [30, 50, 100] as const

/** Внутренняя личность списка: не пишется в URL, участвует в reload и снапшоте. */
export const DRIVE_IDENTITY_KEY = '_list'
export const DRIVE_LIST_ROOT = 'root'
export const DRIVE_LIST_TRASH = 'trash'
export const DRIVE_LIST_STARRED = 'starred'

export type DriveListIdentity =
  | { readonly kind: 'root' }
  | { readonly kind: 'folder'; readonly id: string }
  | { readonly kind: 'trash' }
  | { readonly kind: 'starred' }

/** Личность папки в строковом виде (её держит `extra`). */
export function driveFolderIdentity(id: string): string {
  return `folder:${id}`
}

/** Строка `extra` → личность списка; незнакомое значение — корень. */
export function parseDriveIdentity(raw: string | null | undefined): DriveListIdentity {
  const value = typeof raw === 'string' ? raw : ''
  if (value === DRIVE_LIST_TRASH) return { kind: 'trash' }
  if (value === DRIVE_LIST_STARRED) return { kind: 'starred' }
  const match = /^folder:([0-9a-f-]{36})$/i.exec(value)
  return match?.[1] ? { kind: 'folder', id: match[1] } : { kind: 'root' }
}

/** Личность → адрес списка (носитель страницы и цель `preloadData`). */
export function driveIdentityPath(identity: DriveListIdentity): string {
  if (identity.kind === 'trash') return driveTrashRoute.href()
  if (identity.kind === 'starred') return driveStarredRoute.href()
  if (identity.kind === 'folder') return driveFolderRoute.href({ folderId: identity.id })
  return driveRootRoute.href()
}

/** Значение `extra` для личности. */
export function driveIdentityExtra(identity: DriveListIdentity): string {
  if (identity.kind === 'trash') return DRIVE_LIST_TRASH
  if (identity.kind === 'starred') return DRIVE_LIST_STARRED
  if (identity.kind === 'folder') return driveFolderIdentity(identity.id)
  return DRIVE_LIST_ROOT
}

export const DRIVE_KEYS = {
  search: 'drive.q',
  sort: 'drive.ord',
  type: 'drive.type',
  starred: 'drive.starred',
  scope: 'drive.scope',
  size: 'drive.size',
  from: 'drive.from',
  to: 'drive.to',
  ids: 'drive.ids',
  page: 'drive',
} as const

/** Ключи фильтров формы (без поиска, среза id и размера порции). */
export const DRIVE_FILTER_KEYS = ['ord', 'type', 'scope', 'from', 'to'] as const

/** `none` — явно пустой набор; UUID через запятую — ограничение выдачи. */
export const DRIVE_IDS_NONE = 'none'

/**
 * Потолок выбранного набора: `drive.ids`, `picked` и SQL `IN` совпадают на 100.
 * Больше 100 значений драйвер БД не принимает в одном `IN`, поэтому вход
 * страницы отвечает 400, а не роняет запрос в 500.
 */
export const DRIVE_IDS_MAX = 100

const DATE = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function dateOf(raw: string | null | undefined): string {
  if (!raw || !DATE.test(raw)) return ''
  return Number.isNaN(Date.parse(`${raw}T00:00:00.000Z`)) ? '' : raw
}

export type DriveListScope = 'folder' | 'global'

export interface DriveListFilters {
  readonly search: string | null
  readonly sort: DriveSort
  readonly type: 'all' | 'file' | 'folder'
  readonly scope: DriveListScope
  readonly pageSize: number
  /** `YYYY-MM-DD`; пусто — без границы. */
  readonly from: string | null
  readonly to: string | null
}

/** Разбор query: неизвестное значение откатывается к умолчанию. */
export function parseDriveFilters(params: URLSearchParams): DriveListFilters {
  const sortRaw = params.get(DRIVE_KEYS.sort)
  const sort: DriveSort = sortRaw === 'updated' || sortRaw === 'size' ? sortRaw : 'name'
  const typeRaw = params.get(DRIVE_KEYS.type)
  const type: 'all' | 'file' | 'folder' =
    typeRaw === 'file' || typeRaw === 'folder' ? typeRaw : 'all'
  const size = Number(params.get(DRIVE_KEYS.size))
  const scope: DriveListScope = params.get(DRIVE_KEYS.scope) === 'global' ? 'global' : 'folder'
  return {
    search: params.get(DRIVE_KEYS.search)?.trim() || null,
    sort,
    type,
    scope,
    pageSize: (DRIVE_PAGE_SIZES as readonly number[]).includes(size) ? size : DRIVE_PAGE_DEFAULT,
    from: dateOf(params.get(DRIVE_KEYS.from)) || null,
    to: dateOf(params.get(DRIVE_KEYS.to)) || null,
  }
}

/**
 * Срез выбранных id: отсутствие ключа — без ограничения, `none` — пустой
 * набор, иначе ограниченный список UUID (дедупликация и потолок — в сервисе).
 */
export function parseDriveIds(raw: string | null | undefined): readonly string[] | null {
  if (raw === null || raw === undefined) return null
  const value = raw.trim()
  if (!value || value === DRIVE_IDS_NONE) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of value.split(',')) {
    const item = raw.trim()
    if (!UUID.test(item) || seen.has(item)) continue
    seen.add(item)
    out.push(item)
    if (out.length >= DRIVE_IDS_MAX) break
  }
  return out
}

/** Границы выбранной даты в UTC: от начала `from` до конца `to`. */
export function driveDateRange(filters: Pick<DriveListFilters, 'from' | 'to'>): {
  from: number | null
  to: number | null
} {
  return {
    from: filters.from ? Date.parse(`${filters.from}T00:00:00.000Z`) : null,
    to: filters.to ? Date.parse(`${filters.to}T23:59:59.999Z`) : null,
  }
}

/** Активные extra-ключи среза: умолчания в адрес не пишутся. */
export function driveFilterExtras(
  filters: DriveListFilters,
  ids: readonly string[] | null = null,
): Record<string, string> {
  const extra: Record<string, string> = {}
  if (filters.search) extra.q = filters.search
  if (filters.sort !== 'name') extra.ord = filters.sort
  if (filters.type !== 'all') extra.type = filters.type
  if (filters.scope === 'global') extra.scope = 'global'
  if (filters.from) extra.from = filters.from
  if (filters.to) extra.to = filters.to
  if (ids !== null) extra.ids = ids.length > 0 ? ids.join(',') : DRIVE_IDS_NONE
  return extra
}

/** Адрес списка с фильтрами и номером страницы (ссылки без JS). */
export function driveListHref(
  pathname: string,
  filters: DriveListFilters,
  page = 1,
  ids: readonly string[] | null = null,
): string {
  const query = new URLSearchParams()
  if (page > 1) query.set(DRIVE_KEYS.page, String(page))
  if (filters.pageSize !== DRIVE_PAGE_DEFAULT) query.set(DRIVE_KEYS.size, String(filters.pageSize))
  for (const [key, value] of Object.entries(driveFilterExtras(filters, ids))) {
    query.set(`${DRIVE_PAGE_PARAM}.${key}`, value)
  }
  const text = query.toString()
  return text ? `${pathname}?${text}` : pathname
}

/** Есть ли фильтр, отличный от умолчания (для ссылки «Сбросить»). */
export function driveFiltersDirty(filters: DriveListFilters): boolean {
  return Object.keys(driveFilterExtras(filters)).length > 0
}

/**
 * Адресные ключи `extra`. Форма значений проверяется здесь; допустимость —
 * за `load` и доменом (митигация прототипа — прецедент `seed-users`).
 */
export const DRIVE_EXTRA_SEARCH: ExtraSearchSpec = {
  [DRIVE_IDENTITY_KEY]: extraField('text', (v) => typeof v === 'string' && v.length <= 64),
  q: extraField('text', (v) => typeof v === 'string' && v.length <= 255),
  ord: extraField('text', (v) => v === 'name' || v === 'updated' || v === 'size'),
  type: extraField('text', (v) => v === 'all' || v === 'file' || v === 'folder'),
  scope: extraField('text', (v) => v === 'folder' || v === 'global'),
  from: extraField('text', (v) => typeof v === 'string' && v.length <= 10),
  to: extraField('text', (v) => typeof v === 'string' && v.length <= 10),
  ids: extraField(
    'text',
    (v) => typeof v === 'string' && (v === DRIVE_IDS_NONE || /^[0-9a-f,-]{1,4000}$/i.test(v)),
  ),
}

/** Дефолты `extra`: в адрес не пишутся — чистый URL. */
export const DRIVE_EXTRA_DEFAULTS = {
  [DRIVE_IDENTITY_KEY]: DRIVE_LIST_ROOT,
  q: '',
  ord: 'name',
  type: 'all',
  scope: 'folder',
  from: '',
  to: '',
  ids: '',
} as const

/** Одно описание extra-ключей списка: отсюда выводятся `filterKeys`/`reloadKeys`. */
export const DRIVE_EXTRAS = defineListExtras({
  searchable: DRIVE_EXTRA_SEARCH,
  defaults: DRIVE_EXTRA_DEFAULTS,
})

function filtersOf(input: { q?: string; filters?: Readonly<Record<string, string>> } | undefined) {
  return input?.filters ?? {}
}

function abortError(): Error {
  const error = new Error('Запрос отменён')
  error.name = 'AbortError'
  return error
}

function loadError(code: string): Error & { code: string } {
  const error = new Error('Не удалось загрузить список') as Error & { code: string }
  error.code = code
  return error
}

/**
 * Догрузка порции — через тот же `load` списка, что отдал первую порцию.
 * `preloadData` не принимает `AbortSignal`: сигнал проверяется до и после
 * ожидания, а принадлежность ответа — по ключу списка (не по счётчику).
 */
async function fetchDrivePage(
  page: number,
  pageSize: number,
  input?: { q?: string; filters?: Readonly<Record<string, string>> },
  signal?: AbortSignal,
): Promise<PageResponse<DriveListItem>> {
  const filters = filtersOf(input)
  const decoded = driveListStateFromExtra(filters, page, pageSize)
  const state = input?.q
    ? { ...decoded, filters: { ...decoded.filters, search: input.q } }
    : decoded
  const expected = driveListKey(state)
  if (signal?.aborted) throw abortError()
  const result = await preloadData(expected)
  if (signal?.aborted) throw abortError()
  if (result.type !== 'loaded') throw loadError(result.type === 'redirect' ? 'auth.expired' : 'load.error')
  const data = result.data as DriveListRouteData
  if (data.fact) throw loadError(data.fact)
  const snapshot = data.snapshot
  if (!snapshot) throw loadError('load.error')
  if (driveListKeyFromSnapshot(snapshot) !== expected) throw loadError('drive.list-stale')
  return {
    items: snapshot.pages[page] ?? [],
    totalItems: snapshot.totalItems ?? undefined,
    totalPages: snapshot.totalPages ?? undefined,
    hasNext: snapshot.hasNext ?? false,
  }
}

export const driveSource = defineSource<DriveListItem>({
  name: 'drive_list',
  record: {
    id: (item) => item.id,
    title: (item) => item.node.name,
    texts: (item) => [item.node.name, item.node.id],
  },
  search: { minLength: 1 },
  filters: [...DRIVE_EXTRAS.filterKeys],
  totals: true,
  data: (look, input) => fetchDrivePage(look.page, look.pageSize, input, look.signal),
})

/** Регистрация пагинатора — в том же бандле, что и хост. Идемпотентно. */
export function ensureDrivePaginator(): string {
  if (!hasPaginator(DRIVE_NAME)) {
    definePaginator({
      name: DRIVE_NAME,
      reloadKeys: [...DRIVE_EXTRAS.reloadKeys],
      pageSize: DRIVE_PAGE_DEFAULT,
      adapter: createUrlAdapter({
        name: DRIVE_NAME,
        source: driveSource,
        pageSize: DRIVE_PAGE_DEFAULT,
        pageSizes: DRIVE_PAGE_SIZES,
        pageParam: DRIVE_PAGE_PARAM,
        extraSearch: DRIVE_EXTRA_SEARCH,
        extraDefaults: DRIVE_EXTRA_DEFAULTS,
      }),
    })
  }
  return DRIVE_NAME
}

/**
 * Снапшот первой порции для `Listing`: состояние, которое хост принял бы после
 * загрузки страницы, но без сетевого хода — данные уже принёс `load`.
 */
export function driveSnapshot(
  page: {
    readonly items: readonly DriveListItem[]
    readonly page: number
    readonly pageSize: number
    readonly total: number
    readonly totalPages: number
    readonly hasNext: boolean
    readonly hasPrev: boolean
  },
  identity: string,
  extra: Readonly<Record<string, string>>,
): PaginatorState<DriveListItem> {
  return {
    name: DRIVE_NAME,
    page: page.page,
    pageSize: page.pageSize,
    totalItems: page.total,
    totalPages: Math.max(1, page.totalPages),
    extra: { [DRIVE_IDENTITY_KEY]: identity, ...extra },
    loadedPages: [page.page],
    pages: { [page.page]: [...page.items] },
    status: 'idle',
    error: null,
    errorCode: null,
    pending: null,
    hasNext: page.hasNext,
    hasPrev: page.hasPrev,
    reqId: 0,
    capabilities: driveSource.capabilitiesFor({}),
  }
}
