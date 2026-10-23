/**
 * Единственное место, где пойманная ошибка становится ответом API-маршрута (B8).
 * Формат тела — `ApiErrorBody` (`#hooks/api-error.js`).
 */
import { FetchError, isAbortError } from '#lib/fetch/index.js'
import { apiErrorBody } from '#hooks/api-error.js'

/**
 * Пойманная ошибка → ответ маршрута.
 *
 * - Сбой внешнего сервиса (`FetchError`): его текст и код, статус 502/504;
 *   подробности (адрес, исходная ошибка) — только в лог.
 * - Обрыв клиентом: без лога, читать ответ уже некому.
 * - Всё прочее — наша ошибка: подробности в лог, клиенту общий текст, 500.
 *
 * @param error Пойманная ошибка.
 * @param where Метка маршрута для лога.
 * @param what Что не удалось, для человека: «Каталог Shikimori недоступен».
 */
export function apiFailure(error: unknown, where: string, what: string): Response {
  if (error instanceof FetchError) {
    console.warn(`[${where}] ${error.code}: ${error.message}`, error.cause ?? '')
    return Response.json(apiErrorBody(`${what}: ${error.message}`, error.code), { status: error.status })
  }
  if (!isAbortError(error)) console.error(`[${where}]`, error)
  return Response.json(apiErrorBody(`${what}: внутренняя ошибка сервера`, 'internal'), { status: 500 })
}

/** Кривой запрос клиента: 400 с кодом `query.invalid`. */
export function apiInvalid(message: string, field?: string): Response {
  return Response.json(apiErrorBody(message, 'query.invalid', field), { status: 400 })
}
