/**
 * Схема фильтров Shikimori — в зоне ответственности ИСТОЧНИКА, на сервере.
 *
 * Что здесь и почему именно здесь:
 *   • СОСТАВ полей приходит общим объявлением (`content/shikimori-filters`):
 *     ключи и режимы — контракт имён, один на клиент и сервер;
 *   • ЗНАЧЕНИЯ читаются живьём из справочников API: жанры v2 — GraphQL
 *     (`genres(entryType: Anime)`; в REST справочника v2 нет вовсе), студии —
 *     REST (`/studios`, 1933 записи), enum'ы (тип/статус/рейтинг/длительность) —
 *     из текста 422: API сам перечисляет допустимые значения, и его список
 *     ШИРЕ, чем `/constants/anime` (там нет `tv_13`, `latest`);
 *   • ЧАСТОТЫ опций — из выборки популярной части каталога (несколько
 *     страниц GraphQL): без них `capCatalogFilterOptions` обрезал бы студии по
 *     алфавиту, и «Wit Studio» могла не попасть в предел вовсе;
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
} from '$lib/filters'
import {
  SHIKIMORI_FILTER_SOURCE,
  SHIKIMORI_FILTER_SCHEMA_VERSION,
  shikimoriFilterSchemaSkeleton,
} from '../../content/shikimori-filters'
import { fetchGraphql } from './graphql'
import {
  fetchShikimoriJson,
  probeShikimoriJson,
  ShikimoriUpstreamError,
  type TransportDeps,
} from './shikimori'

/** GraphQL-эндпоинт Shikimori: для универсального транспорта это просто адрес. */
export const SHIKIMORI_GRAPHQL = 'https://shikimori.io/api/graphql'

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
    throw new ShikimoriUpstreamError(`Справочник «${name}» недоступен: ответ ${status}`, 502)
  }
  const values = parseEnumMessage(text)
  if (!values.length) throw new ShikimoriUpstreamError(`Справочник «${name}»: пустой список значений`, 502)
  return values
}

/** Чтение всех справочников схемы: значения + частоты + края годов. */
export async function readShikimoriRefs(transport: TransportDeps = {}): Promise<ShikimoriRefs> {
  const [genreList, studioList, newest, ...pages] = await Promise.all([
    fetchGraphql<{ id: string; name: string; russian: string | null }[]>({
      url: SHIKIMORI_GRAPHQL,
      doc: GENRES_DOC,
      map: (data) => (data as { genres?: { id: string; name: string; russian: string | null }[] }).genres ?? [],
    }, transport),
    fetchShikimoriJson<{ id: number | string; name: string }[]>('/studios', transport),
    fetchShikimoriJson<{ aired_on?: string | null }[]>('/animes?limit=1&order=aired_on', transport),
    ...Array.from({ length: SHIKIMORI_SCHEMA_SAMPLE_PAGES }, (_, index) =>
      fetchGraphql<{ genres?: { id: string }[]; studios?: { id: string }[] }[]>({
        url: SHIKIMORI_GRAPHQL,
        doc: SAMPLE_DOC,
        variables: { page: index + 1, limit: 50, order: 'popularity' },
        map: (data) => (data as { animes?: { genres?: { id: string }[]; studios?: { id: string }[] }[] }).animes ?? [],
      }, transport),
    ),
  ])
  const enums = {} as Record<EnumName, readonly string[]>
  for (const name of ['kind', 'status', 'rating', 'duration'] as const) {
    enums[name] = await readEnum(name, transport)
  }

  const counts = new Map<string, number>()
  const bump = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1)
  for (const page of pages) {
    for (const anime of page) {
      for (const genre of anime.genres ?? []) bump(`genres:${String(genre.id)}`)
      for (const studio of anime.studios ?? []) bump(`studios:${String(studio.id)}`)
    }
  }

  const newestYear = Number.parseInt(String(newest?.[0]?.aired_on ?? '').slice(0, 4), 10)
  return {
    genres: genreList.map((genre) => ({ id: String(genre.id), label: genre.russian ?? genre.name })),
    studios: studioList.map((studio) => ({ id: String(studio.id), label: studio.name })),
    enums,
    counts,
    newestYear: Number.isInteger(newestYear) ? newestYear : new Date().getUTCFullYear(),
  }
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
 * Схема из состава полей и живых значений: пополнение, деградация oversized-полей
 * (`capCatalogFilterOptions`: студий больше тысячи), связки, метка сборки.
 * Собранная схема обязана пройти свой же валидатор — это проверяется здесь,
 * а не «когда-нибудь в форме»: невалидную схему нельзя отдавать клиенту.
 */
export function buildShikimoriFilterSchema(refs: ShikimoriRefs, builtAt: string): CatalogFilterSchema {
  const skeleton = shikimoriFilterSchemaSkeleton()
  const capped = capCatalogFilterOptions({ ...skeleton, fields: skeleton.fields.map((field) => enrichField(field, refs)) })
  return validateCatalogFilterSchema({
    ...capped,
    version: SHIKIMORI_FILTER_SCHEMA_VERSION,
    source: SHIKIMORI_FILTER_SOURCE,
    rules: SHIKIMORI_FILTER_RULES,
    builtAt,
  })
}

/* ── Кэш схемы: `builtAt`, TTL, одна сборка на всех ─────────────────────── */

export type SchemaDeps = TransportDeps & {
  /** Часы (тесты). */
  now?: () => number
  /** Время жизни схемы (тесты). */
  ttlMs?: number
}

let cached: { at: number; schema: CatalogFilterSchema } | null = null
let building: Promise<CatalogFilterSchema> | null = null

/** Сброс кэша схемы (тесты; в приложении не нужен). */
export function resetShikimoriFilterSchema(): void {
  cached = null
  building = null
}

/**
 * Готовая схема фильтров. Пока кэш свеж — отдаётся он; иначе запускается
 * ОДНА сборка, к которой присоединяются все ожидающие (single-flight). Упавшее
 * обновление не стирает предыдущую схему: она отдаётся с прежним `builtAt`.
 */
export async function getShikimoriFilterSchema(deps: SchemaDeps = {}): Promise<CatalogFilterSchema> {
  const now = deps.now ?? (() => Date.now())
  const ttlMs = deps.ttlMs ?? SHIKIMORI_SCHEMA_TTL_MS
  if (cached && now() - cached.at < ttlMs) return cached.schema
  if (!building) {
    const startedAt = now()
    building = readShikimoriRefs(deps)
      .then((refs) => {
        const schema = buildShikimoriFilterSchema(refs, new Date(startedAt).toISOString())
        cached = { at: now(), schema }
        return schema
      })
      .catch((error: unknown) => {
        if (cached) {
          if (typeof process === 'undefined' || process.env?.NODE_ENV !== 'production') {
            console.warn(`[shikimori-schema] обновление не удалось, отдаю схему от ${cached.schema.builtAt}: ${String(error)}`)
          }
          return cached.schema
        }
        throw error
      })
      .finally(() => {
        building = null
      })
  }
  return await building
}
