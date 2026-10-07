// Реестр поисков по name (порядок как у lib/paginate R9/R17): одна регистрация,
// клиент и сервер импортируют её же; неизвестное имя → throw (deny by default).
//
// defineSearch НЕ создаёт нового ядра данных: он ПОДКЛЮЧАЕТ lib/search к
// источнику пагинатора (withLibSearch) и регистрирует пагинатор на
// URL-адаптере, объявляя запрос `q` ключом его extra. Пустой запрос —
// сквозной проход к базовому источнику (обычный каталог); с запросом тот же
// пагинатор показывает результаты. Всё остальное — состояние, гонки,
// SSR-снапшоты, back/forward — уже умеет lib/paginate.
import {
  createUrlAdapter,
  definePaginator,
  hasPaginator,
  type ExtraValue,
  type PaginatorSearchOptions,
} from '$lib/paginate'
import type { SearchConfig, SearchInstance } from './types'
import { withLibSearch, type SearchCorrectionInfo } from './accumulator'

const instances = new Map<string, SearchInstance>()
const corrections = new Map<string, SearchCorrectionInfo | null>()
const correctionListeners = new Map<string, Set<(info: SearchCorrectionInfo | null) => void>>()

/** Deny-safe валидатор запроса из адреса: строка, без управляющих, с обрезкой. */
export function searchQueryValidator(maxLength: number): (raw: ExtraValue) => ExtraValue | undefined {
  return (raw) => {
    if (raw == null) return undefined
    // decodeExtraValue мог распознать число/boolean — запрос «1998» легален.
    const value = String(raw)
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .trim()
      .slice(0, maxLength)
    return value ? value : undefined
  }
}

/**
 * Спецификация ключей адреса одного поиска — для validateSearch роута:
 * `paginatorSearch([{ pageParam: 'page', ... }, searchAddressSpec('search')])`.
 * `extra` — дополнительные ключи пагинатора (фильтры источника): они тоже
 * живут под префиксом поиска (`?search.filters.*`).
 */
export function searchAddressSpec(
  pageParam: string,
  maxQueryLength = 120,
  extra: PaginatorSearchOptions['extra'] = {},
): PaginatorSearchOptions {
  return { pageParam, extra: { ...extra, q: searchQueryValidator(maxQueryLength) } }
}

export function defineSearch<T>(config: SearchConfig<T>): SearchInstance {
  if (instances.has(config.name)) {
    throw new Error(`Search "${config.name}" already defined`)
  }
  const pageParam = config.pageParam ?? config.name
  const maxQueryLength = config.maxQueryLength ?? 120
  const minLength = config.minLength ?? 2
  const instance: SearchInstance = {
    name: config.name,
    pageParam,
    queryKey: 'q',
    minLength,
    debounce: config.debounce ?? 300,
    maxQueryLength,
  }
  // Подключение lib/search — декоратор источника (нужно `scan` в спеке); без
  // fuzzy-опций базовый источник работает как есть (серверное сужение по q).
  const source = config.fuzzy
    ? withLibSearch<T>(config.source, { ...config.fuzzy, minLength })
    : config.source
  if (!hasPaginator(config.name)) {
    definePaginator<T>({
      name: config.name,
      adapter: createUrlAdapter<T>({
        name: config.name,
        source,
        pageSize: config.pageSize ?? 20,
        // Одна страница за раз (REPLACE): перехват валиден только при
        // mode=single — накопительная лента с fuzzy-порядком дала бы шов
        // сортировки между порциями (решение 2026-09-29, п. 12).
        append: false,
        pageParam,
        // Ключи источника (фильтры) — сквозь перехват, `q` — ключ поиска.
        extraSearch: { ...(config.extraSearch ?? {}), q: searchQueryValidator(maxQueryLength) },
        // Пустой запрос не пишется в адрес: чистые URL.
        extraDefaults: { ...(config.extraDefaults ?? {}), q: '' },
      }),
      pageSize: config.pageSize ?? 20,
      // Смена фильтров источника перезагружает выдачу так же, как смена запроса.
      reloadKeys: ['q', ...(config.reloadKeys ?? [])],
    })
  }
  instances.set(config.name, instance)
  return instance
}

export function hasSearch(name: string): boolean {
  return instances.has(name)
}

export function getSearch(name: string): SearchInstance {
  const instance = instances.get(name)
  if (!instance) throw new Error(`Unknown search "${name}"`)
  return instance
}

/** Подпись подмены запроса (основной контур аккумулятора) для UI. */
export function reportSearchCorrection(name: string, info: SearchCorrectionInfo | null): void {
  corrections.set(name, info)
  for (const listener of correctionListeners.get(name) ?? []) listener(info)
}

export function getSearchCorrection(name: string): SearchCorrectionInfo | null {
  return corrections.get(name) ?? null
}

export function onSearchCorrection(
  name: string,
  listener: (info: SearchCorrectionInfo | null) => void,
): () => void {
  let set = correctionListeners.get(name)
  if (!set) {
    set = new Set()
    correctionListeners.set(name, set)
  }
  set.add(listener)
  return () => set.delete(listener)
}

/** Только для тестов: сброс реестра (пагинаторы сбрасываются своим реестром). */
export function resetSearchRegistry(): void {
  instances.clear()
  corrections.clear()
  correctionListeners.clear()
}
