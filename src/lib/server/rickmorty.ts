/**
 * Серверная зона источника Rick and Morty (F54): две версии API — REST и
 * GraphQL — за одним контрактом страницы `CharactersPage`.
 *
 * Что здесь, кроме двух запросов:
 *   • РАЗМЕР СТРАНИЦЫ. У API он фиксирован (20) и параметра размера нет, а
 *     пагинатор демо просит 5/10/20/40. Окно `(page, limit)` переводится в
 *     одну–три страницы API и вырезается (`apiWindow`): номер страницы демо и
 *     число страниц (`count` API) остаются честными при любом размере.
 *   • ФИЛЬТРЫ — та же `lib/filters`, что у Shikimori: deny-safe отбор
 *     объявленных ключей, типы и правила формы (`validateCatalogFilterValues`),
 *     неприменённое — списком `dropped` с причиной.
 *   • ПУСТО ≠ ОШИБКА. REST на пустую выдачу отвечает 404
 *     `{"error":"There is nothing here"}`, GraphQL — `results: []` и
 *     `count: null`. Оба случая — пустая страница, а не сбой.
 *   • Ошибки сети/сервиса — `RickMortyUpstreamError` (общий слой §13.1): роут
 *     отдаёт их 502/504 с текстом, пагинатор показывает ErrorRow.
 *
 * GraphQL идёт через общий транспорт `./graphql` (кэш, single-flight, зазор,
 * повтор): этот модуль знает только документ запроса и проекцию ответа. У REST
 * тот же минимум вежливости: таймаут, User-Agent, кэш на минуту и один запрос
 * на одинаковый адрес (данные API неизменны — сервис сам отдаёт
 * `cache-control: immutable`).
 */
import {
  catalogFilterFieldNames,
  catalogFilterFormData,
  validateCatalogFilterValues,
  type CatalogFilterSchema,
} from '#lib/filters/index.js'
import { fetchGraphql, GRAPHQL_UA } from './graphql'
import { UpstreamError, upstreamFetch } from './upstream'
import {
  RICKMORTY_API_PAGE_SIZE,
  RICKMORTY_APIS,
  RICKMORTY_LIMIT_MAX,
  type CharactersPage,
  type RickMortyApi,
  type RickMortyCharacter,
} from '../../content/rickmorty'
import { RICKMORTY_FILTER_SCHEMA } from '../../content/rickmorty-filters'

export const RICKMORTY_REST = 'https://rickandmortyapi.com/api/character/'
export const RICKMORTY_GRAPHQL = 'https://rickandmortyapi.com/graphql'

/** Сбой API Rick and Morty; общий предок — `UpstreamError`. */
export class RickMortyUpstreamError extends UpstreamError {
  constructor(message: string, status = 502, options?: ErrorOptions) {
    super(message, status, options)
    this.name = 'RickMortyUpstreamError'
  }
}

/** Параметры фильтра API — одинаковые у REST (query) и GraphQL (`FilterCharacter`). */
export type RickMortyParams = Partial<Record<'name' | 'status' | 'gender' | 'species' | 'type', string>>

/** Одна страница API: сколько всего и записи этой страницы. */
type ApiPage = { count: number; results: RickMortyCharacter[] }

export type RickMortyDeps = {
  fetch?: typeof globalThis.fetch
  now?: () => number
  timeoutMs?: number
}

/* ── окно страницы ─────────────────────────────────────────────────── */

/**
 * Окно страницы демо в страницах API: какие страницы API взять и сколько
 * записей пропустить в первой. `page` — с единицы.
 */
export function apiWindow(page: number, limit: number, apiSize = RICKMORTY_API_PAGE_SIZE): { pages: number[]; skip: number } {
  const start = (page - 1) * limit
  const first = Math.floor(start / apiSize) + 1
  const last = Math.floor((start + limit - 1) / apiSize) + 1
  const pages: number[] = []
  for (let p = first; p <= last; p += 1) pages.push(p)
  return { pages, skip: start - (first - 1) * apiSize }
}

/* ── нормализация записи ───────────────────────────────────────────── */

function character(raw: unknown): RickMortyCharacter | null {
  const r = (raw ?? {}) as Record<string, unknown>
  const id = Number(r['id'])
  if (!Number.isInteger(id) || typeof r['name'] !== 'string') return null
  const text = (key: string) => (typeof r[key] === 'string' ? (r[key] as string) : '')
  return {
    id,
    name: r['name'],
    status: text('status'),
    species: text('species'),
    type: text('type'),
    gender: text('gender'),
    image: text('image'),
  }
}

const characters = (list: unknown): RickMortyCharacter[] =>
  (Array.isArray(list) ? list : []).map(character).filter((item): item is RickMortyCharacter => item !== null)

/* ── REST ──────────────────────────────────────────────────────────── */

const REST_TTL_MS = 60_000
const REST_MAX_ENTRIES = 200
const restCache = new Map<string, { at: number; value: ApiPage }>()
const restInflight = new Map<string, Promise<ApiPage>>()

/** Сброс кэша REST (тесты). */
export function resetRickMortyTransport(): void {
  restCache.clear()
  restInflight.clear()
}

export function restUrl(page: number, params: RickMortyParams): string {
  const qs = new URLSearchParams({ page: String(page) })
  for (const [key, value] of Object.entries(params)) if (value) qs.set(key, value)
  return `${RICKMORTY_REST}?${qs}`
}

async function requestRest(url: string, deps: Required<RickMortyDeps>): Promise<ApiPage> {
  let res: Response
  try {
    res = await deps.fetch(url, {
      headers: { 'User-Agent': GRAPHQL_UA, accept: 'application/json' },
      signal: AbortSignal.timeout(deps.timeoutMs),
    })
  } catch (error) {
    throw new RickMortyUpstreamError('REST API недоступен', 504, { cause: error })
  }
  // Пустая выдача у REST — 404 с телом `{"error":"There is nothing here"}`.
  if (res.status === 404) return { count: 0, results: [] }
  if (!res.ok) throw new RickMortyUpstreamError(`REST API ответил ${res.status}`, 502)
  const body = (await res.json().catch(() => null)) as { info?: { count?: unknown }; results?: unknown } | null
  if (!body || !Array.isArray(body.results)) throw new RickMortyUpstreamError('REST API: ответ без results', 502)
  return { count: Number(body.info?.count) || 0, results: characters(body.results) }
}

async function restPage(page: number, params: RickMortyParams, deps: Required<RickMortyDeps>): Promise<ApiPage> {
  const url = restUrl(page, params)
  const hit = restCache.get(url)
  if (hit && deps.now() - hit.at < REST_TTL_MS) return hit.value
  let job = restInflight.get(url)
  if (!job) {
    job = requestRest(url, deps).then(
      (value) => {
        if (restCache.size >= REST_MAX_ENTRIES) {
          const oldest = restCache.keys().next()
          if (!oldest.done) restCache.delete(oldest.value)
        }
        restCache.set(url, { at: deps.now(), value })
        restInflight.delete(url)
        return value
      },
      (error) => {
        restInflight.delete(url)
        throw error
      },
    )
    restInflight.set(url, job)
  }
  return await job
}

/* ── GraphQL ───────────────────────────────────────────────────────── */

export const CHARACTERS_DOC = `query Characters($page: Int, $filter: FilterCharacter) {
  characters(page: $page, filter: $filter) {
    info { count }
    results { id name status species type gender image }
  }
}`

async function graphqlPage(page: number, params: RickMortyParams, deps: RickMortyDeps): Promise<ApiPage> {
  return await fetchGraphql<ApiPage, { page: number; filter: RickMortyParams }>(
    {
      url: RICKMORTY_GRAPHQL,
      doc: CHARACTERS_DOC,
      variables: { page, filter: params },
      // Пустая выдача у GraphQL — `results: []` и `count: null`.
      map: (data) => {
        const list = (data as { characters?: { info?: { count?: unknown }; results?: unknown } | null }).characters
        return { count: Number(list?.info?.count) || 0, results: characters(list?.results) }
      },
    },
    deps.fetch ? { fetch: deps.fetch } : {},
  )
}

/* ── фильтры ───────────────────────────────────────────────────────── */

export type DroppedFilter = { key: string; reason: string }

/**
 * Сырые `filters.*` (адрес/extra) → параметры API и список неприменённого.
 * Порядок как у Shikimori: отбор объявленных ключей → типы и правила формы
 * (allowlist опций у выбора) → мэппинг. Ключ схемы и параметр API совпадают
 * по имени у обеих версий API — отдельной таблицы соответствий не нужно.
 */
export function rickMortyFilterParams(
  raw: Readonly<Record<string, unknown>>,
  schema: CatalogFilterSchema = RICKMORTY_FILTER_SCHEMA,
): { params: RickMortyParams; dropped: DroppedFilter[] } {
  const declared = new Set(schema.fields.flatMap(catalogFilterFieldNames))
  const dropped: DroppedFilter[] = []
  const usable: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined || value === null || value === '') continue
    if (!declared.has(key)) dropped.push({ key, reason: 'поля нет в схеме источника' })
    else usable[key] = value
  }
  const { values, errors } = validateCatalogFilterValues(schema, catalogFilterFormData(schema, usable))
  const params: RickMortyParams = {}
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string' && value && (key === 'status' || key === 'gender' || key === 'species' || key === 'type')) {
      params[key] = value
    }
  }
  // Не дошедшее до параметров не исчезает молча: причина — ошибка проверки
  // (значение вне опций выбора, слишком длинный текст) или общая формулировка.
  const reason = errors.length ? `значение не прошло проверку (${errors.join(', ')})` : 'значение вне опций схемы'
  for (const key of Object.keys(usable)) {
    if (!(key.slice('filters.'.length) in params)) dropped.push({ key, reason })
  }
  return { params, dropped }
}

/* ── страница ──────────────────────────────────────────────────────── */

/**
 * Страница персонажей — ОДИН путь для HTTP-роута и SSR-моста лоадера.
 * Страницы API окна берутся по очереди: первая уже говорит `count`, и если
 * окно за краем выдачи, остальные не запрашиваются.
 */
export async function fetchCharactersPage(
  query: {
    api: RickMortyApi
    page: number
    limit: number
    search?: string
    filters?: Readonly<Record<string, unknown>>
  },
  deps: RickMortyDeps = {},
): Promise<CharactersPage> {
  const resolved: Required<RickMortyDeps> = {
    fetch: deps.fetch ?? upstreamFetch(),
    now: deps.now ?? (() => Date.now()),
    timeoutMs: deps.timeoutMs ?? 10_000,
  }
  const { params: filterParams, dropped } = rickMortyFilterParams(query.filters ?? {})
  const params: RickMortyParams = { ...filterParams, ...(query.search ? { name: query.search } : {}) }
  const { pages, skip } = apiWindow(query.page, query.limit)

  let count = 0
  const collected: RickMortyCharacter[] = []
  for (const [index, apiPage] of pages.entries()) {
    if (index > 0 && (apiPage - 1) * RICKMORTY_API_PAGE_SIZE >= count) break
    const got = query.api === 'graphql'
      ? await graphqlPage(apiPage, params, deps.fetch ? { fetch: deps.fetch } : {})
      : await restPage(apiPage, params, resolved)
    count = got.count
    collected.push(...got.results)
  }

  const start = (query.page - 1) * query.limit
  return {
    items: collected.slice(skip, skip + query.limit),
    page: query.page,
    limit: query.limit,
    totalItems: count,
    totalPages: Math.ceil(count / query.limit),
    hasNext: start + query.limit < count,
    ...(dropped.length ? { dropped } : {}),
  }
}

/* ── разбор запроса роута ──────────────────────────────────────────── */

/** Разбор `?api=&page=&limit=&search=&filters.*=` (deny-safe). */
export function parseCharactersQuery(
  params: URLSearchParams,
):
  | { ok: true; query: { api: RickMortyApi; page: number; limit: number; search?: string; filters: Record<string, string> } }
  | { ok: false; error: string } {
  const api = params.get('api') ?? 'rest'
  if (!RICKMORTY_APIS.includes(api as RickMortyApi)) return { ok: false, error: 'api: ожидается rest или graphql' }
  const page = Number(params.get('page') ?? '1')
  if (!Number.isInteger(page) || page < 1 || page > 10_000) return { ok: false, error: 'page: целое от 1' }
  const limit = Number(params.get('limit') ?? String(RICKMORTY_API_PAGE_SIZE))
  if (!Number.isInteger(limit) || limit < 1 || limit > RICKMORTY_LIMIT_MAX)
    return { ok: false, error: `limit: целое от 1 до ${RICKMORTY_LIMIT_MAX}` }
  const search = (params.get('search') ?? '').trim().slice(0, 120)
  const filters: Record<string, string> = {}
  for (const [key, value] of params) if (key.startsWith('filters.')) filters[key] = value
  return { ok: true, query: { api: api as RickMortyApi, page, limit, ...(search ? { search } : {}), filters } }
}
