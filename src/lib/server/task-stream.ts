/**
 * Ход долгой операции — строками в ответе на сам запрос (docs/design/task-state.md).
 *
 *     {"task":{"status":"pending","scope":"global","label":"Запуск базы","progress":{…}}}
 *     {"task":{…}}
 *     {"result":{"status":200,"headers":{…},"body":{…обычный ответ…}}}
 *
 * Правила (решения владельца, ход 188):
 *  - строки только для клиента, который их просит (`Accept: application/x-ndjson`);
 *  - поток начинается ПО СОБЫТИЮ: источник сообщил «жду» раньше, чем готов ответ.
 *    Ответ готов раньше — он уходит как есть, байт в байт. Таймеров нет;
 *  - код и заголовки уже ушли (200), поэтому последняя строка несёт настоящий код,
 *    заголовки и тело: клиент (`readTaskStream` из `#lib/fetch`) собирает из неё тот
 *    же ответ, что пришёл бы без строк.
 *
 * Откуда берётся ход:
 *  - общие операции (запуск базы, сборка схемы) — подпиской `watch` обработчика:
 *    ждущие делят одну операцию и получают её ход, кто бы её ни начал;
 *  - ожидания внутри вызова (очередь лимита, повторы `#lib/fetch`) — через
 *    `currentReport()`: отчёт текущего запроса живёт в `AsyncLocalStorage`.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { TASK_STREAM_TYPE } from '#lib/fetch/index.js'
import type { TaskState } from '#lib/task/index.js'
import { apiErrorBody } from '../api-error'

export type TaskReport = (task: TaskState) => void
/** Подписка на ход общей операции на время запроса; возвращает отписку. */
export type TaskWatch = (report: TaskReport) => () => void

const current = new AsyncLocalStorage<TaskReport>()

/** Отчёт запроса, внутри которого идёт вызов; вне `taskResponse` — `undefined`. */
export function currentReport(): TaskReport | undefined {
  return current.getStore()
}

/** Клиент просит строки хода. */
export function wantsTaskStream(request: Request): boolean {
  return (request.headers.get('accept') ?? '').includes(TASK_STREAM_TYPE)
}

/**
 * Выполнить обработчик; если он ждёт долгую операцию — отдать ход строками.
 *
 *     export const GET = ({ request }) => taskResponse(request, () => handle(), { watch: [watchDb] })
 */
export function taskResponse(
  request: Request,
  run: () => Promise<Response>,
  options: { watch?: readonly TaskWatch[] } = {},
): Promise<Response> {
  if (!wantsTaskStream(request)) return run()
  return new Promise<Response>((resolve, reject) => {
    const encoder = new TextEncoder()
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    let done = false
    const line = (value: unknown) => {
      try {
        controller!.enqueue(encoder.encode(JSON.stringify(value) + '\n'))
      } catch {
        // Клиент ушёл, поток закрыт: писать некому.
      }
    }
    const report: TaskReport = (task) => {
      if (done) return
      if (!controller) {
        // `start` вызывается синхронно в конструкторе: контроллер есть сразу.
        const stream = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) })
        resolve(
          new Response(stream, {
            headers: {
              'content-type': `${TASK_STREAM_TYPE}; charset=utf-8`,
              'cache-control': 'no-store',
              'x-content-type-options': 'nosniff',
            },
          }),
        )
      }
      line({ task })
    }
    const unwatch = (options.watch ?? []).map((watch) => watch(report))
    const finish = () => {
      done = true
      for (const stop of unwatch) stop()
    }
    current.run(report, run).then(
      async (res) => {
        finish()
        if (!controller) return resolve(res)
        line({ result: await resultOf(res) })
        controller.close()
      },
      (error: unknown) => {
        finish()
        if (!controller) return reject(error)
        console.error('[task-stream]', error)
        line({ result: { status: 500, body: apiErrorBody('Внутренняя ошибка сервера', 'internal') } })
        controller.close()
      },
    )
  })
}

/**
 * Ответ → последняя строка: код, заголовки и тело — JSON объектом в `body`
 * (как в решении 1), всё прочее текстом в `text`; без тела — ни того, ни другого.
 */
async function resultOf(res: Response): Promise<{ status: number; headers: Record<string, string>; body?: unknown; text?: string }> {
  const headers: Record<string, string> = {}
  for (const [name, value] of res.headers) if (name !== 'content-length') headers[name] = value
  if (!res.body) return { status: res.status, headers }
  const text = await res.text()
  if ((headers['content-type'] ?? '').includes('json')) {
    try {
      return { status: res.status, headers, body: JSON.parse(text) }
    } catch {
      // не JSON, хоть и назван так, — отдать как есть
    }
  }
  return { status: res.status, headers, text }
}
