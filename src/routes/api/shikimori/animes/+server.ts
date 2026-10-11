/**
 * GET /api/shikimori/animes — страница каталога живого источника.
 *
 * Тонкая обёртка над серверным транспортом: разбор параметров (deny-safe),
 * применение фильтров по ЖИВОЙ схеме источника, один вызов `fetchAnimes`
 * (с кэшем и троттлингом), JSON-ответ. Ошибки внешнего API едут как 502/504 с
 * текстом — пагинатор покажет их в ErrorRow, а не «пустой список» (пустой
 * список у него значит «данных нет», и это разные состояния).
 *
 * Фильтры приходят каноническими ключами (`filters.genres.and=133,141`) и
 * применяются ЗДЕСЬ, потому что зона схемы — серверная: браузер не знает, что
 * `genres.and` — это `genre_v2`, и не должен. Схема читается только тогда,
 * когда фильтры в запросе есть: обычная страница каталога её не ждёт.
 */
import type { RequestHandler } from './$types'
import { parseAnimesQuery } from '#lib/server/shikimori.js'
import { upstreamFailure } from '#lib/server/upstream.js'
import { fetchAnimesPage } from '#lib/server/shikimori-filters.js'

export const GET: RequestHandler = async ({ url, request }) => {
  const parsed = parseAnimesQuery(url.searchParams)
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })

  try {
    // Конвейер фильтров — общий с SSR-мостом (`fetchAnimesPage`), здесь только
    // HTTP: разбор адреса, JSON и коды ошибок.
    // signal запроса: если браузер ушёл (сменил страницу/запрос), сервер
    // перестаёт ждать ответа. Общий запрос к API при этом дозаполнит кэш.
    const page = await fetchAnimesPage(parsed, { signal: request.signal })
    return Response.json(page, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    const { message, status } = upstreamFailure(error, 'api/shikimori/animes')
    return Response.json({ error: `Каталог Shikimori недоступен: ${message}` }, { status })
  }
}
