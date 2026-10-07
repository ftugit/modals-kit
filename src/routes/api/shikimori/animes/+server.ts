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
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { parseAnimesQuery, ShikimoriUpstreamError } from '$lib/server/shikimori'
import { fetchAnimesPage } from '$lib/server/shikimori-filters'

export const GET: RequestHandler = async ({ url, request }) => {
  const parsed = parseAnimesQuery(url.searchParams)
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 })

  try {
    // Конвейер фильтров — общий с SSR-мостом (`fetchAnimesPage`), здесь только
    // HTTP: разбор адреса, JSON и коды ошибок.
    // signal запроса: если браузер ушёл (сменил страницу/запрос), сервер
    // перестаёт ждать ответа. Общий запрос к API при этом дозаполнит кэш.
    const page = await fetchAnimesPage(parsed, { signal: request.signal })
    return json(page, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    if (error instanceof ShikimoriUpstreamError) {
      return json({ error: error.message }, { status: error.status })
    }
    return json({ error: `Shikimori API: ${String(error)}` }, { status: 502 })
  }
}
