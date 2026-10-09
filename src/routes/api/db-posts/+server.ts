/**
 * GET /api/db-posts?page=2&size=5&flt=<json>&ord=<порядок> — страница списка демо.
 *
 * Тонкий слой HTTP: ключи пагинатора переводятся в запрос слоя, ответ отдаётся
 * в формате `PageResponse` (пагинатор по нему рисует номера страниц), а отказ
 * слоя приходит текстом и кодом — пустой список для пагинатора значит «данных
 * нет», и это другое состояние. Разбор и проверка имён — `parseListInput`
 * (deny-safe), общий с SSR-снапшотом.
 */
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { fetchDbPostsPage } from '$lib/server/db-list'
import { DEMO_PRINCIPAL } from '$lib/server/db'
import { DB_LIST_PAGE_SIZE } from '$lib/ui/demo/db-list/definition'

const num = (raw: string | null, min: number, max: number): number => {
  const v = Number(raw)
  return Number.isFinite(v) ? Math.min(max, Math.max(min, Math.trunc(v))) : min
}

export const GET: RequestHandler = async ({ url, locals }) => {
  const page = await fetchDbPostsPage(
    {
      page: num(url.searchParams.get('page'), 1, 10_000),
      pageSize: num(url.searchParams.get('size'), DB_LIST_PAGE_SIZE, 100),
      filter: url.searchParams.get('flt') ?? undefined,
      order: url.searchParams.get('ord') ?? undefined,
    },
    locals.dbCtx ?? Object.freeze({ principal: DEMO_PRINCIPAL }),
  )
  if ('error' in page) return json(page, { status: page.status, headers: { 'cache-control': 'no-store' } })
  return json(page, { headers: { 'cache-control': 'no-store' } })
}
