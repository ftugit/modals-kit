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
import { dispatchDbForm } from '../handle'
import { watchDb } from '#lib/server/db.js'
import { taskResponse } from '#lib/server/task-stream.js'

// Ход запуска базы и переноса схемы — строками ответа, если клиент их просил
// (`task-stream.ts`); иначе ответ прежний.
export const POST: RequestHandler = ({ request, locals }) =>
  taskResponse(
    request,
    async () => {
      const { result, status } = await dispatchDbForm(request, 'fetch', locals.dbCtx)
      return Response.json(result, { status: status === 0 ? 200 : status })
    },
    { watch: [watchDb] },
  )
