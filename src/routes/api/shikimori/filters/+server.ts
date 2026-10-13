/**
 * GET /api/shikimori/filters — готовая схема фильтров каталога.
 *
 * Схема живёт в зоне источника (`#lib/server/shikimori-schema.js`): значения
 * прочитаны из живых справочников, связки объявлены там же, метка `builtAt`
 * говорит, когда это было. Роут ничего не считает на клиенте и ничего не
 * кэширует сам — серверная схема обновляется по TTL, а сборка одна на всех
 * (single-flight), поэтому «каждый клиент тянет своё» невозможно.
 *
 * Отдаётся только страницам этого сайта (`Sec-Fetch-Site: same-origin`, решение
 * владельца): адрес нужен браузеру, когда схема не пришла со страницей (источник
 * переключили в панели; сервер не собрал схему при отрисовке). Серверная загрузка
 * страницы сюда не ходит — она берёт схему из модуля напрямую. Отказ — 403 без тела.
 */
import type { RequestHandler } from './$types'
import { apiFailure } from '#lib/server/api-error.js'
import { getShikimoriFilterSchema } from '#lib/server/shikimori-schema.js'
import { sameOriginFetch } from '#lib/server/trusted-origins.js'
import { DEV } from 'esm-env'

export const GET: RequestHandler = async ({ request }) => {
  if (!sameOriginFetch(request, DEV)) return new Response(null, { status: 403 })
  try {
    const schema = await getShikimoriFilterSchema()
    return Response.json(schema, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    return apiFailure(error, 'api/shikimori/filters', 'Схема фильтров Shikimori недоступна')
  }
}
