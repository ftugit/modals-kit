/**
 * Имена и значения фильтров в extra: `filters.<поле>[.<режим>|.<граница>]`.
 * Префикс — `FILTER_KEY_PREFIX` ядра пагинатора (объявлен один раз в `../source.ts`).
 * Адресов здесь нет: как фильтр выглядит во внешнем хранилище (ссылка, имя поля
 * формы), решает адаптер пагинатора (`linkFor`, `carryFields`), ход 246.
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
