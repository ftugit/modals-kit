/**
 * Единый codec состояния списка drive: URL ⇄ extra ⇄ адрес.
 *
 * Codec не знает про `picked`, `param` и `Apply` — это состояние пикера.
 * Он умеет только список: identity, фильтры, срез `ids`, страницу и размер.
 */
import {
  DRIVE_KEYS,
  driveFilterExtras,
  driveIdentityPath,
  driveListHref,
  parseDriveFilters,
  parseDriveIdentity,
  parseDriveIds,
  type DriveListFilters,
  type DriveListIdentity,
} from './source.js'

export type DriveListFilterFields = Omit<DriveListFilters, 'pageSize'>

export interface DriveListState {
  readonly identity: DriveListIdentity
  readonly filters: DriveListFilterFields
  readonly ids: readonly string[] | null
  readonly page: number
  readonly pageSize: number
}

export interface DriveListDecode {
  readonly state: DriveListState
  readonly idsOverflow: boolean
}

export interface DriveListOverrides {
  readonly ids?: readonly string[]
  readonly page?: number
  readonly pageSize?: number
}

const pageOf = (raw: string | null): number => {
  const value = Number(raw)
  return Number.isFinite(value) && value >= 1 ? Math.trunc(value) : 1
}

function splitFilters(filters: DriveListFilters): {
  fields: DriveListFilterFields
  pageSize: number
} {
  const { pageSize, ...fields } = filters
  return { fields, pageSize }
}

function joinFilters(state: DriveListState): DriveListFilters {
  return { ...state.filters, pageSize: state.pageSize }
}

/** Единственный вход из URL: фильтры, срез и страница. */
export function decodeDriveList(
  params: URLSearchParams,
  identity: DriveListIdentity,
): DriveListDecode {
  const { fields, pageSize } = splitFilters(parseDriveFilters(params))
  return {
    state: {
      identity,
      filters: fields,
      ids: parseDriveIds(params.get(DRIVE_KEYS.ids)),
      page: pageOf(params.get(DRIVE_KEYS.page)),
      pageSize,
    },
    idsOverflow: false,
  }
}

/** Единственная точка наложения override: `[]` — явный пустой срез, а не «нет среза». */
export function resolveDriveList(state: DriveListState, overrides: DriveListOverrides = {}): DriveListDecode {
  return {
    state: {
      ...state,
      ids: overrides.ids !== undefined ? [...overrides.ids] : state.ids,
      page: overrides.page ?? state.page,
      pageSize: overrides.pageSize ?? state.pageSize,
    },
    idsOverflow: false,
  }
}

/** Активные extra-ключи без identity и без `_list`. */
export function encodeDriveListExtra(state: DriveListState): Record<string, string> {
  return driveFilterExtras(joinFilters(state), state.ids)
}

/** URL-проекция состояния: только активные ключи, умолчания не пишутся. */
export function encodeDriveListQuery(state: DriveListState): URLSearchParams {
  const href = driveListHref(driveIdentityPath(state.identity), joinFilters(state), state.page, state.ids)
  const index = href.indexOf('?')
  return new URLSearchParams(index >= 0 ? href.slice(index + 1) : '')
}

/** Адрес списка из состояния; путь выводится только из identity. */
export function driveListStateHref(state: DriveListState): string {
  const query = encodeDriveListQuery(state).toString()
  const path = driveIdentityPath(state.identity)
  return query ? `${path}?${query}` : path
}

/**
 * Ключ принадлежности ответа: identity + активные фильтры + срез + страница.
 * Не заменяет `reqId` ядра, а ловит чужой/закешированный снапшот.
 */
export function driveListKey(state: DriveListState): string {
  return driveListStateHref(state)
}

/** Тот же ключ из снапшота: второй формат ключа не заводится. */
export function driveListKeyFromSnapshot(snapshot: {
  readonly extra: Readonly<Record<string, string | number | boolean | null>>
  readonly page: number
  readonly pageSize: number
}): string {
  const extra: Record<string, string> = {}
  for (const [key, value] of Object.entries(snapshot.extra)) {
    if (typeof value === 'string') extra[key] = value
  }
  const state = driveListStateFromExtra(extra, snapshot.page, snapshot.pageSize)
  return driveListKey(state)
}

/** Обратный вход: `snapshot.extra` → состояние (для `fetchDrivePage` и ссылок). */
export function driveListStateFromExtra(
  extra: Readonly<Record<string, string>>,
  page: number,
  pageSize: number,
  identity?: DriveListIdentity,
): DriveListState {
  const params = new URLSearchParams()
  const keys: Record<string, string> = {
    q: DRIVE_KEYS.search,
    ord: DRIVE_KEYS.sort,
    type: DRIVE_KEYS.type,
    scope: DRIVE_KEYS.scope,
    from: DRIVE_KEYS.from,
    to: DRIVE_KEYS.to,
    ids: DRIVE_KEYS.ids,
  }
  for (const [source, target] of Object.entries(keys)) {
    const value = extra[source]
    if (value !== undefined) params.set(target, value)
  }
  const { fields } = splitFilters(parseDriveFilters(params))
  return {
    identity: extra._list ? parseDriveIdentity(extra._list) : (identity ?? { kind: 'root' }),
    filters: fields,
    ids: parseDriveIds(extra.ids ?? null),
    page: page >= 1 ? Math.trunc(page) : 1,
    pageSize,
  }
}
