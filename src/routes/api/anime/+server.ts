/**
 * Бэкенд-прокси к Shikimori: браузер ходит только сюда, с самим API
 * разговаривает сервер (User-Agent, лимиты, отсутствие CORS — его забота).
 *
 * `?page=&limit=&q=` → `{ items, hasNext }`; `limit` клампится к 1..50
 * (потолок API), `q` санитаризуется. Ошибки внешнего API → 502 с текстом:
 * клиентский источник покажет их строкой ошибки пагинатора.
 */
import { json, type RequestHandler } from '@sveltejs/kit'
import { fetchAnimePage } from '../../../content/anime'

export const GET: RequestHandler = async ({ url, fetch }) => {
  try {
    const page = await fetchAnimePage(
      {
        page: url.searchParams.get('page'),
        limit: url.searchParams.get('limit'),
        q: url.searchParams.get('q'),
      },
      { fetchImpl: fetch },
    )
    return json(page, { headers: { 'cache-control': 'public, max-age=15' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Источник аниме недоступен'
    return json({ message }, { status: 502 })
  }
}
