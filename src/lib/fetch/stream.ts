import { FetchError } from './errors.js'

/**
 * Ход долгой операции в ответе на сам запрос — сторона клиента.
 *
 * Сервер, который ждёт долгую операцию (запуск базы, очередь лимита чужого API),
 * может ответить строками NDJSON: сначала ход, последней строкой — сам ответ:
 *
 *     {"task":{"status":"pending","scope":"global","label":"Запуск базы","progress":{"kind":"steps","done":1,"total":4}}}
 *     {"result":{"status":200,"headers":{"content-type":"application/json"},"body":{…}}}
 *
 * Строки приходят, только если запрос их попросил (`accept: TASK_STREAM_ACCEPT`) и
 * сервер правда ждал; иначе ответ обычный. `readTaskStream` сводит оба случая к
 * одному: отдаёт ход в `onTask` и возвращает ТОТ ЖЕ `Response`, что пришёл бы без
 * строк, — с настоящим кодом, заголовками и телом. Проверка кода и чтение тела у
 * вызывающего не меняются.
 */

/** Тип ответа со строками хода. */
export const TASK_STREAM_TYPE = 'application/x-ndjson'
/** Значение `accept` для запроса, который умеет читать ход (обычный JSON — тоже). */
export const TASK_STREAM_ACCEPT = `${TASK_STREAM_TYPE}, application/json;q=0.9, */*;q=0.8`

/** Чем измеряется ход: честные байты или этапы процесса. */
export type StreamProgress =
  | { kind: 'bytes'; loaded: number; total: number }
  | { kind: 'steps'; done: number; total: number; step?: string }

/** Ход в строке ответа (тот же вид, что `TaskState` в `pending`). */
export interface StreamTask {
  status: 'pending'
  scope: 'local' | 'global'
  label?: string
  progress?: StreamProgress
}

type ResultLine = { status: number; headers?: Record<string, string>; body?: unknown; text?: string }

/**
 * Прочитать ответ, сообщая ход в `onTask`; вернуть ответ без строк.
 *
 * - Ответ со строками: каждая `{"task":…}` → `onTask`, `{"result":…}` → новый
 *   `Response` с её кодом, заголовками и телом. Поток оборвался до результата —
 *   `FetchError('fetch.network')`; кривая строка — `FetchError('fetch.parse')`.
 * - Обычный ответ с известной длиной (`Content-Length`, без сжатия): тело читается
 *   здесь, ход — байтами; возвращается копия с прочитанным телом.
 * - Иначе ответ возвращается как есть.
 *
 * @example
 * const res = await readTaskStream(await fetch(url, { headers: { accept: TASK_STREAM_ACCEPT } }), (task) => (state.task = task))
 * if (!res.ok) throw …
 * const data = await res.json()
 */
export async function readTaskStream(res: Response, onTask: (task: StreamTask) => void): Promise<Response> {
  const type = res.headers.get('content-type') ?? ''
  if (type.startsWith(TASK_STREAM_TYPE) && res.body) return readLines(res.body, onTask)
  const total = Number(res.headers.get('content-length'))
  if (!res.body || !(total > 0) || res.headers.get('content-encoding')) return res
  const chunks: Uint8Array[] = []
  let loaded = 0
  const reader = res.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.byteLength
    onTask({ status: 'pending', scope: 'local', progress: { kind: 'bytes', loaded, total } })
  }
  return new Response(new Blob(chunks as BlobPart[]), { status: res.status, statusText: res.statusText, headers: res.headers })
}

async function readLines(body: ReadableStream<Uint8Array>, onTask: (task: StreamTask) => void): Promise<Response> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    let cut: number
    while ((cut = buffer.indexOf('\n')) >= 0) {
      const raw = buffer.slice(0, cut).trim()
      buffer = buffer.slice(cut + 1)
      if (!raw) continue
      const line = parseLine(raw)
      if (line.task) onTask(line.task)
      if (line.result) {
        await reader.cancel().catch(() => undefined)
        return toResponse(line.result)
      }
    }
    if (done) break
  }
  throw new FetchError('fetch.network', 'ответ оборвался до результата')
}

function parseLine(raw: string): { task?: StreamTask; result?: ResultLine } {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (error) {
    throw new FetchError('fetch.parse', 'сервер прислал неразборчивую строку хода', { cause: error })
  }
  const line = (value ?? {}) as { task?: StreamTask; result?: ResultLine }
  if (line.result !== undefined && typeof line.result?.status !== 'number')
    throw new FetchError('fetch.parse', 'строка результата без кода ответа')
  return { task: line.task?.status === 'pending' ? line.task : undefined, result: line.result }
}

function toResponse(result: ResultLine): Response {
  const empty = result.status === 204 || result.status === 205 || result.status === 304
  const text = empty ? null : (result.text ?? (result.body === undefined ? null : JSON.stringify(result.body)))
  return new Response(text, { status: result.status, headers: result.headers })
}
