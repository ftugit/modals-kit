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
 * `genres.and` — это `genre_v2` (или `genre` — зависит от версии `?api=`), и не должен. Схема читается только тогда,
 * когда фильтры в запросе есть: обычная страница каталога её не ждёт.
 */
import type { RequestHandler } from './$types'
import { parseAnimesQuery } from '#content/demo-catalog/shikimori/shikimori.server.js'
import { apiFailure, apiInvalid } from '#server/api-error.server.js'
import { fetchAnimesPage } from '#content/demo-catalog/shikimori/filters.server.js'
import { watchSchemaBuild } from '#content/demo-catalog/shikimori/schema.server.js'
import { taskResponse } from '#hooks/task-stream.server.js'

export const GET: RequestHandler = async ({ url, request }) => {
  const parsed = parseAnimesQuery(url.searchParams)
  if (!parsed.ok) return apiInvalid(parsed.error)

  // Ожидания (сборка схемы для фильтров, очередь лимита Shikimori) — строками ответа.
  return taskResponse(
    request,
    async () => {
      try {
        // Конвейер фильтров — общий с SSR-мостом (`fetchAnimesPage`), здесь только
        // HTTP: разбор адреса, JSON и коды ошибок.
        // signal запроса: если браузер ушёл (сменил страницу/запрос), сервер
        // перестаёт ждать ответа. Общий запрос к API при этом дозаполнит кэш.
        const page = await fetchAnimesPage(parsed, { signal: request.signal })
        return Response.json(page, { headers: { 'cache-control': 'no-store' } })
      } catch (error) {
        return apiFailure(error, 'api/shikimori/animes', 'Каталог Shikimori недоступен')
      }
    },
    { watch: [watchSchemaBuild(parsed.api)] },
  )
}
