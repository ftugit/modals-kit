import { FetchError } from './errors.js'

export interface ReadOptions {
  /**
   * Какие коды считать годным ответом. По умолчанию `res.ok` (2xx). Нужен, когда
   * «плохой» код — это данные: например, 404 «ничего не найдено» у REST.
   */
  accept?: (status: number) => boolean
}

/**
 * Проверить код ответа: негодный → `FetchError('fetch.status')`, тело
 * отпускается. Годный ответ возвращается как есть.
 */
export async function ensureOk(res: Response, options: ReadOptions = {}): Promise<Response> {
  const ok = options.accept ? options.accept(res.status) : res.ok
  if (ok) return res
  await res.body?.cancel().catch(() => undefined)
  throw new FetchError('fetch.status', `внешний сервис ответил ${res.status}`, {
    upstreamStatus: res.status,
    cause: { url: res.url || undefined, status: res.status },
  })
}

/**
 * Код ответа проверен, тело прочитано текстом.
 *
 * Ошибки — `FetchError`: `fetch.status` (негодный код), `fetch.timeout`
 * (таймаут попытки истёк во время чтения тела), `fetch.network` (обрыв).
 * Прерывание своим `signal` пробрасывается как есть (`AbortError`).
 */
export async function readText(res: Response, options: ReadOptions = {}): Promise<string> {
  await ensureOk(res, options)
  try {
    return await res.text()
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    const timeout = error instanceof Error && error.name === 'TimeoutError'
    throw new FetchError(
      timeout ? 'fetch.timeout' : 'fetch.network',
      timeout ? 'внешний сервис не ответил вовремя' : 'внешний сервис недоступен',
      { cause: error },
    )
  }
}

/**
 * Как {@link readText}, и тело разобрано как JSON; не JSON — `fetch.parse`.
 */
export async function readJson<T = unknown>(res: Response, options: ReadOptions = {}): Promise<T> {
  const text = await readText(res, options)
  try {
    return JSON.parse(text) as T
  } catch (error) {
    throw new FetchError('fetch.parse', 'внешний сервис прислал неразборчивый ответ', {
      upstreamStatus: res.status,
      cause: error,
    })
  }
}
