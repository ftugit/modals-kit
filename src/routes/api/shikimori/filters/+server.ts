/**
 * GET /api/shikimori/filters — готовая схема фильтров каталога.
 *
 * Схема живёт в зоне источника (`$lib/server/shikimori-schema`): значения
 * прочитаны из живых справочников, связки объявлены там же, метка `builtAt`
 * говорит, когда это было. Роут ничего не считает на клиенте и ничего не
 * кэширует сам — серверная схема обновляется по TTL, а сборка одна на всех
 * (single-flight), поэтому «каждый клиент тянет своё» невозможно.
 */
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { ShikimoriUpstreamError } from '$lib/server/shikimori'
import { getShikimoriFilterSchema } from '$lib/server/shikimori-schema'

export const GET: RequestHandler = async () => {
  try {
    const schema = await getShikimoriFilterSchema()
    return json(schema, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    const status = error instanceof ShikimoriUpstreamError ? error.status : 502
    return json({ error: `Схема фильтров Shikimori недоступна: ${String(error)}` }, { status })
  }
}
