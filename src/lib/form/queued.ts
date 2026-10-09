// Исход «принято, результат позже».
//
// Исход, объявленный без протокола, хуже отсутствующего: значение есть,
// а что показывать и что делать с повтором — не сказано.
import type { Result } from './result'
import type { SubmissionId } from './types'

export interface QueuedData {
  /** Опрос при скрипте. */
  readonly pollUrl: string
  /** Ссылка для человека без скрипта. ОБЯЗАТЕЛЬНА: иначе исход — тупик. */
  readonly statusUrl: string
  readonly etaMs?: number
}

export const isQueued = (r: Result): boolean => r.outcome === 'queued'

export function queuedData(r: Result): QueuedData | undefined {
  if (!isQueued(r)) return undefined
  const d = r.data as QueuedData | undefined
  return d && typeof d.pollUrl === 'string' && typeof d.statusUrl === 'string' ? d : undefined
}

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

export type PollOutcome =
  | { done: true; result: Result }
  | { done: false; retryAfterMs: number }

/** Опрос до терминального исхода. Существует только при скрипте. */
/**
 * Опрос до терминального исхода. Существует только при скрипте.
 * @param d Адреса опроса из данных результата.
 * @param poll Транспорт опроса.
 * @param o Предел попыток и сигнал отмены.
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
    await new Promise((res) => setTimeout(res, r.retryAfterMs))
  }
  return undefined
}
