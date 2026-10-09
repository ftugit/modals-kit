/**
 * Серверная половина списка демо: один конвейер для SSR-снапшота пагинатора и
 * для HTTP-эндпоинта, которым браузер догружает остальные страницы.
 *
 * Оба пути идут через слой (`parseListInput` → `select`/`count`) и через
 * `toKitError` — разбор адреса и отказ на неизвестный ключ обязаны быть
 * одинаковыми, иначе «перезагрузка страницы даёт другой список» вернётся.
 */
import { parseListInput, toKitError } from '$lib/db/sveltekit'
import type { DataContext } from '$lib/db'
import { createPaginatorStore, initServerPaginator } from '$lib/paginate'
import {
  DB_LIST_PAGE_SIZE,
  ensureDbListPaginator,
  setDbPostsServerTransport,
  type DbPost,
  type DbPostsQuery,
} from '$lib/ui/demo/db-list/definition'
import { DEMO_PRINCIPAL, getRuntime, posts } from './db'

type Page = { items: DbPost[]; totalItems: number; totalPages: number; hasNext: boolean }

async function queryPage(query: DbPostsQuery, ctx: DataContext): Promise<Page> {
  const { db } = await getRuntime()
  const api = db.resource(posts)
  // Ключи адреса переводятся в те, что разбирает слой: пагинатор говорит
  // «page/size», слой говорит «page/limit». Один перевод — на оба пути.
  const params = new URLSearchParams({ page: String(query.page), limit: String(query.pageSize) })
  if (query.filter) params.set('filter', query.filter)
  if (query.order) params.set('order', query.order)
  const input = parseListInput(params)
  // total — по ТОМУ ЖЕ фильтру, что и страница: иначе «всего записей» и
  // «подходит под фильтр» — два разных числа под одним заголовком, а
  // пагинатор по такому total построит несуществующие страницы.
  const filterOnly = { filter: input.filter }
  const [items, totalItems] = await Promise.all([api.select(ctx, input), api.count(ctx, filterOnly)])
  const size = input.limit ?? DB_LIST_PAGE_SIZE
  const totalPages = Math.max(1, Math.ceil(totalItems / size))
  return {
    items: items as DbPost[],
    totalItems,
    totalPages,
    hasNext: (input.page ?? 1) < totalPages,
  }
}

/**
 * Транспорт для SSR-снапшота: вызов слоя напрямую, без HTTP-запроса приложения
 * к самому себе (иначе первая отрисовка платит соединением и таймаутами).
 *
 * Чтение в демо открыто политикой (`policy.publicRows`), поэтому снапшот
 * строится тем же принципом, что ставит хук, — `DEMO_PRINCIPAL` один на
 * хук, снапшот и эндпоинт.
 */
setDbPostsServerTransport((query) =>
  queryPage(query, Object.freeze({ principal: DEMO_PRINCIPAL, signal: query.signal })),
)

/** Снапшот пагинатора для `+page.server.ts`: страница из адреса запроса. */
export async function loadDbListSnapshot(url: string) {
  const name = ensureDbListPaginator()
  const store = createPaginatorStore()
  const snapshot = await initServerPaginator<DbPost>(store, name, { url })
  return { name, snapshot }
}

/** Ответ эндпоинта: страница или готовый к показу отказ (текст + код). */
export async function fetchDbPostsPage(query: DbPostsQuery, ctx: DataContext): Promise<Page | { error: string; code: string; status: number }> {
  try {
    return await queryPage(query, ctx)
  } catch (e) {
    const kit = toKitError(e, import.meta.env.DEV)
    return { error: String(kit.body.message ?? 'база отклонила запрос'), code: String(kit.body.code ?? 'database'), status: kit.status }
  }
}
