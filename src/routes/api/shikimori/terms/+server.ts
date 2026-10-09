/**
 * GET /api/shikimori/terms — словарь коррекции опечаток (`display\tdf`).
 *
 * Собирается из ЖИВОГО каталога (несколько страниц популярности) и кэшируется
 * на час — см. `getTermArtifact`. Формат тот же, что у канона: его разбирает
 * `createLazyCorrector` из `$lib/search`, а fuzzy-сопоставление исполняется
 * уже на клиенте (на сервере коррекция не выполняется никогда).
 */
import type { RequestHandler } from './$types'
import { getTermArtifact, ShikimoriUpstreamError } from '$lib/server/shikimori'

export const GET: RequestHandler = async ({ request }) => {
  try {
    const text = await getTermArtifact({ signal: request.signal })
    return new Response(text, {
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    })
  } catch (error) {
    const status = error instanceof ShikimoriUpstreamError ? error.status : 502
    return new Response(`Словарь Shikimori недоступен: ${String(error)}`, { status })
  }
}
