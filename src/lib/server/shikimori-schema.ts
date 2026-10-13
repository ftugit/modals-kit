/**
 * Схема фильтров Shikimori — в зоне ответственности ИСТОЧНИКА, на сервере.
 *
 * Схем ТРИ — по версии API источника (`ShikimoriApi`, решение владельца, ход 85):
 *
 *   версия   жанры                      студии          enum'ы          частоты
 *   ───────  ─────────────────────────  ──────────────  ──────────────  ──────────────
 *   rest     REST `/genres` (v1, 46)    REST `/studios` проба REST 422  нет
 *   graphql  GraphQL `genres` (v2)      ПОЛЯ НЕТ        проба GraphQL   выборка GraphQL
 *   mix      GraphQL `genres` (v2)      REST `/studios` проба REST 422  выборка GraphQL
 *
 * Что здесь и почему именно здесь:
 *   • СОСТАВ полей приходит общим объявлением (`content/shikimori-filters`):
 *     ключи и режимы — контракт имён, один на клиент и сервер; у `graphql`
 *     нет «Студий» — в GraphQL нет их справочника (вариант «c», ход 96);
 *   • ЗНАЧЕНИЯ читаются живьём из справочников API: жанры v2 — GraphQL
 *     (`genres(entryType: Anime)`; в REST справочника v2 нет вовсе), жанры v1
 *     — REST `/genres`, студии — REST (`/studios`, 1933 записи), enum'ы
 *     (тип/статус/рейтинг/длительность) — из текста ошибки: API сам
 *     перечисляет допустимые значения, и его список ШИРЕ, чем
 *     `/constants/anime` (там нет `tv_13`, `latest`) и чем описания типов
 *     GraphQL (там нет `latest`, зато есть `ova/ona`, который API отвергает);
 *   • ЧАСТОТЫ опций — из выборки популярной части каталога (несколько
 *     страниц GraphQL): по ним `capCatalogFilterOptions` ставит частые студии
 *     первыми — первые 200 и есть список без JS, и без частот «Wit Studio»
 *     могла бы в него не попасть. С JS едут и ищутся все студии. У `rest`
 *     частот нет: в списке REST `/animes` нет ни жанров, ни студий, а запрос
 *     на каждый тайтл — сотни запросов ради порядка. Порядок там — порядок
 *     справочника;
 *   • СВЯЗКИ (что нельзя сочетать) объявлены здесь же: это знание об API,
 *     измеренное живьём (`probes-shiki/`), а не о разметке;
 *   • СТАБИЛЬНОСТЬ: собранная схема кэшируется с меткой `builtAt` и обновляется
 *     по TTL; сборка одна на всех (single-flight) — «ровно один обновляющий
 *     запрос» обеспечивает транспорт, а не удачное совпадение;
 *   • если обновление упало, отдаём ПРЕДЫДУЩУЮ схему (её `builtAt` честно
 *     говорит, когда она собрана) — интерфейс не остаётся без фильтров из-за
 *     одной сетевой ошибки. Первая сборка без кэша падает честной ошибкой.
 *
 * Клиент схему НЕ вычисляет: он забирает готовую роутом `/api/shikimori/filters`.
 */
import {
  capCatalogFilterOptions,
  validateCatalogFilterSchema,
  type CatalogFilterField,
  type CatalogFilterOption,
  type CatalogFilterRule,
  type CatalogFilterSchema,
} from '#lib/filters/index.js'
import {
  SHIKIMORI_FILTER_SCHEMA_VERSION,
  shikimoriFilterSchemaSkeleton,
  shikimoriFilterSource,
} from '../../content/shikimori-filters'
import { SHIKIMORI_APIS, SHIKIMORI_DEFAULT_API, type ShikimoriApi } from '../../content/shikimori'
import type { Store } from '#lib/cache/index.js'
import { localStore } from './cache'
import { DEV } from 'esm-env'
import { fetchGraphql } from './graphql'
import {
  SHIKIMORI_GRAPHQL,
  fetchShikimoriJson,
  probeShikimoriJson,
  type TransportDeps,
} from './shikimori'
import { FetchError, readText } from '#lib/fetch/index.js'
import { upstream } from './fetch'

export { SHIKIMORI_GRAPHQL }

/** Как долго живёт собранная схема (n минут): после — обновляется при запросе. */
export const SHIKIMORI_SCHEMA_TTL_MS = 30 * 60 * 1000

/** Сколько страниц популярности идёт в частоты опций (выборка, не весь каталог). */
export const SHIKIMORI_SCHEMA_SAMPLE_PAGES = 3

/** Нижняя граница года в форме: у API нет открытого диапазона (`season=2014_` → 422). */
export const SHIKIMORI_YEAR_FLOOR = 1900

/**
 * Связки схемы — то, что в каталоге НЕЛЬЗЯ сочетать. Обе измерены живьём:
 *   • `status=latest` + `search` → пустая выдача (проверено дважды, в том числе
 *     с другими фильтрами) — поиск под «последними добавленными» не работает;
 *   • у анонсов оценки нет ВООБЩЕ (у всех 10 проверенных `score: 0.0`), поэтому
 *     фильтр по оценке с ними всегда даёт пусто — он не применяется.
 */
export const SHIKIMORI_FILTER_RULES: readonly CatalogFilterRule[] = [
  {
    id: 'search-with-latest',
    when: [{ field: 'status', value: 'latest' }],
    drop: 'q',
    reason: 'С «последними добавленными» поиск не работает: API отдаёт пустую выдачу.',
  },
  {
    id: 'score-with-anons',
    when: [{ field: 'status', value: 'anons' }],
    drop: { field: 'score' },
    reason: 'У анонсов нет оценки — выдача с оценкой всегда будет пустой.',
  },
]

/** Подписи enum-значений (значения — данные API, подписи — представление). */
const KIND_LABELS: Record<string, string> = {
  tv: 'TV',
  movie: 'фильм',
  ova: 'OVA',
  ona: 'ONA',
  special: 'спешл',
  tv_special: 'TV-спешл',
  music: 'клип',
  pv: 'промо',
  cm: 'реклама',
  tv_13: 'TV, 13 эпизодов',
  tv_24: 'TV, 24 эпизода',
  tv_48: 'TV, 48 эпизодов',
}
const STATUS_LABELS: Record<string, string> = {
  anons: 'анонс',
  ongoing: 'онгоинг',
  released: 'вышел',
  latest: 'последние добавленные',
}
const RATING_LABELS: Record<string, string> = {
  none: 'без рейтинга',
  g: 'G — все возрасты',
  pg: 'PG — дети',
  pg_13: 'PG-13 — с 13 лет',
  r: 'R — с 17 лет',
  r_plus: 'R+ — с 17 лет (мягкий)',
  rx: 'Rx — 18+',
}
const DURATION_LABELS: Record<string, string> = {
  S: 'до 10 минут',
  D: 'до 30 минут',
  F: 'больше 30 минут',
}

type EnumName = 'kind' | 'status' | 'rating' | 'duration'

const ENUM_LABELS: Record<EnumName, Record<string, string>> = {
  kind: KIND_LABELS,
  status: STATUS_LABELS,
  rating: RATING_LABELS,
  duration: DURATION_LABELS,
}

/** Что прочитано живьём: значения справочников + частоты по выборке каталога. */
export type ShikimoriRefs = {
  genres: readonly { id: string; label: string }[]
  /** Студии; у версии `graphql` справочника нет — пусто (и поля в схеме нет). */
  studios: readonly { id: string; label: string }[]
  enums: Record<EnumName, readonly string[]>
  /** Частота значения в популярной выборке: `<ключ поля>:<id>` → сколько раз. */
  counts: ReadonlyMap<string, number>
  /** Самый новый год каталога (верхняя граница «Года»). */
  newestYear: number
}

/* ── Запросы к живому API ────────────────────────────────────────────────── */

const GENRES_DOC = `query Genres {
  genres(entryType: Anime) { id name russian kind }
}`

const NEWEST_DOC = `query Newest {
  animes(limit: 1, order: aired_on) { airedOn { year } }
}`

/** Выборка версии `graphql`: только жанры — студий у этой версии нет. */
const SAMPLE_GENRES_DOC = `query Sample($page: PositiveInt, $limit: PositiveInt, $order: OrderEnum) {
  animes(page: $page, limit: $limit, order: $order) {
    genres { id }
  }
}`

const SAMPLE_DOC = `query Sample($page: PositiveInt, $limit: PositiveInt, $order: OrderEnum) {
  animes(page: $page, limit: $limit, order: $order) {
    genres { id }
    studios { id }
  }
}`

/**
 * Разбор текста 422: API перечисляет допустимые значения либо как
 * `included_in?([:a, :b])`, либо списком `<code>…</code>` — оба вида
 * встречаются у разных параметров. Понимаем оба, третий вид — ошибка.
 */
export function parseEnumMessage(text: string): string[] {
  let message = text
  try {
    const parsed: unknown = JSON.parse(text)
    if (Array.isArray(parsed)) message = parsed.join(' | ')
  } catch {
    // не JSON — берём текст как есть
  }
  const included = /included_in\?\(\[([^\]]*)\]/.exec(message)
  if (included) {
    return included[1]
      .split(',')
      .map((item) => item.trim().replace(/^:/, ''))
      .filter(Boolean)
  }
  return [...message.matchAll(/<code>([^<]+)<\/code>/g)].map((match) => match[1]!.trim()).filter(Boolean)
}

/** Живой список значений enum'а: запрос с заведомо негодным значением и разбор ответа. */
async function readEnum(name: EnumName, transport: TransportDeps): Promise<string[]> {
  const { status, text } = await probeShikimoriJson(`/animes?limit=1&${name}=zzz`, transport)
  if (status !== 422) {
    throw new FetchError('fetch.status', `справочник «${name}» недоступен: ответ ${status}`, { upstreamStatus: status })
  }
  const values = parseEnumMessage(text)
  if (!values.length) throw new FetchError('fetch.rejected', `справочник «${name}»: пустой список значений`)
  return values
}

/**
 * Повторы пробы GraphQL: на негодное значение GraphQL Shikimori отвечает
 * HTTP 500 с `InvalidParameterError` в теле. Для пробы это ответ, а не сбой —
 * 500 не повторяем (иначе каждый справочник стоил бы трёх запросов); 429/503 и
 * прочие временные отказы повторяются как обычно.
 */
const GRAPHQL_PROBE_RETRY = { statuses: [408, 425, 429, 502, 503, 504] }

/**
 * Живой список значений enum'а через GraphQL: тот же приём, что у REST, —
 * запрос с заведомо негодным значением, и сервер сам перечисляет допустимые
 * (`included_in?([...])` в `errors[0].message`). Ответ пробы не кэшируется —
 * кэшируется её результат (схема).
 */
async function readEnumGraphql(name: EnumName, transport: TransportDeps): Promise<string[]> {
  const fetch = transport.fetch ?? upstream
  const res = await fetch(SHIKIMORI_GRAPHQL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ query: `{ animes(${name}: "zzz", limit: 1) { id } }` }),
    idempotent: true,
    retry: GRAPHQL_PROBE_RETRY,
  })
  const text = await readText(res, { accept: () => true })
  let message = ''
  try {
    const payload = JSON.parse(text) as { errors?: readonly { message?: string }[] }
    message = payload.errors?.map((error) => error.message ?? '').join(' | ') ?? ''
  } catch {
    // не JSON — ниже это «пустой список значений»
  }
  const values = parseEnumMessage(message)
  if (!values.length) {
    throw new FetchError('fetch.rejected', `справочник «${name}»: пустой список значений`, {
      upstreamStatus: res.status,
    })
  }
  return values
}

type Labelled = { id: string; label: string }
type GraphqlGenre = { id: string; name: string; russian: string | null }
type SamplePage = { genres?: { id: string }[]; studios?: { id: string }[] }[]

const graphqlGenres = (transport: TransportDeps): Promise<Labelled[]> =>
  fetchGraphql<GraphqlGenre[]>({
    url: SHIKIMORI_GRAPHQL,
    doc: GENRES_DOC,
    map: (data) => (data as { genres?: GraphqlGenre[] }).genres ?? [],
  }, transport).then((list) => list.map((genre) => ({ id: String(genre.id), label: genre.russian ?? genre.name })))

/** Жанры v1 из REST: справочник общий у аниме и манги — берём только аниме. */
const restGenres = (transport: TransportDeps): Promise<Labelled[]> =>
  fetchShikimoriJson<{ id: number | string; name: string; russian?: string | null; entry_type?: string }[]>(
    '/genres',
    transport,
  ).then((list) =>
    list
      .filter((genre) => genre.entry_type === 'Anime')
      .map((genre) => ({ id: String(genre.id), label: genre.russian || genre.name })),
  )

const restStudios = (transport: TransportDeps): Promise<Labelled[]> =>
  fetchShikimoriJson<{ id: number | string; name: string }[]>('/studios', transport).then((list) =>
    list.map((studio) => ({ id: String(studio.id), label: studio.name })),
  )

const restNewestYear = (transport: TransportDeps): Promise<number> =>
  fetchShikimoriJson<{ aired_on?: string | null }[]>('/animes?limit=1&order=aired_on', transport).then(
    (list) => Number.parseInt(String(list?.[0]?.aired_on ?? '').slice(0, 4), 10),
  )

const graphqlNewestYear = (transport: TransportDeps): Promise<number> =>
  fetchGraphql<number>({
    url: SHIKIMORI_GRAPHQL,
    doc: NEWEST_DOC,
    map: (data) => Number((data as { animes?: { airedOn?: { year?: number } | null }[] }).animes?.[0]?.airedOn?.year),
  }, transport)

const samplePages = (doc: string, transport: TransportDeps): Promise<SamplePage[]> =>
  Promise.all(
    Array.from({ length: SHIKIMORI_SCHEMA_SAMPLE_PAGES }, (_, index) =>
      fetchGraphql<SamplePage>({
        url: SHIKIMORI_GRAPHQL,
        doc,
        variables: { page: index + 1, limit: 50, order: 'popularity' },
        map: (data) => (data as { animes?: SamplePage }).animes ?? [],
      }, transport),
    ),
  )

/**
 * Чтение всех справочников схемы версии `api`: значения + частоты + края
 * годов. Каждая версия ходит только в свой API (таблица в шапке модуля).
 */
export async function readShikimoriRefs(
  transport: TransportDeps = {},
  api: ShikimoriApi = SHIKIMORI_DEFAULT_API,
): Promise<ShikimoriRefs> {
  const graphql = api === 'graphql'
  const [genres, studios, newest, pages] = await Promise.all([
    api === 'rest' ? restGenres(transport) : graphqlGenres(transport),
    graphql ? Promise.resolve([]) : restStudios(transport),
    graphql ? graphqlNewestYear(transport) : restNewestYear(transport),
    api === 'rest' ? Promise.resolve([]) : samplePages(graphql ? SAMPLE_GENRES_DOC : SAMPLE_DOC, transport),
  ])
  const enums = {} as Record<EnumName, readonly string[]>
  for (const name of ['kind', 'status', 'rating', 'duration'] as const) {
    enums[name] = graphql ? await readEnumGraphql(name, transport) : await readEnum(name, transport)
  }
  return {
    genres,
    studios,
    enums,
    counts: countsOf(pages),
    newestYear: Number.isInteger(newest) ? newest : new Date().getUTCFullYear(),
  }
}

/** Частоты значений по выборке: `<поле>:<id>` → сколько раз встретилось. */
function countsOf(pages: readonly SamplePage[]): Map<string, number> {
  const counts = new Map<string, number>()
  const bump = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1)
  for (const page of pages) {
    for (const anime of page) {
      for (const genre of anime.genres ?? []) bump(`genres:${String(genre.id)}`)
      for (const studio of anime.studios ?? []) bump(`studios:${String(studio.id)}`)
    }
  }
  return counts
}

/* ── Сборка схемы ───────────────────────────────────────────────────────── */

const optionsOf = (
  values: readonly { id: string; label: string }[],
  key: string,
  counts: ReadonlyMap<string, number>,
): CatalogFilterOption[] =>
  values.map((value) => ({
    value: value.id,
    label: value.label,
    ...(counts.has(`${key}:${value.id}`) ? { count: counts.get(`${key}:${value.id}`)! } : {}),
  }))

/** Поле схемы без значений → поле с живыми значениями. */
function enrichField(field: CatalogFilterField, refs: ShikimoriRefs): CatalogFilterField {
  if (field.key === 'genres') return { ...field, options: optionsOf(refs.genres, 'genres', refs.counts) }
  if (field.key === 'studios') return { ...field, options: optionsOf(refs.studios, 'studios', refs.counts) }
  if (field.key in ENUM_LABELS) {
    const name = field.key as EnumName
    return {
      ...field,
      options: refs.enums[name].map((value) => ({ value, label: ENUM_LABELS[name][value] ?? value })),
    }
  }
  // Оценка: у API только нижняя граница, значения 1..10 — его собственная шкала.
  if (field.key === 'score') return { ...field, min: 1, max: 10 }
  // Год: нижняя граница — пол формы (у `season` нет открытого диапазона),
  // верхняя — самый новый год каталога, прочитанный живьём.
  if (field.key === 'year') return { ...field, min: SHIKIMORI_YEAR_FLOOR, max: refs.newestYear }
  return field
}

/**
 * Схема из состава полей и живых значений: пополнение, порядок длинных полей
 * по частоте (`capCatalogFilterOptions`: студии — частые первыми, все ~2000 в
 * схеме), связки, метка сборки.
 * Собранная схема обязана пройти свой же валидатор — это проверяется здесь,
 * а не «когда-нибудь в форме»: невалидную схему нельзя отдавать клиенту.
 */
export function buildShikimoriFilterSchema(
  refs: ShikimoriRefs,
  builtAt: string,
  api: ShikimoriApi = SHIKIMORI_DEFAULT_API,
): CatalogFilterSchema {
  const skeleton = shikimoriFilterSchemaSkeleton(api)
  const capped = capCatalogFilterOptions({ ...skeleton, fields: skeleton.fields.map((field) => enrichField(field, refs)) })
  return validateCatalogFilterSchema({
    ...capped,
    version: SHIKIMORI_FILTER_SCHEMA_VERSION,
    source: shikimoriFilterSource(api),
    rules: SHIKIMORI_FILTER_RULES,
    builtAt,
  })
}

/* ── Кэш схемы: `builtAt`, TTL, одна сборка на всех ─────────────────────── */

export type SchemaDeps = TransportDeps & {
  /** Версия API источника (по умолчанию `mix`): у каждой версии своя схема и свой кэш. */
  api?: ShikimoriApi
  /** Часы (тесты). */
  now?: () => number
  /** Время жизни схемы (тесты). */
  ttlMs?: number
}

type CachedSchema = { at: number; schema: CatalogFilterSchema }

/**
 * Собранные схемы — в области `shikimori:schemas` хранилища транспорта
 * (`localStore` по умолчанию), запись на версию API: ключей ровно три.
 * Срок записи — `Infinity`: свежесть решает метка `at` и TTL схемы, а
 * устаревшая запись НУЖНА — её отдают, если обновление упало.
 */
const schemasOf = (store: Store | undefined): Store =>
  (store ?? localStore).scope('shikimori').scope('schemas', { max: SHIKIMORI_APIS.length })

/**
 * Сборки в полёте — по версии. Это обещания, а не данные: в хранилище им не
 * место (single-flight живёт в процессе, как склейка запросов в `fetch`).
 */
const building = new Map<ShikimoriApi, Promise<CatalogFilterSchema>>()

/** Сброс кэша схем в `localStore` (тесты; в приложении не нужен). */
export function resetShikimoriFilterSchema(): void {
  building.clear()
  void schemasOf(undefined).clear()
}

/**
 * Готовая схема фильтров. Пока кэш свеж — отдаётся он; иначе запускается
 * ОДНА сборка, к которой присоединяются все ожидающие (single-flight). Упавшее
 * обновление не стирает предыдущую схему: она отдаётся с прежним `builtAt`.
 */
export async function getShikimoriFilterSchema(deps: SchemaDeps = {}): Promise<CatalogFilterSchema> {
  const { api = SHIKIMORI_DEFAULT_API, now: clock, ttlMs: ttl, ...transport } = deps
  const now = clock ?? (() => Date.now())
  const ttlMs = ttl ?? SHIKIMORI_SCHEMA_TTL_MS
  const schemas = schemasOf(transport.store)
  const cached = await schemas.get<CachedSchema>(api)
  if (cached && now() - cached.at < ttlMs) return cached.schema
  let pending = building.get(api)
  if (!pending) {
    const startedAt = now()
    pending = readShikimoriRefs(transport, api)
      .then(async (refs) => {
        const schema = buildShikimoriFilterSchema(refs, new Date(startedAt).toISOString(), api)
        await schemas.set<CachedSchema>(api, { at: now(), schema }, Infinity)
        return schema
      })
      .catch((error: unknown) => {
        if (cached) {
          if (DEV) {
            console.warn(
              `[shikimori-schema] ${api}: обновление не удалось, отдаю схему от ${cached.schema.builtAt}: ${String(error)}`,
            )
          }
          return cached.schema
        }
        throw error
      })
      .finally(() => {
        building.delete(api)
      })
    building.set(api, pending)
  }
  return await pending
}
