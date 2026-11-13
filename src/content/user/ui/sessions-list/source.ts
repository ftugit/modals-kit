/**
 * Источник и регистрация пагинатора списка своих устройств (`user.session.v1`).
 *
 * Один конвейер на все носители: первая порция приходит снапшотом из `load`
 * роута `/user/sessions` (тот же `load` исполняет модалка через `preloadData`),
 * следующие порции догружает этот источник — тоже через `preloadData` на
 * `/user/sessions?sessions=N`. Отдельного REST-роута у списка нет.
 *
 * Адрес пагинатора — свой базовый ключ `sessions` (`?sessions=2`,
 * `?sessions.state=expired`): подлежащая страница может жить со своими
 * параметрами, и список не спорит с ними о ключах.
 */
import { preloadData } from '$app/navigation'
import {
  createUrlAdapter,
  definePaginator,
  defineSource,
  extraField,
  hasPaginator,
  type ExtraSearchSpec,
  type PageResponse,
  type PaginatorState,
} from '#lib/paginate/index.js'
import { AUTH_MESSAGES } from '../../messages.js'
import { sessionsJournalRoute } from '../../routes.js'
import { SESSIONS_COUNTRY_NONE, type SessionDeviceView, type SessionsPage, type SessionsState, type SessionsTarget } from '../../types.js'

export const SESSIONS_NAME = 'user-sessions'
export const SESSIONS_PAGE_SIZE = 30
/** Допустимые размеры порции из формы фильтров и адреса: целое 30..100. */
export const SESSIONS_PAGE_SIZES: readonly number[] = Array.from({ length: 71 }, (_, i) => i + 30)
export const SESSIONS_PAGE_PARAM = 'sessions'

/** Ключи формы фильтров. Живут в `extra` пагинатора и в адресе. */
export const SESSIONS_FILTER_KEYS = ['state', 'net', 'country', 'cfrom', 'cto', 'sfrom', 'sto'] as const

/**
 * Цель списка — внутренний ключ `extra`, а НЕ ключ адреса. Чужой аккаунт задан
 * путём (`/user/<uuid>/sessions`); `_uid` нужен только догрузке, чтобы спросить
 * тот же путь. В `extraSearch` его нет намеренно: адресный адаптер пишет только
 * объявленные ключи, поэтому uid не засоряет URL (как `_uid` у блокировок).
 */
export const SESSIONS_INTERNAL_UID_KEY = '_uid'

/**
 * Признак общего журнала (`/sessions`) — тоже внутренний ключ `extra`:
 * догрузка порций обязана спросить `/sessions`, а не список своих, и при этом
 * не превратить адрес в `?sessions._journal=1`.
 */
export const SESSIONS_INTERNAL_JOURNAL_KEY = '_journal'

export const SESSIONS_STATES: readonly SessionsState[] = ['active', 'expired', 'all', 'revoked']

/**
 * Ключи `extra`, объявленные адресному слою (`extraSearch` URL-адаптера).
 * Проверяется только ФОРМА значений: допустимость состояния и стран решают
 * `load` и домен — умолчания в адрес не пишутся.
 */
export const SESSIONS_EXTRA_SEARCH: ExtraSearchSpec = {
  state: extraField('text', (v) => SESSIONS_STATES.includes(v as SessionsState)),
  net: extraField('text', (v) => v === '1'),
  country: extraField('text', (v) => typeof v === 'string' && v.length <= 400),
  cfrom: extraField('text', (v) => typeof v === 'string' && v.length <= 40),
  cto: extraField('text', (v) => typeof v === 'string' && v.length <= 40),
  sfrom: extraField('text', (v) => typeof v === 'string' && v.length <= 40),
  sto: extraField('text', (v) => typeof v === 'string' && v.length <= 40),
}

/** Умолчания `extra`: в адрес не пишутся — чистый URL. */
export const SESSIONS_EXTRA_DEFAULTS = {
  state: 'active',
  net: '',
  country: '',
  cfrom: '',
  cto: '',
  sfrom: '',
  sto: '',
} as const

/** Данные `load` роута описаны рядом с моделью (`types.ts`), не второй раз. */
import type { SessionsRouteData } from '../../types.js'
export type { SessionsRouteData }

/** Догрузка порции — через тот же `load`, что отдал первую (одна дверь данных). */
async function fetchSessionsPage(
  page: number,
  pageSize: number,
  input?: { q?: string; filters?: Readonly<Record<string, string>> },
): Promise<PageResponse<SessionDeviceView>> {
  const filters = input?.filters ?? {}
  const target = filters[SESSIONS_INTERNAL_UID_KEY]?.trim() || ''
  const journal = filters[SESSIONS_INTERNAL_JOURNAL_KEY] === '1'
  const q = new URLSearchParams({
    [SESSIONS_PAGE_PARAM]: String(page),
    [`${SESSIONS_PAGE_PARAM}.size`]: String(pageSize),
  })
  for (const [k, v] of Object.entries(filters)) {
    if (v && (SESSIONS_FILTER_KEYS as readonly string[]).includes(k)) q.set(`${SESSIONS_PAGE_PARAM}.${k}`, v)
  }
  const basePath = journal
    ? sessionsJournalRoute.href()
    : target
      ? `/user/${encodeURIComponent(target)}/sessions`
      : '/user/sessions'
  const r = await preloadData(`${basePath}?${q}`)
  if (r.type !== 'loaded') {
    const err = new Error('Не удалось загрузить устройства') as Error & { code: string }
    err.code = r.type === 'redirect' ? 'auth.expired' : 'load.error'
    throw err
  }
  const data = r.data as SessionsRouteData
  if (data.fact) {
    const err = new Error(AUTH_MESSAGES[data.fact] ?? 'Не удалось загрузить устройства') as Error & {
      code: string
    }
    err.code = data.fact
    throw err
  }
  const snap = data.snapshot
  if (!snap) throw new Error('Не удалось загрузить устройства')
  return {
    items: snap.pages[page] ?? [],
    totalItems: snap.totalItems ?? undefined,
    totalPages: snap.totalPages ?? undefined,
    hasNext: snap.hasNext ?? false,
  }
}

export const sessionsSource = defineSource<SessionDeviceView>({
  name: 'user_sessions',
  record: {
    id: (r) => r.id,
    title: (r) => r.deviceName ?? r.id,
    // Поиска у списка устройств нет: сужать выдачу нечем (сервер подстроку
    // по имени устройства не ищет), поэтому `search` не объявлен.
    texts: (r) => [r.deviceName ?? '', r.country ?? ''],
  },
  filters: [...SESSIONS_FILTER_KEYS, SESSIONS_INTERNAL_UID_KEY, SESSIONS_INTERNAL_JOURNAL_KEY],
  totals: true,
  data: (look, input) => fetchSessionsPage(look.page, look.pageSize, input),
})

export function ensureSessionsPaginator(): string {
  if (!hasPaginator(SESSIONS_NAME)) {
    definePaginator({
      name: SESSIONS_NAME,
      // Любой фильтр — новая выдача с первой порции.
      reloadKeys: [...SESSIONS_FILTER_KEYS, SESSIONS_INTERNAL_UID_KEY, SESSIONS_INTERNAL_JOURNAL_KEY],
      adapter: createUrlAdapter({
        name: SESSIONS_NAME,
        source: sessionsSource,
        pageSize: SESSIONS_PAGE_SIZE,
        pageSizes: SESSIONS_PAGE_SIZES,
        pageParam: SESSIONS_PAGE_PARAM,
        extraSearch: SESSIONS_EXTRA_SEARCH,
        extraDefaults: SESSIONS_EXTRA_DEFAULTS,
      }),
    })
  }
  return SESSIONS_NAME
}

export interface SessionsSnapshotExtra {
  /** Чужой аккаунт: ложится во внутренний ключ `_uid`, в адрес не пишется. */
  uid?: string | null
  /** Общий журнал: внутренний `_journal`, в адрес не пишется. */
  journal?: boolean
  state?: string | null
  net?: boolean | string | null
  country?: string | null
  cfrom?: string | null
  cto?: string | null
  sfrom?: string | null
  sto?: string | null
}

/**
 * Снапшот первой порции для `PaginatorHost`: состояние, которое хост принял бы
 * после загрузки этой страницы, но без сетевого хода — данные уже принёс `load`.
 * Весь активный срез едет в `extra`: догрузка порций видит те же фильтры.
 */
export function sessionsSnapshot(p: SessionsPage, extra?: SessionsSnapshotExtra): PaginatorState<SessionDeviceView> {
  const totalPages = Math.max(1, Math.ceil(p.total / p.pageSize))
  const out: Record<string, string> = {}
  const put = (key: keyof typeof SESSIONS_EXTRA_DEFAULTS, value: string | null | undefined) => {
    if (value && value !== SESSIONS_EXTRA_DEFAULTS[key]) out[key] = value
  }
  if (extra?.uid) out[SESSIONS_INTERNAL_UID_KEY] = extra.uid
  if (extra?.journal) out[SESSIONS_INTERNAL_JOURNAL_KEY] = '1'
  put('state', extra?.state ?? p.state)
  put('net', extra?.net === true || extra?.net === '1' || extra?.net === 'on' ? '1' : null)
  put('country', extra?.country ?? null)
  put('cfrom', extra?.cfrom ?? null)
  put('cto', extra?.cto ?? null)
  put('sfrom', extra?.sfrom ?? null)
  put('sto', extra?.sto ?? null)

  return {
    name: SESSIONS_NAME,
    page: p.page,
    pageSize: p.pageSize,
    totalItems: p.total,
    totalPages,
    extra: out,
    loadedPages: [p.page],
    pages: { [p.page]: p.items },
    status: 'idle',
    error: null,
    errorCode: null,
    pending: null,
    hasNext: p.page < totalPages,
    hasPrev: p.page > 1,
    reqId: 0,
    capabilities: sessionsSource.capabilitiesFor({}),
  }
}

/** Цель списка из явных параметров: журнал, аккаунт или свои устройства. */
export function sessionsTargetFrom(uid: string | null, journal: boolean): SessionsTarget {
  if (journal) return { kind: 'journal' }
  const id = uid?.trim().toLowerCase() || null
  return id ? { kind: 'account', uid: id } : { kind: 'own' }
}

/**
 * Цель среза страницы фильтров — явные параметры пары (`uid`, `journal`), а не
 * адрес носителя. Модалка журнала поверх чужой страницы иначе получила бы срез
 * «свои»: `from` там — адрес носителя, из него цель не разобрать.
 */
export function sessionsFiltersTarget(uid: string | null, journal: boolean): SessionsTarget {
  return sessionsTargetFrom(uid, journal)
}

/** Код страны из адреса: `none` — «без страны», иначе код из справочника. */
export function sessionsCountryCodes(csv: string | null | undefined): string[] {
  if (!csv) return []
  const out: string[] = []
  for (const raw of csv.split(',')) {
    const code = raw.trim()
    if (!code) continue
    if (code === SESSIONS_COUNTRY_NONE) out.push(code)
    else if (/^[A-Za-z0-9_-]{1,8}$/.test(code)) out.push(code.toUpperCase())
    if (out.length >= 20) break
  }
  return out
}

/** Человеческая подпись страны: словаря имён нет, показывается код. */
export function countryLabel(code: string): string {
  return code === SESSIONS_COUNTRY_NONE ? 'Неизвестно' : code
}
