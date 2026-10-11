/**
 * GET /api/shikimori/filters — готовая схема фильтров каталога.
 *
 * Схема живёт в зоне источника (`#lib/server/shikimori-schema.js`): значения
 * прочитаны из живых справочников, связки объявлены там же, метка `builtAt`
 * говорит, когда это было. Роут ничего не считает на клиенте и ничего не
 * кэширует сам — серверная схема обновляется по TTL, а сборка одна на всех
 * (single-flight), поэтому «каждый клиент тянет своё» невозможно.
 */
import type { RequestHandler } from './$types'
import { upstreamFailure } from '#lib/server/shikimori.js'
import { getShikimoriFilterSchema } from '#lib/server/shikimori-schema.js'

export const GET: RequestHandler = async () => {
  try {
    const schema = await getShikimoriFilterSchema()
    return Response.json(schema, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    const { message, status } = upstreamFailure(error, 'api/shikimori/filters')
    return Response.json({ error: `Схема фильтров Shikimori недоступна: ${message}` }, { status })
  }
}
