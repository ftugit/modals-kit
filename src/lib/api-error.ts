/**
 * Тело отказа наших API-маршрутов — одно на всё приложение.
 *
 *     { "error": "Каталог Shikimori недоступен: внешний сервис ответил 503",
 *       "code": "fetch.status" }
 *
 * `error` — текст, готовый к показу (так отвечали все маршруты и раньше, клиенты
 * читают `body.error`). `code` — по нему решают, а не по тексту: `fetch.*` —
 * сбой внешнего сервиса (`#lib/fetch`), `query.invalid` — кривой запрос,
 * `internal` — наша ошибка, коды `lib/db` — отказ базы. `field` — если отказ
 * относится к одному полю запроса.
 *
 * Модуль общий для сервера и браузера и ничего не тянет в бандл: тип формы
 * подключён только как тип.
 */
import type { ErrorInstruction } from '#lib/form/index.js'

export type ApiErrorBody = {
  /** Текст для человека. */
  error: string
  /** Код для кода: `fetch.timeout`, `query.invalid`, `internal`, … */
  code: string
  /** Имя поля запроса, к которому относится отказ. */
  field?: string
}

/** Собрать тело отказа (без пустого `field`). */
export function apiErrorBody(error: string, code: string, field?: string): ApiErrorBody {
  return field ? { error, code, field } : { error, code }
}

/**
 * Достать отказ из любого тела. Старое тело без `code` (`{ error }`) тоже
 * понимается: код тогда `unknown`. Не отказ — `null`.
 */
export function readApiError(body: unknown): ApiErrorBody | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (typeof b.error !== 'string' || b.error === '') return null
  const code = typeof b.code === 'string' && b.code ? b.code : 'unknown'
  return apiErrorBody(b.error, code, typeof b.field === 'string' ? b.field : undefined)
}

/** Отказ нашего маршрута на стороне клиента: текст, код и статус ответа. */
export class ApiError extends Error {
  readonly code: string
  readonly field: string | undefined
  readonly status: number
  constructor(body: ApiErrorBody, status: number) {
    super(body.error)
    this.name = 'ApiError'
    this.code = body.code
    this.field = body.field
    this.status = status
  }
}

/**
 * Негодный ответ маршрута → `ApiError`. Тело без формата (прокси, обрыв) —
 * `fallback` с кодом ответа и кодом `http.<статус>`.
 */
export async function responseError(res: Response, fallback: string): Promise<ApiError> {
  const body: unknown = await res.json().catch(() => null)
  return new ApiError(readApiError(body) ?? apiErrorBody(`${fallback}: ответ ${res.status}`, `http.${res.status}`), res.status)
}

/**
 * Инструкция `lib/form` для наших маршрутов: форма, которая шлёт запрос в свой
 * API, показывает отказ как обычную ошибку — у поля, если оно названо и есть
 * в `fields`, иначе общей.
 *
 * @example
 * defaultRegistry.registerInstruction(apiErrorInstruction({ fields: ['email'] }))
 */
export function apiErrorInstruction(
  options: { id?: string; fields?: readonly string[]; messages?: Readonly<Record<string, string>> } = {},
): ErrorInstruction {
  const aliases: Record<string, string> = {}
  for (const name of options.fields ?? []) aliases[name] = name
  return {
    id: options.id ?? 'api',
    parse: ({ body }) => {
      const e = readApiError(body)
      return e ? [{ code: e.code, field: e.field, message: e.error }] : null
    },
    aliases,
    ...(options.messages ? { messages: options.messages } : {}),
  }
}
