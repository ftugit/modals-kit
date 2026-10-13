// Одна ошибка сети на всё приложение. Откуда сбой, видно по `code`, а не по
// классу-наследнику: решение принимается по коду, текст можно показать клиенту.

/** Почему запрос не дал годного ответа. */
export type FetchErrorCode =
  /** Сервис не ответил за отведённое время (после всех повторов). */
  | 'fetch.timeout'
  /** Соединение не удалось: DNS, обрыв, отказ (после всех повторов). */
  | 'fetch.network'
  /** Сервис ответил кодом, который вызывающий не принимает (`readJson`, `ensureOk`). */
  | 'fetch.status'
  /** Тело ответа не разобрать (обещан JSON, пришло другое). */
  | 'fetch.parse'
  /** Ответ разобран, но по смыслу это отказ (например, `errors` в GraphQL). */
  | 'fetch.rejected'

export interface FetchErrorOptions extends ErrorOptions {
  /** Код ответа сервиса, если ответ был. */
  upstreamStatus?: number
  /** Статус для НАШЕГО ответа. По умолчанию 504 для timeout/network, иначе 502. */
  status?: number
}

/**
 * Сбой внешнего сервиса.
 *
 * `message` — наш текст без адресов и подробностей, его можно показать клиенту.
 * Исходная ошибка, адрес и тексты сервиса — только в `cause`, для лога.
 * `status` — каким кодом отвечать НАШЕМУ клиенту: 504 (сервис не ответил) или
 * 502 (ответил плохо). `upstreamStatus` — что ответил сам сервис.
 */
export class FetchError extends Error {
  readonly code: FetchErrorCode
  readonly status: number
  readonly upstreamStatus: number | undefined

  constructor(code: FetchErrorCode, message: string, options: FetchErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'FetchError'
    this.code = code
    this.upstreamStatus = options.upstreamStatus
    this.status = options.status ?? (code === 'fetch.timeout' || code === 'fetch.network' ? 504 : 502)
  }
}

/** Прерывание вызывающим (свой `signal`) — не сбой сервиса, а отказ ждать. */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
