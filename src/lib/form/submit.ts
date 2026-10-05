// Единая точка входа и конвейер отправки.
import { decode, stripSecret, type EntrySource } from './decode'
import type { FormDescription } from './describe'
import { buildEnvelope, verifyEnvelope, type Envelope } from './envelope'
import { normalizeErrors, stableId, type FormError, type RenderMessage, type Result } from './result'
import { validateForm, type ValidateOptions } from './validate'
import type { Revision } from './types'

/** Настройки evaluate. */
export interface EvaluateOptions extends ValidateOptions {
  /** Словарь текстов для нормализации ошибок. */
  render: RenderMessage
  /** Ожидаемый экземпляр формы. */
  instance?: string
  /** `false` — для локальной перепроверки, где конверта может не быть. */
  requireEnvelope?: boolean
}

/** Вердикт evaluate: конверт, значения и ошибки. */
export interface Evaluation {
  /** Проверенный конверт, если требовался. */
  envelope?: Envelope
  /** Полные значения по типам полей. */
  values: Record<string, unknown>
  /** Значения без секретных полей. */
  publicValues: Record<string, unknown>
  /** Нормализованные ошибки проверки. */
  errors: readonly FormError[]
  /** Намерение из конверта. */
  intent: string
  /** Отказ конверта: дальше разбирать нечего. */
  fatal?: FormError
}

/**
 * ЕДИНАЯ ТОЧКА ВХОДА: пара (FormData, описание) → вердикт.
 * Её зовут оба пути: перехваченная отправка в браузере и серверный приём
 * нативной. Параметра «режим» у неё нет.
 */
export function evaluate(form: EntrySource, d: FormDescription, o: EvaluateOptions): Evaluation {
  let envelope: Envelope | undefined
  let intent = 'submit'

  if (o.requireEnvelope !== false) {
    const verdict = verifyEnvelope(form, d, { instance: o.instance })
    if (!verdict.ok) {
      const fatal: FormError = {
        id: stableId({ code: verdict.code, params: { detail: verdict.detail } }),
        code: verdict.code,
        message: o.render(verdict.code, { detail: verdict.detail }),
        params: { detail: verdict.detail }, origin: 'server',
      }
      return { values: {}, publicValues: {}, errors: [fatal], intent, fatal }
    }
    envelope = verdict.envelope
    intent = verdict.envelope.intent
  }

  const { action } = d.policy.intent.parse(intent)
  const descriptor = d.actions.find((a) => a.id === action) ?? d.actions[0]!
  const { values, structural } = decode(form, d)

  const errors = descriptor.validate === 'none' ? [] : validateForm(d, values, {
    relax: descriptor.relax,
    subset: o.subset ?? descriptor.subset,
    structural,
    cardinality: o.cardinality,
    formValidator: o.formValidator,
  })

  return {
    envelope, values, intent,
    publicValues: stripSecret(values, d),
    errors: normalizeErrors(errors, o.render, d.policy.limits),
  }
}

/* ── транспорт ─────────────────────────────────────────────────────── */

/** Три вида исхода, и ничего про HTTP: ядро сеть не делает. */
export type TransportOutcome<T = unknown> =
  | { kind: 'result'; result: Result<T> }
  | { kind: 'network'; code: string; detail?: string }
  | { kind: 'abort'; reason: string }

export interface TransportRequest {
  envelope: Envelope
  data: FormData
  accept: readonly string[]
  signal?: AbortSignal
}
export type Transport<T = unknown> = (req: TransportRequest) => Promise<TransportOutcome<T>>

/* ── гонки ─────────────────────────────────────────────────────────── */

export interface SubmissionHandle {
  id: string
  intent: string
  rev: Revision
  startedAt: number
  controller: AbortController
}

/**
 * Новая ручка отправки: идентификатор идемпотентности и контроллер отмены.
 * @param rev Ревизия описания на старте.
 * @param intent Намерение отправки.
 * @param id Заданный идентификатор (например, из продолжения).
 */
export const newSubmission = (rev: Revision, intent: string, id?: string): SubmissionHandle =>
  ({ id: id ?? crypto.randomUUID(), intent, rev, startedAt: Date.now(), controller: new AbortController() })

export type ParallelPolicy = 'block' | 'replace' | 'queue'

/** Объект отправки вместо счётчиков: сравнение ссылок однозначно. */
export class SubmitMachine {
  #current?: SubmissionHandle
  #queue: Array<() => void> = []

  constructor(public policy: ParallelPolicy = 'block') {}
  get current() { return this.#current }

  /**
   * Занять слот отправки согласно политике параллелизма.
   * @returns `go` — можно отправлять, `blocked`/`queued` — политика отказала.
   */
  begin(rev: Revision, intent: string, id?: string):
    { go: true; submission: SubmissionHandle } | { go: false; reason: 'blocked' | 'queued' } {
    if (this.#current) {
      if (this.policy === 'block') return { go: false, reason: 'blocked' }
      if (this.policy === 'replace') this.#current.controller.abort('superseded')
      if (this.policy === 'queue') { this.#queue.push(() => undefined); return { go: false, reason: 'queued' } }
    }
    const next = newSubmission(rev, intent, id)
    this.#current = next
    return { go: true, submission: next }
  }

  /**
   * Устарела ли отправка: отменена, вытеснена или описание сменило ревизию.
   * @param s Ручка отправки.
   * @param revision Ревизия на момент сверки.
   */
  stale(s: SubmissionHandle, revision: Revision): boolean {
    return this.#current !== s || s.controller.signal.aborted || s.rev !== revision
  }

  /**
   * Освободить слот и разбудить очередь.
   * @param s Ручка завершённой отправки.
   */
  finish(s: SubmissionHandle) {
    if (this.#current === s) this.#current = undefined
    this.#queue.shift()?.()
  }
  abort(reason = 'unmounted') {
    this.#current?.controller.abort(reason)
    this.#current = undefined
    this.#queue = []
  }
}

/* ── конвейер ──────────────────────────────────────────────────────── */

/** Вход конвейера отправки. */
export interface RunSubmitInput<T = unknown> {
  /** Описание на момент отправки. */
  description: FormDescription
  /** Данные формы, включая конверт. */
  data: FormData
  /** Экземпляр формы. */
  instance: string
  /** Ручка отправки от `SubmitMachine.begin`. */
  submission: SubmissionHandle
  /** Транспорт: сеть делает движок, ядро — нет. */
  transport: Transport<T>
  /** Словарь текстов. */
  render: RenderMessage
  /** Намерение, если известно заранее. */
  intent?: string
  /** Заголовок Accept для транспорта. */
  accept?: readonly string[]
}

/**
 * Конвейер отправки: конверт → локальная проверка тем же `evaluate` →
 * транспорт → результат. Прервано и сеть дают честные исходы.
 * @param input Описание, данные, ручка отправки и транспорт.
 */
export async function runSubmit<T>(input: RunSubmitInput<T>): Promise<Result<T>> {
  const { description: d, data, instance, submission, render } = input
  const intent = input.intent ?? 'submit'
  const { action } = d.policy.intent.parse(intent)

  const envelope: Envelope = {
    formId: d.id, revision: d.revision, instance, submissionId: submission.id, intent,
  }
  for (const [k, val] of Object.entries(buildEnvelope(envelope, d.policy))) data.set(k, val)
  data.set(d.policy.envelopeKeys.intent, intent)

  const base = {
    v: 1 as const, formId: d.id, instance, submissionId: submission.id,
    revision: d.revision, values: {} as Record<string, unknown>, from: 'fetch' as const,
  }

  // локальная проверка — ТОТ ЖЕ evaluate, что исполняет сервер
  const local = evaluate(data, d, { render, instance })
  const descriptor = d.actions.find((a) => a.id === action) ?? d.actions[0]!

  if (local.errors.length && descriptor.validate === 'full')
    return { ...base, ok: false, status: d.policy.status.validationFailed, outcome: 'not-applied',
             errors: local.errors, values: local.publicValues }

  let outcome: TransportOutcome<T>
  try {
    outcome = await input.transport({
      envelope, data,
      accept: input.accept ?? ['application/json', 'text/html;q=0.5'],
      signal: submission.controller.signal,
    })
  } catch (e) {
    outcome = { kind: 'network', code: 'network.failed', detail: String(e) }
  }

  if (outcome.kind === 'abort')
    return { ...base, ok: false, status: d.policy.status.aborted, outcome: 'not-applied',
             errors: [], values: local.publicValues }

  if (outcome.kind === 'network') {
    // исход unknown: клиент НЕ ЗНАЕТ, дошёл ли запрос
    const err: FormError = {
      id: stableId({ code: outcome.code }), code: outcome.code,
      message: outcome.code, origin: 'core', retryable: false,
    }
    return { ...base, ok: false, status: d.policy.status.unknown, outcome: 'unknown',
             errors: normalizeErrors([err], render, d.policy.limits), values: local.publicValues }
  }
  return { ...outcome.result, from: 'fetch' }
}
