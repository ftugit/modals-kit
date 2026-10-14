/**
 * Перехваченный путь: тот же приём, другая кодировка ответа (как `/form/submit`).
 *
 * `Transport` из `lib/form` шлёт сюда `fetch` с `accept: application/json`,
 * поэтому страница НЕ перезагружается: ответ — `Result` формы, а не HTML.
 * Приём тот же, что у нативного `?/create`/`?/remove`: `createFormHandler`
 * (метод, origin, лимит тела, имена, lock-revision, валидация, execute) —
 * расхождение «клиент проверяет одно, сервер другое» здесь невозможно.
 */
import type { RequestHandler } from './$types'
import { dispatchDbForm } from '#lib/demo/db-form/handle.js'

export const POST: RequestHandler = async ({ request, locals }) => {
  const { result, status } = await dispatchDbForm(request, 'fetch', locals.dbCtx)
  return Response.json(result, { status: status === 0 ? 200 : status })
}
