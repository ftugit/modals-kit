/**
 * Shikimori API — серверный транспорт живого источника каталога.
 *
 * Работает ТОЛЬКО на сервере (SvelteKit `$lib/server/*`): браузер ходит в наш
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
 *     НЕ исправляет («нарута» находит только «Нарутару») — это работа lib/search;
 *   • `order` — popularity | ranked | name | aired_on | id;
 *   • заголовков `Link`/`X-Total-Count` нет: полного числа страниц API не даёт,
 *     поэтому `hasNext` выводится из «страница заполнена целиком», а PageNav у
 *     такого источника работает стрелками (канон R12);
 *   • User-Agent обязателен — без него запросы режутся.
 *
 * Вежливость к внешнему сервису — часть контракта, а не деталь:
 *   • ответ кэшируется на `CACHE_TTL_MS` (повторный переход по страницам и
 *     переключение опций панели не долбят API заново);
 *   • запуски запросов разнесены минимум на `MIN_GAP_MS` (кэш-мисс не может
 *     устроить залп);
 *   • один повтор на 429/5xx с паузой, дальше — честная ошибка;
 *   • у каждого запроса жёсткий таймаут.
 */
import { buildTermDictionary, serializeTermDictionary } from '$lib/search/fuzzy'
import {
  SHIKIMORI_LIMIT_MAX,
  SHIKIMORI_ORDER,
  type AnimesPage,
  type AnimeCard,
} from '../../content/shikimori'

/** База REST API (домен, на который переадресует shikimori.one). */
export const SHIKIMORI_API_BASE = 'https://shikimori.io/api'
/** REST-эндпоинт каталога. */
export const SHIKIMORI_API = `${SHIKIMORI_API_BASE}/animes`
/** Сайт Shikimori — для абсолютных ссылок на тайтлы. */
export const SHIKIMORI_SITE = 'https://shikimori.one'
/** Хост, с которого отдаются постеры (`/system/animes/...`). */
export const SHIKIMORI_MEDIA = 'https://shikimori.io'

/** Максимальная длина поискового запроса, как у валидатора адреса. */
export const SHIKIMORI_SEARCH_MAX = 120
export { SHIKIMORI_LIMIT_MAX, SHIKIMORI_ORDER }

/** User-Agent обязателен: Shikimori отказывает запросам без него. */
export const SHIKIMORI_UA = 'modals-kit-demo/0.1 (+https://github.com/ftugit/modals-kit)'

const CACHE_TTL_MS = 60_000
const MIN_GAP_MS = 250
const RETRY_DELAY_MS = 1_000
const UPSTREAM_TIMEOUT_MS = 10_000
/** Сколько страниц популярности идёт в словарь коррекции первым заходом. */
const TERMS_PAGES = 6
const TERMS_TTL_MS = 60 * 60 * 1000

export class ShikimoriUpstreamError extends Error {
  status: number
  constructor(message: string, status = 502) {
    super(message)
    this.name = 'ShikimoriUpstreamError'
    this.status = status
  }
}

export type AnimesQuery = {
  page: number
  limit: number
  search?: string
  order?: string
  /** Отбор каталога (`genre_v2` — мир жанров v2: те же id, что в GraphQL). */
  genre_v2?: readonly string[]
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

export type ParseOk = { ok: true; query: AnimesQuery; filters: Record<string, unknown> }
export type ParseFail = { ok: false; error: string }

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
    if (!key.startsWith('filters.') || raw === '') continue
    if (raw.length > 400) continue
    const path = key.slice('filters.'.length)
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

// ── Кэш, троттлинг, повторы ────────────────────────────────────────────────

export type TransportDeps = {
  fetch?: typeof globalThis.fetch
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  cacheTtlMs?: number
  minGapMs?: number
}

type ResolvedDeps = Required<Pick<TransportDeps, 'fetch' | 'now' | 'sleep' | 'cacheTtlMs' | 'minGapMs'>>

function resolveDeps(deps: TransportDeps): ResolvedDeps {
  return {
    fetch: deps.fetch ?? globalThis.fetch,
    now: deps.now ?? (() => Date.now()),
    sleep: deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms))),
    cacheTtlMs: deps.cacheTtlMs ?? CACHE_TTL_MS,
    minGapMs: deps.minGapMs ?? MIN_GAP_MS,
  }
}

type CacheEntry = { at: number; value: AnimesPage }

const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<AnimesPage>>()
let lastStartedAt = 0
let startQueue: Promise<unknown> = Promise.resolve()

/** Сброс состояния транспорта (тесты; в приложении не нужен). */
export function resetShikimoriTransport(): void {
  cache.clear()
  inflight.clear()
  jsonCache.clear()
  jsonInflight.clear()
  lastStartedAt = 0
  startQueue = Promise.resolve()
}

/** Запуск задачи с соблюдением минимального зазора между обращениями к API. */
function schedule<T>(task: () => Promise<T>, deps: ResolvedDeps): Promise<T> {
  const prev = startQueue
  const run = (async () => {
    await prev.catch(() => undefined)
    const wait = Math.max(0, deps.minGapMs - (deps.now() - lastStartedAt))
    if (wait > 0) await deps.sleep(wait)
    lastStartedAt = deps.now()
    return task()
  })()
  startQueue = run.catch(() => undefined)
  return run
}

/**
 * Один GET к API: повторы на 429/5xx, таймаут, User-Agent — ОДНО место для всех
 * обращений транспорта (страницы каталога, справочники схемы, пробы).
 */
async function requestUpstreamJson(url: string, deps: ResolvedDeps): Promise<unknown> {
  for (let attempt = 0; ; attempt += 1) {
    let res: Response
    try {
      res = await deps.fetch(url, {
        headers: { 'User-Agent': SHIKIMORI_UA, accept: 'application/json' },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      })
    } catch (error) {
      throw new ShikimoriUpstreamError(`Shikimori API недоступен: ${String(error)}`, 504)
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt === 0) {
        await deps.sleep(RETRY_DELAY_MS)
        continue
      }
      throw new ShikimoriUpstreamError(`Shikimori API ответил ${res.status}`, 502)
    }
    if (!res.ok) throw new ShikimoriUpstreamError(`Shikimori API ответил ${res.status}`, 502)
    return await res.json()
  }
}

async function requestUpstream(url: string, query: AnimesQuery, deps: ResolvedDeps): Promise<AnimesPage> {
  const raw = await requestUpstreamJson(url, deps)
  const list = Array.isArray(raw) ? raw : []
  const items = list.map(normalizeAnime).filter((card): card is AnimeCard => card !== null)
  return { items, page: query.page, limit: query.limit, hasNext: hasNextOf(items, query.limit) }
}

/**
 * Страница каталога. Возвращает данные из кэша, если они моложе TTL; повторные
 * параллельные вызовы одного URL делят один запрос (single-flight).
 *
 * `signal` влияет только на ОЖИДАНИЕ этого вызова: прерывание не отменяет уже
 * запущенный общий запрос (он дозаполнит кэш и не сломает других ожидающих).
 */
export async function fetchAnimes(
  query: AnimesQuery,
  { signal, ...transport }: TransportDeps & { signal?: AbortSignal } = {},
): Promise<AnimesPage> {
  const deps = resolveDeps(transport)
  const url = buildUpstreamUrl(query)

  const hit = cache.get(url)
  if (hit && deps.now() - hit.at < deps.cacheTtlMs) {
    return { ...hit.value, cached: true }
  }

  let job = inflight.get(url)
  if (!job) {
    job = schedule(() => requestUpstream(url, query, deps), deps).then(
      (page) => {
        cache.set(url, { at: deps.now(), value: page })
        inflight.delete(url)
        return page
      },
      (error) => {
        inflight.delete(url)
        throw error
      },
    )
    inflight.set(url, job)
  }

  return await waitFor(job, signal)
}

/**
 * Ожидание общего запроса с возможностью отмены ТОЛЬКО своего ожидания:
 * прерывание не отменяет сам запрос (он дозаполнит кэш и не сломает других).
 */
async function waitFor<T>(job: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return job
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
    job.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

// ── Справочники и пробы: тот же транспорт, другая проекция ─────────────────

type JsonEntry = { at: number; value: unknown }
const jsonCache = new Map<string, JsonEntry>()
const jsonInflight = new Map<string, Promise<unknown>>()

const absoluteApiUrl = (path: string): string =>
  path.startsWith('http') ? path : `${SHIKIMORI_API_BASE}${path.startsWith('/') ? '' : '/'}${path}`

/**
 * Произвольный GET к API с той же вежливостью, что и страницы каталога: кэш по
 * адресу, один запрос на всех (single-flight), минимальный зазор между ЛЮБЫМИ
 * обращениями, повторы. Формы ответа не знает — проекцию делает вызывающий.
 * Нужен зоне схемы фильтров (живые справочники) и всему, что не страница.
 */
export async function fetchShikimoriJson<T = unknown>(
  path: string,
  { signal, ...transport }: TransportDeps & { signal?: AbortSignal } = {},
): Promise<T> {
  const deps = resolveDeps(transport)
  const url = absoluteApiUrl(path)
  const hit = jsonCache.get(url)
  if (hit && deps.now() - hit.at < deps.cacheTtlMs) return hit.value as T

  let job = jsonInflight.get(url) as Promise<T> | undefined
  if (!job) {
    job = schedule(() => requestUpstreamJson(url, deps), deps).then(
      (value) => {
        jsonCache.set(url, { at: deps.now(), value })
        jsonInflight.delete(url)
        return value as T
      },
      (error) => {
        jsonInflight.delete(url)
        throw error
      },
    )
    jsonInflight.set(url, job)
  }
  return await waitFor(job, signal)
}

/**
 * Проба API: ответ КАК ЕСТЬ, включая 4xx. Нужна там, где ошибка — это данные:
 * текст 422 перечисляет допустимые значения enum'а, и это единственный живой
 * справочник для `rating`/`duration`/`kind`/`status` (у `/constants/anime`
 * значений меньше, чем принимает сам параметр). Ответ пробы не кэшируется —
 * кэшируется её РЕЗУЛЬТАТ (схема), а повтор 429 делается здесь же.
 */
export async function probeShikimoriJson(
  path: string,
  transport: TransportDeps = {},
): Promise<{ status: number; text: string }> {
  const deps = resolveDeps(transport)
  const url = absoluteApiUrl(path)
  return await schedule(async () => {
    for (let attempt = 0; ; attempt += 1) {
      let res: Response
      try {
        res = await deps.fetch(url, {
          headers: { 'User-Agent': SHIKIMORI_UA, accept: 'application/json' },
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        })
      } catch (error) {
        throw new ShikimoriUpstreamError(`Shikimori API недоступен: ${String(error)}`, 504)
      }
      if (res.status === 429 && attempt === 0) {
        await deps.sleep(RETRY_DELAY_MS)
        continue
      }
      return { status: res.status, text: await res.text() }
    }
  }, deps)
}

// ── Словарь коррекции (fuzzy) ──────────────────────────────────────────────

let termsCache: { at: number; text: string } | null = null

/**
 * Артефакт словаря `display\tdf` из названий популярной части каталога —
 * тот же формат, что у канона (`lib/search/dictionary.ts` его и разбирает).
 * Строится из ЖИВОГО API (несколько страниц популярности), поэтому работает
 * без предварительной выгрузки каталога; кэшируется на час.
 */
export async function getTermArtifact(
  { pages = TERMS_PAGES, signal, ...transport }: TransportDeps & { pages?: number; signal?: AbortSignal } = {},
): Promise<string> {
  const deps = resolveDeps(transport)
  if (termsCache && deps.now() - termsCache.at < TERMS_TTL_MS) return termsCache.text

  const texts: string[] = []
  for (let page = 1; page <= Math.max(1, pages); page += 1) {
    const res = await fetchAnimes(
      { page, limit: SHIKIMORI_LIMIT_MAX, order: SHIKIMORI_ORDER },
      { ...transport, signal },
    )
    for (const card of res.items) texts.push(card.russian ?? card.name, card.name)
    if (!res.hasNext) break
  }
  const text = serializeTermDictionary(buildTermDictionary(texts))
  termsCache = { at: deps.now(), text }
  return text
}

/** Сброс словаря (тесты). */
export function resetTermArtifact(): void {
  termsCache = null
}
