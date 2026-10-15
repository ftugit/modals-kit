/**
 * GET /api/rickmorty/characters — страница персонажей Rick and Morty (F54).
 *
 * `?api=rest|graphql` выбирает версию API сервиса; остальные параметры у обеих
 * версий одинаковы (`page`, `limit`, `search`, `filters.*`). Конвейер общий с
 * SSR-мостом лоадера (`fetchCharactersPage`), здесь только HTTP: разбор адреса,
 * JSON и коды ошибок (502/504 с текстом → ErrorRow пагинатора).
 */
import type { RequestHandler } from './$types'
import { fetchCharactersPage, parseCharactersQuery } from '#lib/server/rickmorty.js'
import { apiFailure, apiInvalid } from '#lib/server/api-error.js'
import { taskResponse } from '#lib/server/task-stream.js'

export const GET: RequestHandler = async ({ url, request }) => {
  const parsed = parseCharactersQuery(url.searchParams)
  if (!parsed.ok) return apiInvalid(parsed.error)

  // Ожидания очереди и повторов — строками ответа (`task-stream.ts`).
  return taskResponse(
    request,
    async () => {
      try {
        const page = await fetchCharactersPage(parsed.query)
        return Response.json(page, { headers: { 'cache-control': 'no-store' } })
      } catch (error) {
        return apiFailure(error, 'api/rickmorty/characters', 'Персонажи Rick and Morty недоступны')
      }
    },
  )
}
