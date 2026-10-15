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
import { apiFailure, apiInvalid } from '#lib/server/api-error.js'
import { getShikimoriFilterSchema, watchSchemaBuild } from '#lib/server/shikimori-schema.js'
import { taskResponse } from '#lib/server/task-stream.js'
import { sameOriginFetch } from '#lib/server/trusted-origins.js'
import { parseShikimoriApi } from '#lib/server/shikimori.js'
import { DEV } from 'esm-env'

export const GET: RequestHandler = async ({ request, url }) => {
  if (!sameOriginFetch(request, DEV)) return new Response(null, { status: 403 })
  // Версия API (`?api=rest|graphql|mix`): у каждой версии своя схема.
  const api = parseShikimoriApi(url.searchParams)
  if (!api.ok) return apiInvalid(api.error)
  // Сборка схемы — около десятка запросов к Shikimori: её ход идёт строками ответа.
  return taskResponse(
    request,
    async () => {
      try {
        const schema = await getShikimoriFilterSchema({ api: api.api })
        return Response.json(schema, { headers: { 'cache-control': 'no-store' } })
      } catch (error) {
        return apiFailure(error, 'api/shikimori/filters', 'Схема фильтров Shikimori недоступна')
      }
    },
    { watch: [watchSchemaBuild(api.api)] },
  )
}
