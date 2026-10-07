/**
 * Источник аниме-каталога Shikimori для демо пагинатора: с Shikimori API
 * разговаривает НАШ БЭКЕНД, браузер — только с бэкендом.
 *
 * Почему так: у Shikimori API нет CORS-разрешения для произвольных сайтов,
 * обязателен собственный User-Agent и действуют лимиты (≈5 запросов/с,
 * 90/мин). Прямой парсинг API из браузера (как в исходнике, который качал
 * каталог офлайн-скриптом) в порте заменён на два контура одной и той же
 * функции: сервер (SSR-лоадер и фоновый добор перехватчика) зовёт Shikimori
 * напрямую, клиент — наш эндпоинт `/api/anime` (см. `routes/api/anime`).
 *
 * Что выяснено про сам API (проверено запросами):
 * - эндпоинт `https://shikimori.io/api/graphql` (`shikimori.one` отвечает 301
 *   на `shikimori.io` — ходим сразу в целевой хост, без лишнего редиректа);
 * - СКОЛЬКО ОТДАЁТ: `limit` — от 1 до 50, больше 50 API молча урезает до 50;
 *   `page` — номер страницы от 1. Ни `totalItems`, ни заголовков с общим числом
 *   API не отдаёт, поэтому «есть ли следующая» вычисляется перезапросом на один
 *   элемент больше запрошенного (см. `animePageFromNodes`);
 * - КАК ИСКАТЬ: аргумент `search` той же выборки — подстрока по названиям
 *   (русское/латиница/синонимы) и жанрам; `order: popularity` — стабильный
 *   порядок «популярное раньше» (нужен и каталогу, и образцу словаря).
 */
import { buildTermDictionary, serializeTermDictionary } from '$lib/search/fuzzy'

export type AnimeRecord = {
  id: string
  /** Отображаемое имя: русское, иначе оригинальное. */
  title: string
  /** Синонимы/альтернативные названия — по ним же ранжирует lib search. */
  aliases: string[]
  kind?: string
  episodes?: number
  score?: number
  year?: number
  poster?: string
  url?: string
}

export type AnimeQuery = {
  page: number
  limit: number
  q?: string
}

export type AnimePage = {
  items: AnimeRecord[]
  hasNext: boolean
}

/** GraphQL-эндпоинт Shikimori (301-редирект с `shikimori.one` снимаем сразу). */
export const ANIME_ENDPOINT = 'https://shikimori.io/api/graphql'
/** Потолок `limit` самого API: больше 50 он всё равно урежет. */
export const ANIME_MAX_LIMIT = 50
/** Максимальная длина запроса (та же санитаризация, что у ключа `?page.q`). */
export const ANIME_MAX_QUERY = 120
/** Сколько страниц популярного каталога берётся в образец словаря терминов. */
export const ANIME_TERM_PAGES = 6
export const ANIME_USER_AGENT = 'modals-kit paginator demo/1.0 (SvelteKit; paginator + lib/search)'

/** Не чаще одного запроса в 220 мс (лимит API ≈5 запросов/с) — общий шлюз модуля. */
const MIN_REQUEST_GAP_MS = 220
const REQUEST_TIMEOUT_MS = 8_000
/** Короткий TTL-кэш ответов: SSR + гидратация + добор перехватчика просят одно и то же. */
const CACHE_TTL_MS = 30_000
const CACHE_MAX_ENTRIES = 200
const RETRY_ON_429 = 3
/** Артефакт словаря пересобирается редко: образец каталога меняется медленно. */
const TERMS_TTL_MS = 10 * 60_000

// ── Санитаризация и нормализация ────────────────────────────────────────────

/** Запрос из адреса — недоверенный: управляющие символы, длина, пустота. */
export function sanitizeAnimeQuery(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const value = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, ANIME_MAX_QUERY)
  return value ? value : undefined
}

/** Deny-safe нормализация входа: страница ≥ 1, `limit` — 1..50, запрос — санитаризованный. */
export function normalizeAnimeQuery(raw: { page?: unknown; limit?: unknown; q?: unknown }): AnimeQuery {
  // Отсутствие ключа/мусор («abc», null, '') → дефолт; числа ниже границы —
  // прижаты к границе, выше — к потолку (передали 0 — хотели «минимум», а не дефолт).
  const int = (value: unknown): number | undefined => {
    if (value === null || value === undefined || value === '') return undefined
    const n = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(n) ? Math.floor(n) : undefined
  }
  return {
    page: Math.max(1, int(raw.page) ?? 1),
    limit: Math.min(Math.max(1, int(raw.limit) ?? 20), ANIME_MAX_LIMIT),
    q: sanitizeAnimeQuery(raw.q),
  }
}

// ── Разбор ответа ───────────────────────────────────────────────────────────

type UnknownNode = Record<string, unknown>

const str = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)
const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

/**
 * Узел GraphQL → запись каталога. Название — русское, иначе оригинальное;
 * `aliases` — все варианты написания (по ним ранжирует lib search, и опечатки
 * в латинице/русском исправляются одним словарём).
 */
export function mapAnimeNode(node: unknown): AnimeRecord | null {
  if (!node || typeof node !== 'object') return null
  const raw = node as UnknownNode
  const id = raw.id == null ? '' : String(raw.id)
  if (!id) return null
  const russian = str(raw.russian)
  const name = str(raw.name)
  const english = str(raw.english)
  const japanese = str(raw.japanese)
  const title = russian ?? name ?? english ?? id
  const synonyms = Array.isArray(raw.synonyms)
    ? raw.synonyms.flatMap((value) => (typeof value === 'string' ? [value] : []))
    : []
  const releasedOn = raw.releasedOn && typeof raw.releasedOn === 'object' ? (raw.releasedOn as UnknownNode) : null
  const poster = raw.poster && typeof raw.poster === 'object' ? (raw.poster as UnknownNode) : null
  return {
    id,
    title,
    aliases: [...new Set([name, russian, english, japanese, ...synonyms].filter((v): v is string => !!v))],
    kind: str(raw.kind),
    episodes: num(raw.episodes),
    score: num(raw.score),
    year: releasedOn ? num(releasedOn.year) : undefined,
    poster: poster ? str(poster.mainUrl) : undefined,
    url: str(raw.url),
  }
}

/**
 * Узлы ответа → страница пагинатора. `hasNext` — по перезапросу на элемент
 * больше: пришло `limit + 1` — следующая страница есть, лишний элемент
 * отбрасывается. Общего числа у API нет, поэтому `totalItems` не отдаём
 * никогда (PageNav сам остаётся на стрелках — R12).
 */
export function animePageFromNodes(nodes: readonly unknown[], limit: number): AnimePage {
  const items = nodes.map(mapAnimeNode).filter((record): record is AnimeRecord => record !== null)
  const hasNext = items.length > limit
  return { items: hasNext ? items.slice(0, limit) : items, hasNext }
}

// ── Запрос к API ────────────────────────────────────────────────────────────

const ANIME_FIELDS = `id name russian english japanese synonyms kind status episodes score
  releasedOn { year } poster { mainUrl } url`
const QUERY = `query($page: PositiveInt!, $limit: PositiveInt!, $search: String, $order: OrderEnum) {
  animes(page: $page, limit: $limit, search: $search, order: $order) { ${ANIME_FIELDS} }
}`

/** Функция fetch — инъекция для тестов и для SvelteKit `event.fetch`. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** Общий шлюз модуля: последовательные запросы не чаще, чем разрешает API. */
let gate: Promise<unknown> = Promise.resolve()
let lastRequestAt = 0

function rateGate(fetchImpl: FetchLike, input: string, init: RequestInit): Promise<Response> {
  const run = async () => {
    const wait = Math.max(0, lastRequestAt + MIN_REQUEST_GAP_MS - Date.now())
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    try {
      return await fetchImpl(input, init)
    } finally {
      lastRequestAt = Date.now()
    }
  }
  const next = gate.then(run, run)
  // Очередь не должна пухнуть от отказов: ошибки гасим только для «следующего в очереди».
  gate = next.catch(() => undefined)
  return next
}

/** Таймаут поверх внешнего сигнала (отмена REPLACE должна доезжать до сети). */
function withTimeout(signal: AbortSignal | undefined, ms: number): { signal: AbortSignal; done(): void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('anime request timeout')), ms)
  const onAbort = () => controller.abort(signal?.reason)
  if (signal) {
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    },
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type CacheEntry = { at: number; value: AnimePage }
const pageCache = new Map<string, CacheEntry>()

/** Ответ API со статусом/ошибками; 429 (лимит) — повтор с нарастающей паузой. */
async function requestAnimePage(
  query: AnimeQuery,
  fetchImpl: FetchLike,
  external?: AbortSignal,
): Promise<AnimePage> {
  const take = Math.min(query.limit + 1, ANIME_MAX_LIMIT)
  const body = JSON.stringify({
    query: QUERY,
    variables: { page: query.page, limit: take, search: query.q, order: 'popularity' },
  })
  let lastError: Error | null = null
  for (let attempt = 0; attempt <= RETRY_ON_429; attempt++) {
    if (external?.aborted) throw new DOMException('Aborted', 'AbortError')
    const timeout = withTimeout(external, REQUEST_TIMEOUT_MS)
    let response: Response
    try {
      response = await rateGate(fetchImpl, ANIME_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': ANIME_USER_AGENT },
        body,
        signal: timeout.signal,
      })
    } catch (error) {
      timeout.done()
      if (external?.aborted) throw new DOMException('Aborted', 'AbortError')
      lastError = new Error(`Shikimori API недоступен: ${error instanceof Error ? error.message : String(error)}`)
      await sleep(500 * (attempt + 1))
      continue
    }
    timeout.done()
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after'))
      const pause = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * (attempt + 1)
      lastError = new Error('Shikimori API: превышен лимит запросов (429)')
      await sleep(pause)
      continue
    }
    if (!response.ok) {
      throw new Error(`Shikimori API ответил ${response.status}`)
    }
    const payload = (await response.json()) as { data?: { animes?: unknown[] }; errors?: { message?: string }[] }
    if (payload.errors?.length) {
      throw new Error(`Shikimori API: ${payload.errors[0]?.message ?? 'ошибка GraphQL'}`)
    }
    const nodes = payload.data?.animes
    if (!Array.isArray(nodes)) throw new Error('Shikimori API: неожиданный ответ (нет data.animes)')
    return animePageFromNodes(nodes, query.limit)
  }
  throw lastError ?? new Error('Shikimori API: запрос не удался')
}

/**
 * Страница каталога у Shikimori (только сервер): короткий TTL-кэш сглаживает
 * «SSR + гидратация + добор перехватчика», не отдавая протухшее.
 */
export async function fetchAnimePage(
  rawQuery: { page?: unknown; limit?: unknown; q?: unknown },
  opts: { fetchImpl?: FetchLike; signal?: AbortSignal } = {},
): Promise<AnimePage> {
  const query = normalizeAnimeQuery(rawQuery)
  const key = `${query.page}\u0000${query.limit}\u0000${query.q ?? ''}`
  const cached = pageCache.get(key)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value
  const value = await requestAnimePage(query, opts.fetchImpl ?? fetch, opts.signal)
  if (pageCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = [...pageCache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    if (oldest) pageCache.delete(oldest[0])
  }
  pageCache.set(key, { at: Date.now(), value })
  return value
}

// ── Изоморфный вход источника ───────────────────────────────────────────────

/**
 * Вход источника пагинатора: на сервере (SSR-лоадер, фоновый добор) — прямой
 * запрос к Shikimori, в браузере — наш бэкенд `/api/anime`. Обе ветки отдают
 * один и тот же контракт `AnimePage`.
 */
export async function loadAnimePage(
  rawQuery: { page?: unknown; limit?: unknown; q?: unknown },
  opts: { fetchImpl?: FetchLike; signal?: AbortSignal } = {},
): Promise<AnimePage> {
  if (typeof window === 'undefined') return fetchAnimePage(rawQuery, opts)
  const query = normalizeAnimeQuery(rawQuery)
  const params = new URLSearchParams({ page: String(query.page), limit: String(query.limit) })
  if (query.q) params.set('q', query.q)
  const response = await fetch(`/api/anime?${params.toString()}`, { signal: opts.signal })
  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new Error(message || `Источник аниме ответил ${response.status}`)
  }
  const payload = (await response.json()) as AnimePage
  return { items: Array.isArray(payload.items) ? payload.items : [], hasNext: !!payload.hasNext }
}

// ── Словарь терминов (артефакт для клиентской коррекции опечаток) ───────────

/**
 * Артефакт `display\tdf` из записей: по нему клиент исправляет опечатки
 * ДО сопоставления (fuzzy на сервере не выполняется никогда).
 */
export function animeTermArtifact(records: readonly AnimeRecord[]): string {
  return serializeTermDictionary(
    buildTermDictionary(records.map((record) => [record.title, ...record.aliases].join('\n'))),
  )
}

let termsCache: { at: number; text: string } | null = null

/**
 * Образец популярного каталога → артефакт словаря. Полный каталог Shikimori
 * (десятки тысяч записей) выкачивать нельзя — это и лимиты, и время; образец
 * первых страниц по популярности покрывает топовые тайтлы, ради которых
 * коррекция опечаток и нужна. Пустой результат не кэшируется.
 */
export async function getAnimeTermArtifact(opts: { fetchImpl?: FetchLike } = {}): Promise<string> {
  if (termsCache && Date.now() - termsCache.at < TERMS_TTL_MS) return termsCache.text
  const pages = await Promise.all(
    Array.from({ length: ANIME_TERM_PAGES }, (_, index) =>
      fetchAnimePage({ page: index + 1, limit: ANIME_MAX_LIMIT }, opts),
    ),
  )
  const text = animeTermArtifact(pages.flatMap((page) => page.items))
  if (text) termsCache = { at: Date.now(), text }
  return text
}

/** Только для тестов: сброс кэшей страниц и словаря (как у реестров lib). */
export function resetAnimeCaches(): void {
  pageCache.clear()
  termsCache = null
}
