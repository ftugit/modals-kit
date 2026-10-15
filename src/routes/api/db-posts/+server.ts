/**
 * GET /api/db-posts?page=2&size=5&flt=<json>&ord=<порядок> — страница списка демо.
 * GET /api/db-posts?since=<ISO>&flt=<json> — опрос «что появилось» (живой список):
 * строки выдачи новее отметки; `since=` пусто — сама отметка. Не смешивается с
 * `page`/`after`/`cur`/`size`/`ord`: это другой вопрос, а не другая страница.
 * GET /api/db-posts?after=<токен>&size=5&… — ТО ЖЕ САМОЕ продолжение по указателю:
 * `after` и `page` — два адреса одного конвейера (`queryPage`), и выбор между ними
 * делает сервер по наличию токена, а не по догадке клиента.
 *
 * Тонкий слой HTTP: ключи пагинатора переводятся в запрос слоя, ответ отдаётся
 * в формате `PageResponse` (пагинатор по нему рисует номера страниц), а отказ
 * слоя приходит текстом и кодом — пустой список для пагинатора значит «данных
 * нет», и это другое состояние. Разбор и проверка имён — `parseListInput`
 * (deny-safe), общий с SSR-снапшотом.
 *
 * `ETag` и ответ `304` — не про «сэкономить байты», а про то, чтобы «ничего
 * нового» стоило дешевле, чем чтение базы: живой список переспрашивает каждую
 * пару секунд, и каждый такой тик без нового указателя обязан уйти в 304, не
 * касаясь `SELECT`. Проверка — в пробе (`If-None-Match` → 304 без тела).
 */
import { fingerprint, remember, revalidate, stableText } from '#lib/server/live-cache.js'
import type { RequestHandler } from './$types'
import { fetchDbPostsFresh, fetchDbPostsPage } from '#lib/server/db-list.js'
import { DEMO_PRINCIPAL } from '#lib/server/db.js'
import { DB_LIST_PAGE_SIZE } from '../../(site)/(app)/db-demo/definition'

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

export const GET: RequestHandler = async ({ url, request, locals }) => {
  // Условный GET живого списка проверяется ДО обращения к базе: иначе «ничего
  // нового» стоило бы ровно столько же, сколько «новое», — то есть выбор между
  // опросом и push сводился бы к «опрос дороже».
  const key = url.search
  const hit = revalidate(key, request.headers.get('if-none-match'))
  if (hit !== null) return new Response(null, { status: 304, headers: { etag: hit, 'cache-control': 'no-store' } })
  const ctx = locals.dbCtx ?? Object.freeze({ principal: DEMO_PRINCIPAL })
  if (url.searchParams.has('since')) {
    const since = url.searchParams.get('since') ?? ''
    const mixed = ['page', 'after', 'cur', 'size', 'ord'].filter((k) => url.searchParams.has(k))
    if (mixed.length || (since !== '' && Number.isNaN(Date.parse(since)))) {
      const error = mixed.length
        ? `Опрос «что появилось» не смешивается с ключами страницы: ${mixed.join(', ')}.`
        : 'Отметка `since` — не время в формате ISO.'
      return Response.json({ error, code: 'validation', status: 422 }, { status: 422, headers: { 'cache-control': 'no-store' } })
    }
    return reply(key, await fetchDbPostsFresh({ since, filter: url.searchParams.get('flt') ?? undefined }, ctx))
  }
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
    ctx,
  )
  return reply(key, page)
}

/** Ответ с отпечатком — общий для страницы и опроса; отказ отпечатка не получает. */
type Failure = { error: string; code: string; status: number }

async function reply(key: string, page: object | Failure): Promise<Response> {
  // Отказ — не состояние списка: его нельзя «закэшировать как текущее», и
  // валидатору он не отдаётся (иначе 304 спрячет исправленную ошибку).
  if ('error' in page) return Response.json(page, { status: (page as Failure).status, headers: { 'cache-control': 'no-store' } })
  const body = JSON.stringify(page)
  const etag = await fingerprint(stableText(page))
  remember(key, etag)
  return new Response(body, {
    headers: { 'content-type': 'application/json', etag, 'cache-control': 'no-store' },
  })
}
