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
import { upstreamFailure } from '#lib/server/upstream.js'

export const GET: RequestHandler = async ({ url }) => {
  const parsed = parseCharactersQuery(url.searchParams)
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })

  try {
    const page = await fetchCharactersPage(parsed.query)
    return Response.json(page, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    const { message, status } = upstreamFailure(error, 'api/rickmorty/characters')
    return Response.json({ error: `Персонажи Rick and Morty недоступны: ${message}` }, { status })
  }
}
