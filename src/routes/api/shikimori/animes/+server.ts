/**
 * GET /api/shikimori/animes — страница каталога живого источника.
 *
 * Тонкая обёртка над серверным транспортом: разбор параметров (deny-safe),
 * один вызов `fetchAnimes` (с кэшем и троттлингом), JSON-ответ. Ошибки
 * внешнего API едут как 502/504 с текстом — пагинатор покажет их в ErrorRow,
 * а не «пустой список» (пустой список у него значит «данных нет», и это
 * разные состояния).
 */
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { fetchAnimes, parseAnimesQuery, ShikimoriUpstreamError } from '$lib/server/shikimori'

export const GET: RequestHandler = async ({ url, request }) => {
  const parsed = parseAnimesQuery(url.searchParams)
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 })

  try {
    // signal запроса: если браузер ушёл (сменил страницу/запрос), сервер
    // перестаёт ждать ответа. Общий запрос к API при этом дозаполнит кэш.
    const page = await fetchAnimes(parsed.query, { signal: request.signal })
    return json(page, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    if (error instanceof ShikimoriUpstreamError) {
      return json({ error: error.message }, { status: error.status })
    }
    return json({ error: `Shikimori API: ${String(error)}` }, { status: 502 })
  }
}
