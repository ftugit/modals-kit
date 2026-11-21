/**
 * Состояние пикера поверх адреса: одна точка сборки ссылок навигации/шага.
 *
 * Список и его срез живут в list-codec.ts; здесь только контекст пикера:
 * mode, step, picked, filter_owner, фильтры шага и адрес возврата.
 */
import { localPath } from '#core/lib/address/index.js'
import { DRIVE_IDS_NONE, DRIVE_KEYS } from './source.js'
import { drivePickerHref } from './routes.js'

/** Предел picked/drive.ids в query (доменный предел сервиса — 200). */
export const DRIVE_IDS_URL_MAX = 100
/** Предел сырой строки picked/drive.ids, совпадает с DRIVE_EXTRA_SEARCH.ids. */
export const DRIVE_IDS_URL_CHARS_MAX = 4000
/** Предел адреса возврата пикера. */
export const DRIVE_PICKER_FROM_MAX = 2048

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface DriveIdsUrl {
  readonly ids: readonly string[] | null
  readonly overflow: boolean
}

/**
 * Разбор среза из query: не усекает молча — 101 валидный UUID или строка
 * длиннее 4000 дают overflow и пустой набор как признак отказа.
 */
export function parseDriveIdsUrl(raw: string | null | undefined): DriveIdsUrl {
  if (raw === null || raw === undefined) return { ids: null, overflow: false }
  const value = raw.trim()
  if (!value || value === DRIVE_IDS_NONE) return { ids: [], overflow: false }
  if (value.length > DRIVE_IDS_URL_CHARS_MAX) return { ids: [], overflow: true }
  const out: string[] = []
  const seen = new Set<string>()
  for (const part of value.split(',')) {
    const item = part.trim()
    if (!UUID.test(item) || seen.has(item)) continue
    seen.add(item)
    out.push(item)
    if (out.length > DRIVE_IDS_URL_MAX) return { ids: [], overflow: true }
  }
  return { ids: out, overflow: false }
}

/** Срез → query-значение: пустой набор — явный none. */
export function encodeDriveIdsUrl(ids: readonly string[]): string {
  return ids.length > 0 ? ids.join(',') : DRIVE_IDS_NONE
}

export type DrivePickerMode = 'single' | 'multiple'
export type DrivePickerStep = 'pick' | 'chosen'
export type DriveFilterOwner = 'chosen' | null

export function parsePickerMode(raw: string | null | undefined): DrivePickerMode {
  return raw === 'multiple' ? 'multiple' : 'single'
}

/** upicks — шаг; неизвестное значение нормализуется в pick. */
export function parsePickerStep(raw: string | null | undefined): DrivePickerStep {
  return raw === 'chosen' ? 'chosen' : 'pick'
}

/** Маркер принадлежности фильтров: ровно chosen, без true/1/регистра. */
export function parseFilterOwner(raw: string | null | undefined): DriveFilterOwner {
  return raw === 'chosen' ? 'chosen' : null
}

export interface DrivePickerFilters {
  readonly q: string | null
  readonly type: 'all' | 'file' | 'folder'
  readonly from: string | null
  readonly to: string | null
}

export const EMPTY_DRIVE_PICKER_FILTERS: DrivePickerFilters = {
  q: null,
  type: 'all',
  from: null,
  to: null,
}

export interface DrivePickerState {
  readonly from: string
  readonly param: string
  readonly kind: 'any' | 'folder'
  readonly folderId: string | null
  readonly mode: DrivePickerMode
  readonly step: DrivePickerStep
  readonly picked: readonly string[]
  readonly filters: DrivePickerFilters
  readonly filterOwner: DriveFilterOwner
}

export interface DrivePickerPatch {
  readonly folderId?: string | null
  readonly step?: DrivePickerStep
  readonly picked?: readonly string[]
  readonly filters?: DrivePickerFilters
  readonly filterOwner?: DriveFilterOwner
}

/** single нормализуется: шаг только pick, набора и маркера нет. */
export function normalizePickerState(state: DrivePickerState): DrivePickerState {
  if (state.mode === 'single') {
    return { ...state, step: 'pick', picked: [], filterOwner: null }
  }
  return state
}

function hasFilters(filters: DrivePickerFilters): boolean {
  return Boolean(filters.q) || filters.type !== 'all' || Boolean(filters.from) || Boolean(filters.to)
}

function filterQuery(filters: DrivePickerFilters): URLSearchParams {
  const query = new URLSearchParams()
  if (filters.q) query.set(DRIVE_KEYS.search, filters.q)
  if (filters.type !== 'all') query.set(DRIVE_KEYS.type, filters.type)
  if (filters.from) query.set(DRIVE_KEYS.from, filters.from)
  if (filters.to) query.set(DRIVE_KEYS.to, filters.to)
  return query
}

function idsFitUrl(ids: readonly string[]): boolean {
  return ids.length <= DRIVE_IDS_URL_MAX && ids.join(',').length <= DRIVE_IDS_URL_CHARS_MAX
}

/**
 * Единственный builder ссылок «остаться в пикере»: навигация, шаг, отметка,
 * сброс. Контекст не теряется, target вызывающей страницы не меняется.
 */
export function pickerHref(state: DrivePickerState, patch: DrivePickerPatch = {}): string {
  // Обычный pick → chosen не наследует pick-фильтры: они принадлежат шагу
  // выбора. Возврат из chosen (маркер) сохраняет их как собственные.
  const entersChosen = patch.step === 'chosen' && state.step !== 'chosen'
  const filters = entersChosen && state.filterOwner !== 'chosen'
    ? EMPTY_DRIVE_PICKER_FILTERS
    : (patch.filters ?? state.filters)
  const next = normalizePickerState({
    ...state,
    ...patch,
    filters,
  })
  const base = new URL(
    drivePickerHref({
      from: next.from,
      param: next.param,
      kind: next.kind,
      folder: next.folderId,
    }),
    'http://local.invalid',
  )
  const query = base.searchParams
  const multiple = next.mode === 'multiple'
  if (multiple) query.set('mode', 'multiple')
  if (multiple && hasFilters(next.filters)) {
    for (const [key, value] of filterQuery(next.filters)) query.set(key, value)
  }
  if (multiple && next.step === 'chosen') {
    query.set('upicks', 'chosen')
    query.set(DRIVE_KEYS.ids, encodeDriveIdsUrl(next.picked))
  } else if (multiple && next.picked.length > 0 && idsFitUrl(next.picked)) {
    query.set('picked', next.picked.join(','))
  }
  if (multiple && next.step === 'pick' && next.filterOwner === 'chosen') {
    query.set('filter_owner', 'chosen')
  }
  return base.pathname + base.search + base.hash
}

/** from пикера: локальный путь, не сам пикер, не длиннее предела. */
export function pickerFrom(raw: string | null | undefined): string {
  const value = localPath(raw ?? null)
  if (!value || value.length > DRIVE_PICKER_FROM_MAX) return '/drive'
  if (value === '/drive/pick' || value.startsWith('/drive/pick?')) return '/drive'
  return value
}
