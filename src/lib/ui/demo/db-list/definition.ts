/**
 * Список демо-записей через пагинатор приложения (`$lib/paginate`), а не через
 * собственную разметку «slice + ссылки».
 *
 * Ключи адреса — общие для приложения: `?page=2`, `?page.size=10`,
 * `?page.flt=<фильтр слоя>`, `?page.ord=<json>`, `?page.mode=stream`. Своих
 * имён (`?db*`) здесь намеренно нет: `pageParam` по умолчанию = `page`, и
 * переопределять его ради одного потребителя значит заставлять адрес говорить
 * двумя диалектами. Разбор адреса принадлежит пагинатору, поэтому
 * `+page.server.ts` не читает `?limit`/`?filter` сам — второго источника правды
 * о показанной странице быть не должно.
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

/** Способ навигации списка: номера страниц или поток с подгрузкой. */
export const DB_LIST_MODES = ['pages', 'stream'] as const
export type DbListMode = (typeof DB_LIST_MODES)[number]

/** Ключи `?page.<key>`: форма проверяется здесь, допустимость — на сервере (схема слоя). */
export const DB_LIST_EXTRA_SEARCH = {
  // JSON-фильтр слоя: длина ограничена, содержимое разбирает `parseListInput`.
  flt: extraField('text', (v) => typeof v === 'string' && v.length > 0 && v.length <= 2048),
  ord: extraField('text', isOrderSpec),
  // UI-ключ: на выдачу не влияет, поэтому НЕ входит в reloadKeys.
  mode: extraField('text', (v) => v === 'pages' || v === 'stream'),
}

/** Дефолты extra: ключ со значением по умолчанию в адрес не пишется (чистый URL). */
export const DEFAULT_DB_LIST_EXTRA = { mode: 'pages' as DbListMode }

export type DbListExtra = { flt?: string; ord?: string; mode: DbListMode }

/** Значения панели настроек — из текущего extra (тот же разбор, что и на адресе). */
export function dbListExtraOf(extra: Record<string, unknown> | undefined): DbListExtra {
  const out: Record<string, unknown> = { ...DEFAULT_DB_LIST_EXTRA }
  for (const key of Object.keys(DB_LIST_EXTRA_SEARCH)) {
    const validate = DB_LIST_EXTRA_SEARCH[key as keyof typeof DB_LIST_EXTRA_SEARCH]
    const v = (validate as (raw: unknown) => unknown)(extra?.[key] ?? null)
    if (v !== undefined) out[key] = v
  }
  return out as DbListExtra
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
      // Смена фильтра/порядка — новая выдача: сброс на первую страницу. `mode`
      // сюда не входит: это раскладка, а не данные.
      reloadKeys: ['flt', 'ord'],
      adapter: createUrlAdapter<DbPost>({
        name: DB_LIST_NAME,
        source: dbPostsSource,
        pageSize: DB_LIST_PAGE_SIZE,
        pageSizes: DB_LIST_PAGE_SIZES,
        // append разрешён всегда: режим «поток» включает его хост пропсом `mode`,
        // а в режиме «страницы» пагинатор сам делает REPLACE.
        append: true,
        extraSearch: DB_LIST_EXTRA_SEARCH,
        extraDefaults: DEFAULT_DB_LIST_EXTRA,
      }),
    })
  }
  return DB_LIST_NAME
}
