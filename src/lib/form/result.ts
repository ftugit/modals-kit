// Контракт «действие ⇄ результат»: общий язык браузера, сервера и показа.
import { defaultPolicy, type LimitPolicy } from './policy'
import type { FieldPath, FormId, InstanceId, Revision, SubmissionId } from './types'

/** Четыре значения, и ни одного «наверное». */
export type Outcome = 'not-applied' | 'committed' | 'unknown' | 'queued'

export interface FormError {
  readonly id: string            // стабильный: `${path|'*'}:${code}:${hash(params)}`
  readonly code: string
  /** Текст. Пустой — ошибка есть, но показывать нечего. */
  readonly message?: string
  readonly params?: Record<string, unknown>
  /** Есть путь — ошибка поля. Нет — общая. Других правил нет. */
  readonly path?: FieldPath
  readonly origin: 'core' | 'server' | 'external'
  /** Исходные данные чужой службы: чтобы манипулировать, не разбирая тело заново. */
  readonly source?: unknown
  /** Эта ошибка не даёт подсветки, даже если настройка велит считать по факту. */
  readonly silent?: boolean
  readonly retryable?: boolean
}

export interface Result<TData = unknown> {
  readonly v: 1
  readonly formId: FormId
  readonly instance: InstanceId
  readonly submissionId: SubmissionId
  readonly ok: boolean
  readonly status: number
  readonly outcome: Outcome
  readonly errors: readonly FormError[]
  readonly values: Record<string, unknown>
  readonly data?: TData
  readonly redirect?: string
  readonly revision: Revision
  /** Как пришёл результат. Свойство результата, а не момента отрисовки. */
  readonly from: 'action' | 'fetch'
}


export function hash(x: unknown): string {
  const s = stableStringify(x)
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0).toString(36)
}

export function stableStringify(x: unknown): string {
  if (x === null || typeof x !== 'object') return JSON.stringify(x) ?? 'null'
  if (Array.isArray(x)) return `[${x.map(stableStringify).join(',')}]`
  return `{${Object.keys(x as object).sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify((x as Record<string, unknown>)[k])}`)
    .join(',')}}`
}

export const stableId = (e: { path?: string; code: string; params?: unknown }) =>
  `${e.path ?? '*'}:${e.code}:${hash(e.params ?? null)}`

export type RenderMessage = (code: string, params?: Record<string, unknown>) => string

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`)

/**
 * Порядок стабилен — по пути, затем по коду: иначе два пути отправки давали бы
 * разные списки, и сравнение путей ловило бы шум вместо расхождения.
 */
export function normalizeErrors(
  errors: readonly FormError[], render: RenderMessage,
  limits: LimitPolicy = defaultPolicy.limits,
): FormError[] {
  const seen = new Set<string>()
  const out: FormError[] = []
  for (const e of errors) {
    const id = stableId(e)
    if (seen.has(id)) continue
    seen.add(id)
    // словарь не знает кода чужой службы и не обязан: готовый текст не затираем
    const rendered = render(e.code, e.params)
    const message = rendered === e.code && e.message && e.message !== e.code ? e.message : rendered
    out.push({ ...e, id, message: clip(message, limits.messageLength) })
    if (out.length >= limits.errors) break
  }
  return out.sort((a, b) => {
    const pa = a.path ?? '', pb = b.path ?? ''
    if (pa !== pb) return pa < pb ? -1 : 1
    return a.code < b.code ? -1 : a.code > b.code ? 1 : 0
  })
}
