/**
 * Адрес списка «Диска»: ключи `drive.*`, разбор фильтров и сборка ссылок.
 *
 * Один модуль на загрузчик, форму фильтров и пагинатор: ключ, который пишет
 * форма, читает загрузчик, и наоборот. Курсор `drive.after` — не фильтр:
 * форма его не несёт, поэтому смена фильтра начинает список заново.
 */
import type { DriveSort } from '#core/lib/drive/index.js'

export const DRIVE_KEYS = {
  search: 'drive.q',
  sort: 'drive.ord',
  type: 'drive.type',
  starred: 'drive.starred',
  size: 'drive.size',
  from: 'drive.from',
  to: 'drive.to',
  after: 'drive.after',
  ids: 'drive.ids',
} as const

export const DRIVE_PAGE_SIZES = [30, 50, 100] as const
export const DRIVE_PAGE_DEFAULT = 30

export interface DriveListFilters {
  readonly search: string | null
  readonly sort: DriveSort
  readonly type: 'all' | 'file' | 'folder'
  readonly starred: boolean
  readonly pageSize: number
  /** `YYYY-MM-DD`; пусто — без нижней/верхней границы. */
  readonly from: string | null
  readonly to: string | null
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

function dateOf(raw: string | null): string | null {
  if (!raw || !DATE.test(raw)) return null
  return Number.isNaN(Date.parse(`${raw}T00:00:00.000Z`)) ? null : raw
}

/** Разбор query: неизвестное значение откатывается к умолчанию. */
export function parseDriveFilters(params: URLSearchParams): DriveListFilters {
  const sortRaw = params.get(DRIVE_KEYS.sort)
  const sort: DriveSort = sortRaw === 'updated' || sortRaw === 'size' ? sortRaw : 'name'
  const typeRaw = params.get(DRIVE_KEYS.type)
  const type: 'all' | 'file' | 'folder' =
    typeRaw === 'file' || typeRaw === 'folder' ? typeRaw : 'all'
  const size = Number(params.get(DRIVE_KEYS.size))
  return {
    search: params.get(DRIVE_KEYS.search)?.trim() || null,
    sort,
    type,
    starred: ['1', 'true'].includes(params.get(DRIVE_KEYS.starred) ?? ''),
    pageSize: (DRIVE_PAGE_SIZES as readonly number[]).includes(size) ? size : DRIVE_PAGE_DEFAULT,
    from: dateOf(params.get(DRIVE_KEYS.from)),
    to: dateOf(params.get(DRIVE_KEYS.to)),
  }
}

/** Активные фильтры строкой; умолчания в адрес не пишутся. */
export function driveFilterQuery(filters: DriveListFilters): string {
  const query = new URLSearchParams()
  if (filters.search) query.set(DRIVE_KEYS.search, filters.search)
  if (filters.type !== 'all') query.set(DRIVE_KEYS.type, filters.type)
  if (filters.sort !== 'name') query.set(DRIVE_KEYS.sort, filters.sort)
  if (filters.starred) query.set(DRIVE_KEYS.starred, '1')
  if (filters.pageSize !== DRIVE_PAGE_DEFAULT) query.set(DRIVE_KEYS.size, String(filters.pageSize))
  if (filters.from) query.set(DRIVE_KEYS.from, filters.from)
  if (filters.to) query.set(DRIVE_KEYS.to, filters.to)
  return query.toString()
}

/** Адрес списка: фильтры плюс необязательный курсор следующей порции. */
export function driveListHref(
  pathname: string,
  filters: DriveListFilters,
  cursor: string | null = null,
): string {
  const query = new URLSearchParams(driveFilterQuery(filters))
  if (cursor) query.set(DRIVE_KEYS.after, cursor)
  const text = query.toString()
  return text ? `${pathname}?${text}` : pathname
}

/** Есть ли фильтр, отличный от умолчания (для ссылки «Сбросить»). */
export function driveFiltersDirty(filters: DriveListFilters): boolean {
  return driveFilterQuery(filters) !== ''
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
