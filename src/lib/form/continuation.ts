// Продолжение: всё, что при скрипте лежит в памяти страницы, а без него
// обязано пережить круг.
//
// Носитель выбирает среда — ядро о нём не знает. Контракт три операции.
import type { FormError, Result } from './result'
import type { FormId, InstanceId, Revision, RowKey, SubmissionId } from './types'

export interface Continuation {
  readonly formId: FormId
  readonly instance: InstanceId
  readonly revision: Revision
  readonly specVersion?: number
  readonly submissionId: SubmissionId
  readonly rowKeys: readonly RowKey[]
  readonly values: Record<string, unknown>    // secret уже вырезаны
  readonly result?: Result
  readonly iat: number
  readonly exp: number
  readonly truncated?: 'values'
}

export interface ContinuationStore {
  read(ctx: unknown): Promise<Continuation | undefined> | Continuation | undefined
  write(c: Continuation, ctx: unknown): Promise<unknown> | unknown
  clear(ref: unknown, ctx: unknown): Promise<void> | void
}

export const CONTINUATION_TTL_MS = 15 * 60 * 1000

/**
 * Собрать продолжение с метками времени.
 * @param args Полное содержимое без `iat`/`exp`.
 * @param now Часы — для тестов.
 * @param ttl Время жизни.
 */
export function makeContinuation(
  args: Omit<Continuation, 'iat' | 'exp'>, now = Date.now(), ttl = CONTINUATION_TTL_MS,
): Continuation {
  return { ...args, iat: now, exp: now + ttl }
}

export const isExpired = (c: Continuation, now = Date.now()) => now > c.exp

/** Ключ изоляции: две одинаковые формы не делят продолжение. */
export const continuationKey = (c: Pick<Continuation, 'formId' | 'instance'>) =>
  `${c.formId}::${c.instance}`

/**
 * Продолжение — АДРЕСОВАННОЕ сообщение. Носителю не доверяют: кука общая
 * на весь сайт, ссылку с токеном можно переслать.
 */
/**
 * Продолжение — АДРЕСОВАННОЕ сообщение: форма и экземпляр обязаны совпасть,
 * и срок не истёк.
 * @param c Продолжение.
 * @param to Адресат.
 * @param now Часы — для тестов.
 */
export function addressedTo(
  c: Continuation | undefined, to: { formId: FormId; instance: InstanceId },
  now = Date.now(),
): boolean {
  if (!c) return false
  if (c.formId !== to.formId || c.instance !== to.instance) return false
  return !isExpired(c, now)
}

export interface Degraded {
  readonly continuation: Continuation
  /** 0 — влезло, 1 — значения урезаны, 3 — значения отброшены. */
  readonly level: 0 | 1 | 3
  readonly bytes: number
}

const sizeOf = (c: Continuation) => new TextEncoder().encode(JSON.stringify(c)).length

/**
 * Деградация строго упорядочена: «потерять можно удобство, нельзя — гарантию».
 * ЗАПРЕЩЁННЫЙ уровень — отбросить ошибки ради значений: так форма становится
 * немой ради экономии нескольких килобайт.
 */
/**
 * Деградация строго упорядочена: терять можно удобство, нельзя гарантию.
 * Уровень 1 — укоротить значения, уровень 3 — отбросить их, сохранив ошибки.
 * Отбросить ошибки ради значений ЗАПРЕЩЁН.
 * @param c Продолжение.
 * @param o Предел байт и длина значения для укорачивания.
 */
export function degrade(
  c: Continuation, o: { maxBytes: number; maxValueLength?: number },
): Degraded {
  let bytes = sizeOf(c)
  if (bytes <= o.maxBytes) return { continuation: c, level: 0, bytes }

  const limit = o.maxValueLength ?? 64
  const trimmed: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(c.values))
    trimmed[k] = typeof v === 'string' && v.length > limit ? v.slice(0, limit) : v
  const lvl1: Continuation = { ...c, values: trimmed, truncated: 'values' }
  bytes = sizeOf(lvl1)
  if (bytes <= o.maxBytes) return { continuation: lvl1, level: 1, bytes }

  const lvl3: Continuation = { ...c, values: {}, truncated: 'values' }
  return { continuation: lvl3, level: 3, bytes: sizeOf(lvl3) }
}

/** Ошибки продолжения — те же факты, просто пережившие круг. */
export const factsOf = (c: Continuation | undefined): readonly FormError[] =>
  c?.result?.errors ?? []
