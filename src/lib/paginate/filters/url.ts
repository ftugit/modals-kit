/**
 * Адрес каталога — единственный формат ключей `?page.filters.<поле>[.<режим>|.<граница>]`:
 * разбор пути, значения из адреса и extra, канонический адрес и адрес без значения.
 * Префикс — `FILTER_KEY_PREFIX` ядра пагинатора (объявлен один раз в `../source.ts`).
 */
import { modes, bounds } from './internal'
import { FILTER_KEY_PREFIX } from '../source'
import type { CatalogFilterMode, CatalogFilterBound } from './schema'

/** Разбор имени поля обратно в ключ и режим/границу. */
export function parseCatalogFilterPath(
  path: string,
): { key: string; mode?: CatalogFilterMode; bound?: CatalogFilterBound } | undefined {
  if (!path.startsWith(FILTER_KEY_PREFIX)) return undefined
  const rest = path.slice(FILTER_KEY_PREFIX.length)
  const dot = rest.lastIndexOf('.')
  if (dot > 0) {
    const suffix = rest.slice(dot + 1)
    if (modes.includes(suffix as CatalogFilterMode))
      return { key: rest.slice(0, dot), mode: suffix as CatalogFilterMode }
    if (bounds.includes(suffix as CatalogFilterBound))
      return { key: rest.slice(0, dot), bound: suffix as CatalogFilterBound }
  }
  return { key: rest }
}

/**
 * Значения фильтров из состояния пагинатора/адреса.
 * В `extra` они лежат строкой через запятую: `filters.genres.or=Драма,Комедия`.
 */
export function readCatalogFilterValues(source: Record<string, unknown> | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [key, raw] of Object.entries(source ?? {})) {
    if (!key.startsWith(FILTER_KEY_PREFIX)) continue
    // extra — типизированный контракт (§ 3.1): числовая граница из адреса
    // приходит НАСТОЯЩИМ числом; оно такое же значение фильтра, как строка
    // (раньше число отбрасывалось — чип и счётчик теряли фильтр).
    const list = (
      Array.isArray(raw)
        ? raw
        : typeof raw === 'string'
          ? raw.split(',')
          : typeof raw === 'number' && Number.isFinite(raw)
            ? [raw]
            : []
    )
      .map((item) => String(item).trim())
      .filter((item) => item.length > 0 && item.length <= 120)
    if (list.length) out[key] = list
  }
  return out
}

/**
 * Значения фильтров из `search` роута: `paginatorSearch` отдаёт плоские ключи
 * с префиксом пагинатора (`page.filters.genres.or`), а форме и чипам нужны
 * имена полей (`filters.genres.or`).
 */
export function catalogFilterValuesFromSearch(
  search: Record<string, unknown> | undefined,
  prefix = 'page',
): Record<string, string[]> {
  const head = `${prefix}.`
  const stripped: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(search ?? {})) {
    if (key.startsWith(head)) stripped[key.slice(head.length)] = value
  }
  return readCatalogFilterValues(stripped)
}

/**
 * Опции адреса: `prefix` — чей пагинатор фильтруется (`page` или `search`),
 * `preserved` — ЧУЖИЕ ключи текущего адреса, которые обязаны пережить смену
 * фильтров (фильтры/страница/запрос соседнего пагинатора, свой `q`).
 * Указатель страницы СВОЕГО префикса в preserved не входит: новый набор
 * фильтров начинается с первой страницы.
 */
export type CatalogFilterUrlOptions = {
  prefix?: string
  preserved?: Record<string, string | string[] | undefined>
}

function searchFromValues(
  values: Record<string, string[] | string | undefined>,
  opts: CatalogFilterUrlOptions = {},
): string {
  const prefix = opts.prefix ?? 'page'
  const params = new URLSearchParams()
  for (const [path, value] of Object.entries(values)) {
    if (!path.startsWith(FILTER_KEY_PREFIX)) continue
    const list = Array.isArray(value)
      ? value
          .map((item) => (typeof item === 'number' ? String(item) : item))
          .filter((item): item is string => typeof item === 'string' && item.length > 0)
      : typeof value === 'number'
        ? [String(value)]
        : typeof value === 'string' && value
          ? [value]
          : []
    if (list.length) params.set(`${prefix}.${path}`, list.join(','))
  }
  // Чужие ключи адреса сохраняются как есть: фильтры одного пагинатора не
  // имеют права стирать состояние соседнего.
  for (const [key, value] of Object.entries(opts.preserved ?? {})) {
    if (value === undefined) continue
    if (key === prefix || key.startsWith(`${prefix}.filters.`)) continue
    params.set(key, Array.isArray(value) ? value.join(',') : value)
  }
  // Ключи сортируем: адрес одного набора фильтров всегда один и тот же —
  // это важно и для кэша, и для сравнения в тестах.
  const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
  return new URLSearchParams(sorted).toString()
}

/**
 * Канонический адрес каталога для набора значений.
 * Формат `?<prefix>.<поле>` — тот же, что читают `validateSearch` роута и адаптер;
 * указатель страницы своего префикса намеренно сбрасывается: новый набор
 * фильтров начинается с первой страницы.
 */
export function canonicalCatalogFilterUrl(
  page: string,
  values: Record<string, unknown> | Record<string, string[] | string | undefined>,
  opts: CatalogFilterUrlOptions = {},
): string {
  const query = searchFromValues(values as Record<string, string[] | string | undefined>, opts)
  return query ? `${page}?${query}` : page
}

/** Адрес без одного значения: клик по чипу снимает только его. */
export function catalogFilterUrlWithout(
  page: string,
  values: Record<string, string[]>,
  path: string,
  value: string,
  opts: CatalogFilterUrlOptions = {},
): string {
  const next: Record<string, string[]> = {}
  for (const [key, list] of Object.entries(values)) {
    const kept = key === path ? list.filter((item) => item !== value) : list
    if (kept.length) next[key] = kept
  }
  return canonicalCatalogFilterUrl(page, next, opts)
}
