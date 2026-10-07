/**
 * Состав полей схемы фильтров каталога Shikimori — ОБЩАЯ часть двух зон.
 *
 * Что здесь, а что нет (решение этапа 3):
 *   • здесь — ФОРМА схемы: ключи полей, их тип, режимы и границы. Это контракт
 *     имён (`filters.<ключ>[.<режим>|.<граница>]`), по которому пагинатор
 *     объявляет ключи extra, а адресный слой читает адрес;
 *   • не здесь — ЗНАЧЕНИЯ (жанры, студии, enum'ы) и СВЯЗКИ: их собирает
 *     серверная зона источника (`$lib/server/shikimori-schema`) из живых
 *     справочников, ставит метку `builtAt` и отдаёт клиенту готовую схему
 *     роутом `/api/shikimori/filters`. Клиент схему НЕ вычисляет.
 *
 * Тот же список ключей использует и транспорт (`$lib/server/shikimori-filters`),
 * сопоставляя канонические значения с параметрами API: одно объявление — одна
 * правда о том, какие фильтры у источника есть.
 */
import {
  catalogFilterFieldNames,
  type CatalogFilterField,
  type CatalogFilterSchema,
} from '$lib/filters'
import type { ExtraSearchSpec, ExtraValue } from '$lib/paginate'

/**
 * Поля схемы без значений: `options`/`min`/`max` наполняет серверная зона.
 *
 * Границы (`bounds`) — часть контракта, а не значение: они говорят, какие
 * инпуты вообще существуют у числового поля. У «Оценки» это только «от»
 * (`score` в API — минимальная оценка), у «Года» — обе границы (диапазон
 * сезона `2014_2016`).
 */
export const SHIKIMORI_FILTER_FIELDS: readonly CatalogFilterField[] = [
  // Режимы: «и» (`and`) у жанров нативно, «кроме» (`not`) — тоже; «или» в API
  // нет вовсе (повторяющиеся `genre_v2=` складываются по «и»), поэтому режим не
  // объявляется — UI его не покажет, а адрес с ним не прочтётся.
  { key: 'genres', label: 'Жанры', type: 'multiselect', modes: ['and', 'not'] },
  // У студий «кроме» нет: отрицания в параметре `studio` нет ни в REST, ни в
  // GraphQL (проверено живьём), поэтому режим один.
  { key: 'studios', label: 'Студии', type: 'multiselect', modes: ['and'] },
  { key: 'kind', label: 'Тип', type: 'select' },
  { key: 'status', label: 'Статус', type: 'select' },
  { key: 'rating', label: 'Рейтинг', type: 'select' },
  { key: 'duration', label: 'Длительность', type: 'select' },
  { key: 'score', label: 'Оценка', type: 'number', bounds: ['min'] },
  { key: 'year', label: 'Год', type: 'number', bounds: ['min', 'max'] },
]

/**
 * Ключи extra, которые понимает источник фильтров: `filters.genres.and`,
 * `filters.score.min`, `filters.kind`, … Выводятся из того же объявления, что
 * и схема, — расходиться им негде.
 */
export const SHIKIMORI_FILTER_KEYS: readonly string[] = SHIKIMORI_FILTER_FIELDS.flatMap(
  catalogFilterFieldNames,
)

/** Ключи-границы числовых полей: в extra и адресе это ЧИСЛО, не строка. */
const isBound = (key: string): boolean => key.endsWith('.min') || key.endsWith('.max')

/**
 * Числовая граница из адреса: конечное число в разумных пределах. Мусор →
 * `undefined` (ключ в extra не попадает, dev-предупреждение скажет адресному слою).
 */
function boundValue(raw: ExtraValue): number | undefined {
  const value =
    typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN
  return Number.isFinite(value) && Math.abs(value) <= 1e9 ? value : undefined
}

/**
 * Значение-список из адреса: строка, разбитая по запятой (формат канона).
 * Пустые элементы и переросшие предел (120, как у валидатора схемы)
 * отбрасываются; пустой список — не значение.
 */
function listValue(raw: ExtraValue): string | undefined {
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw : null
  if (text === null) return undefined
  const items = text
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '')
  if (!items.length || items.some((item) => item.length > 120)) return undefined
  return items.join(',')
}

/**
 * Ключи фильтров для адресного слоя (`extraSearch` пагинатора): что вообще
 * может лежать в адресе и в каком виде. Значения здесь только ПРОВЕРЯЮТСЯ на
 * форму — допустимость значений знает схема (сервер), и она же отсекает чужое.
 */
export const SHIKIMORI_FILTER_SEARCH: ExtraSearchSpec = Object.fromEntries(
  SHIKIMORI_FILTER_KEYS.map((key) => [key, isBound(key) ? boundValue : listValue]),
)

/** Ключи, смена которых меняет ВЫДАЧУ: сбрасывают указатель на первую страницу. */
export const SHIKIMORI_FILTER_RELOAD_KEYS: readonly string[] = [...SHIKIMORI_FILTER_KEYS]

/** Источник схемы: имя, под которым её строит серверная зона. */
export const SHIKIMORI_FILTER_SOURCE = 'shikimori'

/** Версия СОСТАВА полей (не значений): растёт, когда меняется контракт ключей. */
export const SHIKIMORI_FILTER_SCHEMA_VERSION = 1

/** Схема без значений — то, на что накладывает данные серверная зона. */
export function shikimoriFilterSchemaSkeleton(): CatalogFilterSchema {
  return {
    source: SHIKIMORI_FILTER_SOURCE,
    version: SHIKIMORI_FILTER_SCHEMA_VERSION,
    fields: SHIKIMORI_FILTER_FIELDS,
  }
}
