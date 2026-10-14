/**
 * Shikimori API — серверный транспорт живого источника каталога.
 *
 * Работает ТОЛЬКО на сервере (SvelteKit `#lib/server/*`): браузер ходит в наш
 * собственный эндпоинт `/api/shikimori/animes`, а тот уже напрямую дёргает
 * `https://shikimori.io/api/animes`. Так сделано сознательно (решение
 * владельца): исходник SolidHono сначала скачивал каталог в локальную карту
 * (`tooling/search/download-shikimori-map.mjs`) и «парсил» её — здесь же
 * источник, который обязан работать без выгрузки и без файла.
 *
 * Что выяснено про API (замеры 2026-10-07, REST v1):
 *   • `limit` — «сколько отдавать»; максимум 50, больше он МОЛЧА режет до 50;
 *   • `page` — с 1; страница за концом каталога отдаёт `[]` (не 404);
 *   • `search` — подстрокой по названиям (русским и романдзи); опечатки он
 *     НЕ исправляет («нарута» находит только «Нарутару») — это работа paginate/search;
 *   • `order` — popularity | ranked | name | aired_on | id;
 *   • заголовков `Link`/`X-Total-Count` нет: полного числа страниц API не даёт,
 *     поэтому `hasNext` выводится из «страница заполнена целиком», а PageNav у
 *     такого источника работает стрелками (канон R12);
 *   • User-Agent обязателен — без него запросы режутся.
 *
 * Вежливость к внешнему сервису — часть контракта, а не деталь:
 *   • ответ кэшируется на `CACHE_TTL_MS` (повторный переход по страницам и
 *     переключение опций панели не долбят API заново); память кэша ограничена
 *     `SHIKIMORI_CACHE_MAX` адресами — ключ строится из ввода пользователя
 *     (`/api/shikimori/animes`), и без потолка процесс рос бы без предела (F10);
 *   • лимит запусков к хосту, User-Agent, таймаут, повторы на 429/5xx и
 *     склейка одинаковых запросов — в `fetch` приложения (`./fetch`): лимит
 *     общий у REST и GraphQL, потому что хост один.
 * Ошибки сети — `FetchError` (`#lib/fetch`): текст для клиента, подробности в `cause`.
 */
import { buildTermDictionary, serializeTermDictionary } from '#lib/paginate/search/fuzzy.js'
import { readJson, readText, type AppFetch } from '#lib/fetch/index.js'
import type { Store } from '#lib/cache/index.js'
import { localStore } from './cache'
import { UPSTREAM_UA, upstream } from './fetch'
import { fetchGraphql } from './graphql'
import {
  SHIKIMORI_DEFAULT_API,
  SHIKIMORI_LIMIT_MAX,
  SHIKIMORI_ORDER,
  isShikimoriApi,
  type AnimesPage,
  type AnimeCard,
  type ShikimoriApi,
} from '../../content/shikimori'
import { FILTER_KEY_PREFIX } from '#lib/paginate/index.js'

/** База REST API (домен, на который переадресует shikimori.one). */
export const SHIKIMORI_API_BASE = 'https://shikimori.io/api'
/** GraphQL-эндпоинт Shikimori: для универсального транспорта это просто адрес. */
export const SHIKIMORI_GRAPHQL = 'https://shikimori.io/api/graphql'
/** REST-эндпоинт каталога. */
export const SHIKIMORI_API = `${SHIKIMORI_API_BASE}/animes`
/** Сайт Shikimori — для абсолютных ссылок на тайтлы. */
export const SHIKIMORI_SITE = 'https://shikimori.one'
/** Хост, с которого отдаются постеры (`/system/animes/...`). */
export const SHIKIMORI_MEDIA = 'https://shikimori.io'

/** Максимальная длина поискового запроса, как у валидатора адреса. */
export const SHIKIMORI_SEARCH_MAX = 120
export { SHIKIMORI_LIMIT_MAX, SHIKIMORI_ORDER }

/** User-Agent обязателен: Shikimori отказывает запросам без него (ставит `fetch` приложения). */
export const SHIKIMORI_UA = UPSTREAM_UA

const CACHE_TTL_MS = 60_000
/**
 * Потолок кэша (на каждую из двух карт: страницы и справочники). Ключ — адрес
 * запроса, собранный из ввода пользователя (поиск, фильтры, страница), так что
 * без потолка любой перебор параметров копил бы ответы до конца жизни процесса
 * (баг F10, docs/audit/crutches.md). 256 страниц × ≤50 карточек — единицы МБ.
 */
export const SHIKIMORI_CACHE_MAX = 256
/** Сколько страниц популярности идёт в словарь коррекции первым заходом. */
const TERMS_PAGES = 6
const TERMS_TTL_MS = 60 * 60 * 1000

export type AnimesQuery = {
  page: number
  limit: number
  search?: string
  order?: string
  /** Отбор каталога (`genre_v2` — мир жанров v2: те же id, что в GraphQL). Версия `mix`. */
  genre_v2?: readonly string[]
  /**
   * Жанры параметром `genre`: в REST это мир v1 (`/api/genres`, версия `rest`),
   * в GraphQL — аргумент `genre` с id жанров v2 (версия `graphql`).
   */
  genre?: readonly string[]
  studio?: readonly string[]
  kind?: string
  status?: string
  rating?: string
  duration?: string
  /** Минимальная оценка (у `score` в API только нижняя граница). */
  score?: number
  /** Диапазон лет сезона `2014_2016` (обе границы — часть формата API). */
  season?: string
}

export type ParseOk = {
  ok: true
  /** Версия API источника (`?api=`, по умолчанию {@link SHIKIMORI_DEFAULT_API}). */
  api: ShikimoriApi
  query: AnimesQuery
  filters: Record<string, unknown>
}
export type ParseFail = { ok: false; error: string }

/**
 * Версия API из адреса роута (`?api=rest|graphql|mix`). Нет параметра — версия
 * по умолчанию; незнакомое значение — ошибка 400, а не «молча mix»: запрос
 * явно просил источник, которого нет.
 */
export function parseShikimoriApi(params: URLSearchParams): { ok: true; api: ShikimoriApi } | ParseFail {
  const raw = params.get('api')
  if (raw == null || raw === '') return { ok: true, api: SHIKIMORI_DEFAULT_API }
  return isShikimoriApi(raw) ? { ok: true, api: raw } : { ok: false, error: 'api: ожидалось rest | graphql | mix' }
}

/**
 * Разбор входных параметров каталога (deny-safe): всё, что не прошло проверку,
 * либо нормализуется (page/limit/search), либо откатывается к дефолту (order).
 * `limit` НЕ ошибка при превышении — clamp до {@link SHIKIMORI_LIMIT_MAX},
 * потому что именно так ведёт себя API, и источник обязан быть честным.
 */
export function parseAnimesQuery(params: URLSearchParams): ParseOk | ParseFail {
  const raw = (key: string): string | null => {
    const v = params.get(key)
    return v == null || v === '' ? null : v
  }
  const int = (value: string | null, fallback: number): number | null => {
    if (value == null) return fallback
    const n = Number(value)
    return Number.isInteger(n) ? n : null
  }

  const api = parseShikimoriApi(params)
  if (!api.ok) return api

  const page = int(raw('page'), 1)
  if (page == null || page < 1) return { ok: false, error: 'page: ожидалось целое ≥ 1' }

  const limit = int(raw('limit'), 20)
  if (limit == null || limit < 1) return { ok: false, error: 'limit: ожидалось целое ≥ 1' }

  const searchRaw = raw('search')
  const search = searchRaw
    ? searchRaw
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .trim()
        .slice(0, SHIKIMORI_SEARCH_MAX)
    : ''

  const orderRaw = raw('order')
  const order = orderRaw && /^[a-z_]{2,16}$/.test(orderRaw) ? orderRaw : SHIKIMORI_ORDER

  return {
    ok: true,
    api: api.api,
    query: {
      page,
      limit: Math.min(limit, SHIKIMORI_LIMIT_MAX),
      ...(search ? { search } : {}),
      order,
    },
    filters: readFilterParams(params),
  }
}

/**
 * `filters.*` из адреса — как есть, но проверенные на ФОРМУ: строка (список
 * через запятую) или число для границы. Что из этого допустимо по существу,
 * решает схема (она — в зоне источника): разбор не имеет права ни пропустить
 * мусор, ни отбросить законный фильтр раньше схемы.
 */
export function readFilterParams(params: URLSearchParams): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, raw] of params.entries()) {
    if (!key.startsWith(FILTER_KEY_PREFIX) || raw === '') continue
    if (raw.length > 400) continue
    const path = key.slice(FILTER_KEY_PREFIX.length)
    // Форма ключа: `filters.<поле>` или `filters.<поле>.<режим|граница>` —
    // односегментные ключи есть у select-полей (`filters.kind`).
    if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)?$/.test(path)) continue
    if (path.endsWith('.min') || path.endsWith('.max')) {
      const num = Number(raw)
      if (Number.isFinite(num) && Math.abs(num) <= 1e9) out[key] = num
      continue
    }
    const items = raw
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item !== '' && item.length <= 120)
    if (items.length) out[key] = items.join(',')
  }
  return out
}

/** URL запроса к API — единственное место, где он собирается (и повод для кэша). */
export function buildUpstreamUrl(query: AnimesQuery): string {
  const url = new URL(SHIKIMORI_API)
  url.searchParams.set('page', String(query.page))
  url.searchParams.set('limit', String(Math.min(query.limit, SHIKIMORI_LIMIT_MAX)))
  url.searchParams.set('order', query.order ?? SHIKIMORI_ORDER)
  if (query.search) url.searchParams.set('search', query.search)
  // Фильтры каталога — ОДНИМ параметром, значения через запятую: у API «и» —
  // это список в значении, а ПОВТОР параметра значит «последний побеждает».
  // Проверено живьём 2026-10-07 (REST `/api/animes`, order=popularity):
  //   • `genre_v2=27&genre_v2=1` тождественно `genre_v2=1` (последнее значение);
  //   • `genre_v2=27,1` оставляет работы с ОБОИМИ жанрами (`27,!1` — с 27 без 1);
  //   • `studio=1,858` → пусто (работ обеих студий нет), `studio=1,!1998` —
  //     работы студии 1 без работ 1998; `studio=1&studio=858` ≡ `studio=858`.
  // Отрицание — префикс `!` у значения списка; одиночное `!id` тоже работает.
  for (const [key, value] of [
    ['genre_v2', query.genre_v2],
    ['genre', query.genre],
    ['studio', query.studio],
  ] as const) {
    if (value?.length) url.searchParams.set(key, value.join(','))
  }
  for (const [key, value] of [
    ['kind', query.kind],
    ['status', query.status],
    ['rating', query.rating],
    ['duration', query.duration],
    ['season', query.season],
  ] as const) {
    if (value) url.searchParams.set(key, value)
  }
  if (query.score !== undefined) url.searchParams.set('score', String(query.score))
  return url.toString()
}

/** Абсолютный адрес медиа/страницы: API отдаёт пути от корня. */
export function absolute(path: string | null | undefined, base: string): string | null {
  if (!path) return null
  return /^https?:\/\//.test(path) ? path : `${base}${path.startsWith('/') ? '' : '/'}${path}`
}

/** Год выхода из `aired_on` («2002-10-03» → 2002). */
export function yearOf(airedOn: unknown): number | null {
  const m = typeof airedOn === 'string' ? /^(\d{4})/.exec(airedOn) : null
  return m ? Number(m[1]) : null
}

/**
 * Одна запись API → карточка источника. Мусор (нет id/названия) отбрасывается
 * возвратом null — источник не имеет права падать на одной кривой записи.
 */
export function normalizeAnime(raw: unknown): AnimeCard | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = typeof r.id === 'number' ? r.id : Number(r.id)
  if (!Number.isInteger(id)) return null
  const name = typeof r.name === 'string' ? r.name.trim() : ''
  const russian = typeof r.russian === 'string' ? r.russian.trim() : ''
  if (!name && !russian) return null
  const image = (r.image ?? {}) as Record<string, unknown>
  const scoreNum = typeof r.score === 'number' ? r.score : Number(r.score)
  const episodes = typeof r.episodes === 'number' ? r.episodes : Number(r.episodes)
  return {
    id,
    name: name || russian,
    russian: russian || null,
    poster: absolute(typeof image.preview === 'string' ? image.preview : null, SHIKIMORI_MEDIA),
    thumb: absolute(typeof image.x48 === 'string' ? image.x48 : null, SHIKIMORI_MEDIA),
    url: absolute(typeof r.url === 'string' ? r.url : null, SHIKIMORI_SITE) ?? SHIKIMORI_SITE,
    kind: typeof r.kind === 'string' ? r.kind : 'unknown',
    score: Number.isFinite(scoreNum) && scoreNum > 0 ? scoreNum : null,
    status: typeof r.status === 'string' ? r.status : '',
    episodes: Number.isFinite(episodes) ? episodes : 0,
    year: yearOf(r.aired_on),
    airedOn: typeof r.aired_on === 'string' ? r.aired_on : null,
  }
}

/** Полная страница = вероятно есть следующая (заголовков пагинации API не даёт). */
export function hasNextOf(items: readonly unknown[], limit: number): boolean {
  return items.length >= limit
}

// ── Сеть и кэш ─────────────────────────────────────────────────────────────

/**
 * Зависимости транспорта. Сеть — `fetch` приложения (`./fetch`: лимиты хоста,
 * таймаут, повторы, склейка одинаковых запросов). Кэш — хранилище, в котором
 * транспорт берёт свои области (`localStore` по умолчанию).
 */
export type TransportDeps = {
  fetch?: AppFetch
  store?: Store
}

type Resolved = { fetch: AppFetch; pages: Store; json: Store; terms: Store }

function resolveDeps(deps: TransportDeps): Resolved {
  const root = (deps.store ?? localStore).scope('shikimori')
  return {
    fetch: deps.fetch ?? upstream,
    pages: root.scope('pages', { max: SHIKIMORI_CACHE_MAX }),
    json: root.scope('json', { max: SHIKIMORI_CACHE_MAX }),
    // Словарь на каждую версию API (rest / graphql / mix).
    terms: root.scope('terms', { max: 3 }),
  }
}

/** Сброс кэша транспорта в `localStore` (тесты; в приложении не нужен). */
export async function resetShikimoriTransport(): Promise<void> {
  await localStore.scope('shikimori').clear()
}

/** Один GET к API → JSON. Правила сети — в `fetch` приложения. */
async function requestUpstreamJson(url: string, deps: Resolved, signal?: AbortSignal): Promise<unknown> {
  return await readJson(await deps.fetch(url, { signal }))
}

/**
 * Страница каталога. Возвращает данные из кэша, если они моложе TTL; повторные
 * параллельные вызовы одного URL делят один запрос (склейка в `fetch`).
 *
 * `signal` прерывает только ЭТО ожидание: общий запрос дойдёт до конца и не
 * сломает других ожидающих.
 */
export async function fetchAnimes(
  query: AnimesQuery,
  { signal, ...transport }: TransportDeps & { signal?: AbortSignal } = {},
): Promise<AnimesPage> {
  const deps = resolveDeps(transport)
  const url = buildUpstreamUrl(query)

  const hit = await deps.pages.get<AnimesPage>(url)
  if (hit) return { ...hit, cached: true }

  const raw = await requestUpstreamJson(url, deps, signal)
  const list = Array.isArray(raw) ? raw : []
  const items = list.map(normalizeAnime).filter((card): card is AnimeCard => card !== null)
  const page: AnimesPage = { items, page: query.page, limit: query.limit, hasNext: hasNextOf(items, query.limit) }
  await deps.pages.set(url, page, CACHE_TTL_MS)
  return page
}

// ── Версия `graphql`: каталог через GraphQL ────────────────────────────────

/**
 * Аргументы GraphQL `animes(...)` и их типы (интроспекция 2026-10-13). Строки —
 * те же значения, что у REST: список через запятую — «и», `!` — «кроме».
 * `studio` у аргументов есть, но справочника студий в GraphQL нет — версия
 * `graphql` поле «Студии» не объявляет, и сюда оно не доезжает.
 */
const GRAPHQL_ARGS = {
  search: 'String',
  kind: 'AnimeKindString',
  status: 'AnimeStatusString',
  season: 'SeasonString',
  score: 'Int',
  duration: 'DurationString',
  rating: 'RatingString',
  genre: 'String',
} as const

/** Поля карточки: ровно то, что нужно `AnimeCard`. */
const GRAPHQL_CARD_FIELDS =
  'id name russian url kind score status episodes airedOn { date year } poster { previewUrl miniUrl }'

/**
 * Документ и переменные страницы каталога. В документ попадают только ЗАДАННЫЕ
 * аргументы: незаданный фильтр не едет даже `null`-ом — запрос тот же, что
 * собрал бы человек, и ключ кэша не зависит от «пустых» переменных.
 */
export function buildGraphqlAnimesRequest(query: AnimesQuery): { doc: string; variables: Record<string, unknown> } {
  const variables: Record<string, unknown> = {
    page: query.page,
    limit: Math.min(query.limit, SHIKIMORI_LIMIT_MAX),
    order: query.order ?? SHIKIMORI_ORDER,
  }
  const values: Record<keyof typeof GRAPHQL_ARGS, unknown> = {
    search: query.search || undefined,
    kind: query.kind || undefined,
    status: query.status || undefined,
    season: query.season || undefined,
    score: query.score,
    duration: query.duration || undefined,
    rating: query.rating || undefined,
    genre: query.genre?.length ? query.genre.join(',') : undefined,
  }
  const declared = ['$page: PositiveInt', '$limit: PositiveInt', '$order: OrderEnum']
  const args = ['page: $page', 'limit: $limit', 'order: $order']
  for (const [name, type] of Object.entries(GRAPHQL_ARGS) as [keyof typeof GRAPHQL_ARGS, string][]) {
    if (values[name] === undefined) continue
    variables[name] = values[name]
    declared.push(`$${name}: ${type}`)
    args.push(`${name}: $${name}`)
  }
  const doc = `query Animes(${declared.join(', ')}) {\n  animes(${args.join(', ')}) { ${GRAPHQL_CARD_FIELDS} }\n}`
  return { doc, variables }
}

/** Запись GraphQL `Anime` → карточка источника (мусор — null, как у REST). */
export function normalizeGraphqlAnime(raw: unknown): AnimeCard | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = Number(r.id)
  if (!Number.isInteger(id)) return null
  const name = typeof r.name === 'string' ? r.name.trim() : ''
  const russian = typeof r.russian === 'string' ? r.russian.trim() : ''
  if (!name && !russian) return null
  const poster = (r.poster ?? {}) as Record<string, unknown>
  const aired = (r.airedOn ?? {}) as Record<string, unknown>
  const scoreNum = typeof r.score === 'number' ? r.score : Number(r.score)
  const episodes = typeof r.episodes === 'number' ? r.episodes : Number(r.episodes)
  const date = typeof aired.date === 'string' ? aired.date : null
  return {
    id,
    name: name || russian,
    russian: russian || null,
    poster: absolute(typeof poster.previewUrl === 'string' ? poster.previewUrl : null, SHIKIMORI_MEDIA),
    thumb: absolute(typeof poster.miniUrl === 'string' ? poster.miniUrl : null, SHIKIMORI_MEDIA),
    url: absolute(typeof r.url === 'string' ? r.url : null, SHIKIMORI_SITE) ?? SHIKIMORI_SITE,
    kind: typeof r.kind === 'string' ? r.kind : 'unknown',
    score: Number.isFinite(scoreNum) && scoreNum > 0 ? scoreNum : null,
    status: typeof r.status === 'string' ? r.status : '',
    episodes: Number.isFinite(episodes) ? episodes : 0,
    year: typeof aired.year === 'number' ? aired.year : yearOf(date),
    airedOn: date,
  }
}

/**
 * Страница каталога через GraphQL. Кэш, склейка и вежливость — у
 * универсального транспорта (`./graphql`, область `graphql`): своя карта
 * страниц здесь не нужна. `cached` транспорт не сообщает — поле не ставится.
 */
export async function fetchAnimesGraphql(
  query: AnimesQuery,
  { signal, ...transport }: TransportDeps & { signal?: AbortSignal } = {},
): Promise<AnimesPage> {
  const { doc, variables } = buildGraphqlAnimesRequest(query)
  const items = await fetchGraphql(
    {
      url: SHIKIMORI_GRAPHQL,
      doc,
      variables,
      map: (data) => {
        const list = (data as { animes?: unknown }).animes
        return (Array.isArray(list) ? list : [])
          .map(normalizeGraphqlAnime)
          .filter((card): card is AnimeCard => card !== null)
      },
    },
    { ...transport, ...(signal ? { signal } : {}) },
  )
  return { items, page: query.page, limit: query.limit, hasNext: hasNextOf(items, query.limit) }
}

/**
 * Страница каталога выбранной версии: `graphql` — GraphQL, `rest` и `mix` —
 * REST `/api/animes` (у `mix` каталог REST, отличие от `rest` — в справочниках).
 */
export async function fetchCatalogPage(
  api: ShikimoriApi,
  query: AnimesQuery,
  deps: TransportDeps & { signal?: AbortSignal } = {},
): Promise<AnimesPage> {
  return api === 'graphql' ? await fetchAnimesGraphql(query, deps) : await fetchAnimes(query, deps)
}

// ── Справочники и пробы: тот же транспорт, другая проекция ─────────────────

const absoluteApiUrl = (path: string): string =>
  path.startsWith('http') ? path : `${SHIKIMORI_API_BASE}${path.startsWith('/') ? '' : '/'}${path}`

/**
 * Произвольный GET к API с тем же кэшем и той же сетью, что у страниц каталога.
 * Формы ответа не знает — проекцию делает вызывающий. Нужен зоне схемы фильтров
 * (живые справочники) и всему, что не страница.
 */
export async function fetchShikimoriJson<T = unknown>(
  path: string,
  { signal, ...transport }: TransportDeps & { signal?: AbortSignal } = {},
): Promise<T> {
  const deps = resolveDeps(transport)
  const url = absoluteApiUrl(path)
  const hit = await deps.json.get<{ value: T }>(url)
  if (hit) return hit.value
  const value = (await requestUpstreamJson(url, deps, signal)) as T
  await deps.json.set(url, { value }, CACHE_TTL_MS)
  return value
}

/**
 * Проба API: ответ КАК ЕСТЬ, включая 4xx. Нужна там, где ошибка — это данные:
 * текст 422 перечисляет допустимые значения enum'а, и это единственный живой
 * справочник для `rating`/`duration`/`kind`/`status` (у `/constants/anime`
 * значений меньше, чем принимает сам параметр). Ответ пробы не кэшируется —
 * кэшируется её РЕЗУЛЬТАТ (схема). 429 и 5xx повторяет `fetch` приложения.
 */
export async function probeShikimoriJson(
  path: string,
  { signal, ...transport }: TransportDeps & { signal?: AbortSignal } = {},
): Promise<{ status: number; text: string }> {
  const deps = resolveDeps(transport)
  const res = await deps.fetch(absoluteApiUrl(path), { signal })
  return { status: res.status, text: await readText(res, { accept: () => true }) }
}

// ── Словарь коррекции (fuzzy) ──────────────────────────────────────────────

/**
 * Артефакт словаря `display\tdf` из названий популярной части каталога —
 * тот же формат, что у канона (`paginate/search/dictionary.ts` его и разбирает).
 * Строится из ЖИВОГО API (несколько страниц популярности), поэтому работает
 * без предварительной выгрузки каталога; кэшируется на час.
 */
export async function getTermArtifact(
  {
    api = SHIKIMORI_DEFAULT_API,
    pages = TERMS_PAGES,
    signal,
    ...transport
  }: TransportDeps & { api?: ShikimoriApi; pages?: number; signal?: AbortSignal } = {},
): Promise<string> {
  const deps = resolveDeps(transport)
  // Словарь у версии свой: названия читаются тем же транспортом, что и каталог
  // версии (у `graphql` — GraphQL), чтобы версия не зависела от чужого API.
  const key = `artifact:${api}`
  const hit = await deps.terms.get<string>(key)
  if (hit !== undefined) return hit

  const texts: string[] = []
  for (let page = 1; page <= Math.max(1, pages); page += 1) {
    const res = await fetchCatalogPage(
      api,
      { page, limit: SHIKIMORI_LIMIT_MAX, order: SHIKIMORI_ORDER },
      { ...transport, ...(signal ? { signal } : {}) },
    )
    for (const card of res.items) texts.push(card.russian ?? card.name, card.name)
    if (!res.hasNext) break
  }
  const text = serializeTermDictionary(buildTermDictionary(texts))
  await deps.terms.set(key, text, TERMS_TTL_MS)
  return text
}

/** Сброс словаря (тесты). */
export async function resetTermArtifact(): Promise<void> {
  await localStore.scope('shikimori').scope('terms', { max: 3 }).clear()
}
