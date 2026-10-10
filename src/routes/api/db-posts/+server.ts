/**
 * GET /api/db-posts?page=2&size=5&flt=<json>&ord=<порядок> — страница списка демо.
 * GET /api/db-posts?after=<токен>&size=5&… — ТО ЖЕ САМОЕ продолжение по указателю:
 * `after` и `page` — два адреса одного конвейера (`queryPage`), и выбор между ними
 * делает сервер по наличию токена, а не по догадке клиента.
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

/**
 * Значение по умолчанию и нижняя граница — РАЗНЫЕ числа: их совмещение в одном
 * аргументе делало невозможным размер меньше дефолта (`size=3` молча
 * превращалось в 5). Мусор в ключе = «ключа нет», то есть дефолт источника.
 */
const num = (raw: string | null, fallback: number, min: number, max: number): number => {
  if (raw === null || raw === '') return fallback
  const v = Number(raw)
  return Number.isFinite(v) ? Math.min(max, Math.max(min, Math.trunc(v))) : fallback
}

export const GET: RequestHandler = async ({ url, locals }) => {
  const page = await fetchDbPostsPage(
    {
      page: num(url.searchParams.get('page'), 1, 1, 10_000),
      pageSize: num(url.searchParams.get('size'), DB_LIST_PAGE_SIZE, 1, 100),
      filter: url.searchParams.get('flt') ?? undefined,
      order: url.searchParams.get('ord') ?? undefined,
      // Токен важнее номера — ровно как в источнике: смешанный адрес обязан
      // означать одно и то же с обеих сторон (SSR-снапшот и догрузка).
      after: url.searchParams.get('after') ?? undefined,
      // Приключённый режим приходит и как `1`, и как `true` (значение ключа
      // состояния), и как `on` (чекбокс нативного GET) — все три означают одно.
      cursor: ['1', 'true', 'on'].includes(url.searchParams.get('cur') ?? ''),
    },
    locals.dbCtx ?? Object.freeze({ principal: DEMO_PRINCIPAL }),
  )
  if ('error' in page) return json(page, { status: page.status, headers: { 'cache-control': 'no-store' } })
  return json(page, { headers: { 'cache-control': 'no-store' } })
}
