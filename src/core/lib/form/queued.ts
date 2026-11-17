// Исход «принято, результат позже».
//
// Исход, объявленный без протокола, хуже отсутствующего: значение есть,
// а что показывать и что делать с повтором — не сказано.
import type { Result } from './result'
import type { SubmissionId } from './types'

/** Данные отложенного исхода: адрес опроса и адрес статуса заявки. */
export interface QueuedData {
  /** Опрос при скрипте. */
  readonly pollUrl: string
  /** Ссылка для человека без скрипта. ОБЯЗАТЕЛЬНА: иначе исход — тупик. */
  readonly statusUrl: string
  readonly etaMs?: number
}

/** Исход «принято, обрабатывается» — по нему страница начинает опрос. */
export const isQueued = (r: Result): boolean => r.outcome === 'queued'

/** Данные очереди из результата; `undefined`, если исход не отложенный. */
export function queuedData(r: Result): QueuedData | undefined {
  if (!isQueued(r)) return undefined
  const d = r.data as QueuedData | undefined
  return d && typeof d.pollUrl === 'string' && typeof d.statusUrl === 'string' ? d : undefined
}

/** Отложенный исход без адреса опроса: связка не знает, что спрашивать. */
export class QueuedWithoutProtocolError extends Error {
  constructor(id: SubmissionId) {
    super(`[form] исход queued у отправки ${id} без pollUrl и statusUrl: ` +
          'форма не знает, что показывать, а без скрипта исход становится тупиком')
    this.name = 'QueuedWithoutProtocolError'
  }
}

/**
 * @param r Результат с исходом `queued`.
 * @throws {QueuedWithoutProtocolError} Нет ни `pollUrl`, ни `statusUrl`:
 *   без скрипта исход становится тупиком.
 */
export function assertQueuedProtocol(r: Result): void {
  if (isQueued(r) && !queuedData(r)) throw new QueuedWithoutProtocolError(r.submissionId)
}

/** Ответ опроса заявки: ещё не готово (с паузой) или готовый результат. */
export type PollOutcome =
  | { done: true; result: Result }
  | { done: false; retryAfterMs: number }

/** Потолок паузы между опросами: `retryAfterMs` приходит от сервера и ничем не ограничен. */
const MAX_POLL_DELAY_MS = 60_000
/** Пауза, если сервер прислал не число (NaN, Infinity, отрицательное). */
const FALLBACK_POLL_DELAY_MS = 1_000

/** Сон, который прерывает сигнал: отмена не ждёт конца паузы. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const done = () => { clearTimeout(t); signal?.removeEventListener('abort', done); resolve() }
    const t = setTimeout(done, ms)
    signal?.addEventListener('abort', done, { once: true })
  })
}

/**
 * Опрос до терминального исхода. Существует только при скрипте.
 *
 * Пауза — `retryAfterMs` сервера, но не дольше минуты (`MAX_POLL_DELAY_MS`):
 * значение приходит по сети, и без предела ответ `retryAfterMs: 1e9` подвешивал
 * опрос навсегда. Отмена (`signal`) прерывает и запрос, и паузу.
 * @param d Адреса опроса из данных результата.
 * @param poll Транспорт опроса.
 * @param o Предел попыток и сигнал отмены.
 * @returns Терминальный результат; `undefined` — попытки кончились или отменено.
 */
export async function pollUntilDone(
  d: QueuedData,
  poll: (url: string, signal?: AbortSignal) => Promise<PollOutcome>,
  o: { maxAttempts?: number; signal?: AbortSignal } = {},
): Promise<Result | undefined> {
  const max = o.maxAttempts ?? 30
  for (let i = 0; i < max; i++) {
    if (o.signal?.aborted) return undefined
    const r = await poll(d.pollUrl, o.signal)
    if (r.done) return r.result
    const wait = Number.isFinite(r.retryAfterMs) && r.retryAfterMs >= 0
      ? Math.min(r.retryAfterMs, MAX_POLL_DELAY_MS)
      : FALLBACK_POLL_DELAY_MS
    await sleep(wait, o.signal)
  }
  return undefined
}
