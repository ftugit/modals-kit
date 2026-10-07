/**
 * Артефакт словаря терминов каталога (`display\tdf` построчно) для клиентской
 * коррекции опечаток в lib search. Собирается из образца популярного
 * каталога — см. `getAnimeTermArtifact` в `src/content/anime.ts`.
 */
import { type RequestHandler } from '@sveltejs/kit'
import { getAnimeTermArtifact } from '../../../../content/anime'

export const GET: RequestHandler = async ({ fetch }) => {
  try {
    const text = await getAnimeTermArtifact({ fetchImpl: fetch })
    return new Response(text, {
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=300' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Словарь недоступен'
    return new Response(message, { status: 502 })
  }
}
