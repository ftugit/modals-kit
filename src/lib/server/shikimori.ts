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

/** REST-эндпоинт каталога (домен, на который переадресует shikimori.one). */
export const SHIKIMORI_API = 'https://shikimori.io/api/animes'
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
}

export type ParseOk = { ok: true; query: AnimesQuery }
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
  }
}

/** URL запроса к API — единственное место, где он собирается (и повод для кэша). */
export function buildUpstreamUrl(query: AnimesQuery): string {
  const url = new URL(SHIKIMORI_API)
  url.searchParams.set('page', String(query.page))
  url.searchParams.set('limit', String(Math.min(query.limit, SHIKIMORI_LIMIT_MAX)))
  url.searchParams.set('order', query.order ?? SHIKIMORI_ORDER)
  if (query.search) url.searchParams.set('search', query.search)
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

async function requestUpstream(url: string, query: AnimesQuery, deps: ResolvedDeps): Promise<AnimesPage> {
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
    const raw: unknown = await res.json()
    const list = Array.isArray(raw) ? raw : []
    const items = list.map(normalizeAnime).filter((card): card is AnimeCard => card !== null)
    return { items, page: query.page, limit: query.limit, hasNext: hasNextOf(items, query.limit) }
  }
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

  if (!signal) return job
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  return await new Promise<AnimesPage>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
    job.then(
      (page) => {
        signal.removeEventListener('abort', onAbort)
        resolve(page)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
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
