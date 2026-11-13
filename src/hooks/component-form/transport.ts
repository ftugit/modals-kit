// Транспорт демо: единственное место, где происходит сетевой вызов — и то
// место, где чужой ответ переводится на язык формы.
//
// Почему нельзя просто вернуть `kind: 'network'`: связка показывает `code`
// как текст ошибки, а `detail` в показ не уходит (submit.ts:
// `message: outcome.code`). Пользователь увидел бы «http.403» вместо причины.
// Поэтому ответ, который НЕ является Result'ом (отказ CSRF у SvelteKit —
// текст или `{ message }`), оформляется Result'ом с `origin: 'external'`
// и исходом `unknown`: запрос мог дожить до записи, и врать «не применилось»
// здесь честнее, чем молча проглотить сбой.
import type { Envelope, Result, Transport } from '#lib/form/index.js'
import { fetchWithTask, type StreamTask } from '#lib/fetch/index.js'
import { parse } from 'devalue'

/** Заголовок маршрутизации встраиваемой формы: позволяет серверу узнать `formId` до чтения тела. */
export const FORM_ID_HEADER = 'x-form-id'

/** Что сказать человеку по коду, пока не подоспел текст из тела. */
const REASON: Record<number, string> = {
  400: 'запрос собран не по контракту формы',
  403: 'отправка отклонена: запрос пришёл с другого адреса (CSRF-проверка)',
  405: 'метод не разрешён для этого адреса',
  413: 'слишком большое тело запроса',
  415: 'неподдерживаемый тип тела запроса',
  429: 'слишком часто: повторите позже',
}

const isResult = (x: unknown): x is Result =>
  typeof x === 'object' && x !== null && (x as { v?: unknown }).v === 1 &&
  typeof (x as { ok?: unknown }).ok === 'boolean'

export function jsonTransport(path: string): Transport {
  return async (req) => {
    let res: Response
    try {
      // Ход долгой отправки (запуск базы, перенос схемы) — строками ответа
      // (`#lib/fetch` `readTaskStream`); итог тот же `Response`.
      const report = req.report
      res = await fetchWithTask(path, {
        method: 'POST',
        body: req.data,
        headers: { accept: 'application/json', [FORM_ID_HEADER]: req.envelope.formId },
        signal: req.signal,
        ...(report ? { onTask: (task: StreamTask) => report(task) } : {}),
      })
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return { kind: 'abort', reason: 'aborted' }
      return { kind: 'network', code: 'network.failed', detail: String(e) }
    }

    const ct = res.headers.get('content-type') ?? ''
    let body: unknown = null
    let raw = ''
    if (ct.includes('application/json')) {
      body = await res.json().catch(() => null)
    } else {
      raw = (await res.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 300)
      // Фреймворк умеет отвечать JSON'ом и на отказ: `{ message }` без контракта.
      try { body = JSON.parse(raw) } catch { body = null }
    }

    if (isResult(body)) return { kind: 'result', result: body }

    const said = typeof (body as { message?: unknown } | null)?.message === 'string'
      ? String((body as { message: string }).message)
      : raw
    const message = [REASON[res.status] ?? `сервер ответил HTTP ${res.status}`, said]
      .filter(Boolean)
      .join('. ')

    const { formId, instance, submissionId, revision } = req.envelope
    return {
      kind: 'result',
      result: {
        v: 1, formId, instance, submissionId, revision,
        values: {}, ok: false, status: res.status, outcome: 'unknown',
        errors: [{
          id: `*:transport.${res.status}:0`, code: `transport.${res.status}`,
          message, origin: 'external',
        }],
        from: 'fetch',
      },
    }
  }
}

/* ── транспорт NATИВНЫХ form-экшенов SvelteKit ─────────────────────────── */

/**
 * Ответ form-экшена SvelteKit (`accept: application/json`): HTTP-обёртка
 * `{ type: 'success'|'failure', data }`, где `data` — devalue-сериализация
 * `{ result }`. Распаковка — тем же devalue, что уже в бандле Kit; не-обёртка
 * (свой API-эндпоинт) проходит насквозь.
 */
/**
 * Адрес из Kit-редиректа экшена (`{ type: 'redirect', location }`).
 *
 * Только свой относительный путь: внешний адрес в ответе — не маршрут, а
 * подмена, и вести туда форму нечего. `//хост` тоже не пропускаем.
 */
export function kitRedirectLocation(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const shaped = body as { type?: unknown; location?: unknown }
  if (shaped.type !== 'redirect') return null
  const location = typeof shaped.location === 'string' ? shaped.location.trim() : ''
  return /^\/(?!\/)/.test(location) ? location : null
}

/**
 * Адрес действия компонент-формы обязан быть абсолютным (корневой путь `/…`),
 * а не относительным к странице-носителю: модалка открывается поверх любого
 * адреса, и `./?/…` ушёл бы на носитель, где нужного экшена нет (P2-1).
 * Внешний адрес и `//хост` — тоже не действие формы. Возвращает нормализованный
 * путь либо `null` (транспорт откажет ДО сетевого вызова).
 */
export function kitActionTarget(url: string): string | null {
  const target = typeof url === 'string' ? url.trim() : ''
  return /^\/(?!\/)/.test(target) ? target : null
}

/** Успех, собранный на месте: действие применено, показать нечего. */
export function appliedResult(envelope: Envelope, status: number): Result {
  return {
    v: 1,
    formId: envelope.formId,
    instance: envelope.instance,
    submissionId: envelope.submissionId,
    revision: envelope.revision,
    values: {},
    ok: true,
    status,
    outcome: 'committed',
    errors: [],
    from: 'fetch',
  }
}

export function unwrapKitAction(body: unknown): { result?: Result } | undefined {
  if (!body || typeof body !== 'object') return undefined
  const shaped = body as { type?: string; data?: unknown }
  if (shaped.type !== 'success' && shaped.type !== 'failure') {
    const direct = (shaped as { data?: { result?: Result } }).data
    return direct && typeof direct === 'object' ? direct : undefined
  }
  try {
    return parse(shaped.data as string) as { result?: Result }
  } catch {
    return undefined
  }
}

/**
 * Транспорт отправки на СТРАНИЧНЫЙ экшен SvelteKit (`/path` без `?/имени` —
 * форма различает намерения по полю intent). Отличия от `jsonTransport`:
 * ответ — Kit-обёртка (распаковка `unwrapKitAction`); `prepare` — место
 * ДО сетевого вызова: так модуль пользователя подписывает challenge-токен секретом из
 * поля, не заводя собственный fetch.
 */
export function kitActionTransport(
  path: string | (() => string),
  options: { prepare?: (data: FormData) => void | Promise<void> } = {},
): Transport {
  return async (req) => {
    try {
      await options.prepare?.(req.data)
    } catch {
      /* prepare отвечает за понятный отказ сам: пустое поле подписи сервер
         разберёт как обычную ошибку входа */
    }
    const targetUrl = typeof path === 'function' ? path() : path
    // Инвариант P2-1: относительный адрес (`./?/…`) ушёл бы на страницу-носитель.
    // Отказываем до fetch — действие не применено, запрос не отправлен.
    const target = kitActionTarget(targetUrl)
    if (!target) {
      return {
        kind: 'result',
        result: {
          v: 1, ...req.envelope, values: {}, ok: false, status: 0, outcome: 'not-applied',
          errors: [{
            id: '*:transport.action-relative:0', code: 'transport.action-relative',
            message: 'Адрес действия формы должен быть абсолютным (корневой путь), а не относительным к странице-носителю',
            origin: 'external',
          }],
          from: 'fetch',
        },
      }
    }
    let res: Response
    try {
      // Ход долгой отправки — строками ответа (`#lib/fetch` `readTaskStream`):
      // канал тот же, что у `jsonTransport`, иначе форма, у которой база
      // запускается первым запросом, молчала бы о прогрессе.
      const report = req.report
      res = await fetchWithTask(target, {
        method: 'POST',
        body: req.data,
        headers: { accept: 'application/json', [FORM_ID_HEADER]: req.envelope.formId },
        signal: req.signal,
        ...(report ? { onTask: (task: StreamTask) => report(task) } : {}),
      })
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return { kind: 'abort', reason: 'aborted' }
      return { kind: 'network', code: 'network.failed', detail: String(e) }
    }
    const ct = res.headers.get('content-type') ?? ''
    const body = ct.includes('application/json') ? await res.json().catch(() => null) : null

    // Редирект экшена — не отказ и не «неизвестный ответ». Без JS браузер
    // пошёл бы по нему сам; с JS его раньше никто не применял, и форма
    // показывала «сервер ответил HTTP 200» там, где действие уже выполнено.
    // Переход делает клиент, адрес остаётся за сервером: тот же исход, что
    // без JS, и `invalidateAll` — чтобы страница перечитала свои данные.
    const redirect = kitRedirectLocation(body)
    if (redirect) {
      const { goto } = await import('$app/navigation')
      await goto(redirect, { invalidateAll: true })
      return { kind: 'result', result: appliedResult(req.envelope, res.status) }
    }

    const result = unwrapKitAction(body)?.result
    if (result) return { kind: 'result', result }
    return {
      kind: 'result',
      result: {
        v: 1, ...(req.envelope), values: {}, ok: false, status: res.status, outcome: 'unknown',
        errors: [{ id: `*:transport.${res.status}:0`, code: `transport.${res.status}`,
          message: REASON[res.status] ?? `сервер ответил HTTP ${res.status}`, origin: 'external' }],
        from: 'fetch',
      },
    }
  }
}
