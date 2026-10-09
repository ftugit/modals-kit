/**
 * Список демо-записей через пагинатор приложения (`$lib/paginate`), а не через
 * собственную разметку «slice + ссылки».
 *
 * Ключи адреса — под своим префиксом `?db`: `?db=2`, `?db.size=10`,
 * `?db.flt=<json>`, `?db.ord=title:asc`. Разбор адреса принадлежит пагинатору,
 * поэтому `+page.server.ts` больше не читает `?limit`/`?filter` сам — второго
 * источника правды о том, какая страница показана, быть не должно.
 *
 * Две дороги к одним данным, один конвейер:
 *   • браузер — `fetch('/api/db-posts?…')`;
 *   • SSR-снапшот — серверный транспорт (`setDbPostsServerTransport`), который
 *     ставит `$lib/server/db-list` и который вызывает слой напрямую. Без него
 *     серверный рендер дёргал бы собственный HTTP-эндпоинт через `localhost`.
 */
import { createUrlAdapter, definePaginator, defineSource, extraField, hasPaginator, type PageResponse } from '$lib/paginate'

export const DB_LIST_NAME = 'db-demo'
export const DB_LIST_PAGE_SIZE = 5
export const DB_LIST_PAGE_SIZES = [3, 5, 10, 20] as const

export interface DbPost {
  id: string
  title: string
  created_at: string
}

/** Запрос страницы в том виде, в каком его понимает слой (`parseListInput`). */
export type DbPostsQuery = {
  page: number
  pageSize: number
  filter?: string
  order?: string
  signal?: AbortSignal
}

export type ServerTransport = (query: DbPostsQuery) => Promise<PageResponse<DbPost>>

let serverTransport: ServerTransport | null = null

/** Ставится один раз на уровне модуля серверным слоем (см. `$lib/server/db-list`). */
export function setDbPostsServerTransport(fn: ServerTransport): void {
  serverTransport = fn
}

/**
 * Порядок слоя — массив пар `[["title","asc"]]` (не `title:asc`): адрес хранит
 * ровно то, что разбирает `parseListInput`, иначе на странице и в догрузке
 * были бы разные правила. Здесь проверяется только ФОРМА (короткий массив пар с
 * asc/desc), допустимость поля и направление разбирает слой.
 */
function isOrderSpec(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) return false
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return false
  }
  return (
    Array.isArray(parsed) &&
    parsed.length <= 2 &&
    parsed.every((pair) => Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && (pair[1] === 'asc' || pair[1] === 'desc'))
  )
}

/** Ключи `?db.<key>`: форма проверяется здесь, допустимость — на сервере (схема слоя). */
export const DB_LIST_EXTRA_SEARCH = {
  // JSON-фильтр слоя: длина ограничена, содержимое разбирает `parseListInput`.
  flt: extraField('text', (v) => typeof v === 'string' && v.length > 0 && v.length <= 2048),
  ord: extraField('text', isOrderSpec),
}

export const dbPostsSource = defineSource<DbPost>({
  name: 'db_demo_posts',
  record: {
    id: (r) => String(r.id),
    title: (r) => r.title,
    texts: (r) => [r.title, String(r.id)],
  },
  // Фильтры объявляет САМ источник: ключи `?db.flt`/`?db.ord` доходят до
  // `data` через `input.filters`; необъявленный ключ пагинатор отсекает.
  filters: ['flt', 'ord'],
  totals: true,
  data: async ({ page, pageSize, signal }, input) => {
    const filter = input.filters?.flt
    const order = input.filters?.ord
    if (serverTransport) return serverTransport({ page, pageSize, filter, order, signal })
    const q = new URLSearchParams({ page: String(page), size: String(pageSize) })
    if (filter) q.set('flt', filter)
    if (order) q.set('ord', order)
    const res = await fetch(`/api/db-posts?${q}`, { signal })
    const body = (await res.json().catch(() => null)) as (PageResponse<DbPost> & { error?: string }) | null
    // Ошибка сервера обязана дойти до пагинатора как ошибка: пустой список он
    // читает как «данных нет», и это другое состояние.
    if (!res.ok) throw new Error(body?.error ?? `db-posts: HTTP ${res.status}`)
    return body as PageResponse<DbPost>
  },
})

/** Регистрация идемпотентна: при HMR модуль выполняется повторно. */
export function ensureDbListPaginator(): string {
  if (!hasPaginator(DB_LIST_NAME)) {
    definePaginator<DbPost>({
      name: DB_LIST_NAME,
      pageSize: DB_LIST_PAGE_SIZE,
      adapter: createUrlAdapter<DbPost>({
        name: DB_LIST_NAME,
        source: dbPostsSource,
        pageSize: DB_LIST_PAGE_SIZE,
        pageSizes: DB_LIST_PAGE_SIZES,
        pageParam: 'db',
        // Таблица: одна страница за раз, накопление здесь только мешает счёту строк.
        append: false,
        extraSearch: DB_LIST_EXTRA_SEARCH,
      }),
    })
  }
  return DB_LIST_NAME
}
