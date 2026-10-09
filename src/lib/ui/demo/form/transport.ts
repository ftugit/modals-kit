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
import type { Result, Transport } from '$lib/form'

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
      res = await fetch(path, {
        method: 'POST',
        body: req.data,
        headers: { accept: 'application/json' },
        signal: req.signal,
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
