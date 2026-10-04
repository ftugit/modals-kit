// Приём запроса: переставляемые слои с готовым набором по умолчанию.
//
// Модуль предназначен только для серверного кода. Порядок слоёв менять можно,
// выбрасывать обязательные — нет.
import { runAsyncChecks, type CheckRegistry } from './async'
import { applyHandler, type ErrorContext, type ErrorHandler } from './errors'
import type { FormDescription } from './describe'
import { makeRenderer, ru, type MessageDictionary } from './messages'
import { normalizeErrors, stableId, type FormError, type Outcome, type Result } from './result'
import { runSchema, type StandardSchemaLike } from './schema'
import type { DescriptionSource } from './source'
import { evaluate } from './submit'
import { nameProblem } from './policy'
import type { SubmissionId } from './types'

export interface Limits {
  readonly maxBytes: number
  readonly maxKeys: number
  readonly maxFileSize: number
  readonly maxValuesPerKey: number
  readonly timeoutMs: number
}

export const DEFAULT_LIMITS: Limits = {
  maxBytes: 2 * 1024 * 1024, maxKeys: 256, maxFileSize: 8 * 1024 * 1024,
  maxValuesPerKey: 64, timeoutMs: 15_000,
}

/** Различение «дошёл / не дошёл» — основа семантики исхода. */
export type Reached = 'rejected' | 'validating' | 'executing' | 'committed'

export interface Rejection { status: number; code: string; params?: Record<string, unknown> }
export const reject = (status: number, code: string, params?: Record<string, unknown>): Rejection =>
  ({ status, code, params })

export interface Ctx {
  readonly request: Request
  description: FormDescription
  limits: Limits
  reached: Reached
  form?: FormData
  warnings: FormError[]
}

export type Layer = (ctx: Ctx) => Promise<Rejection | undefined> | Rejection | undefined

/* ── слои ──────────────────────────────────────────────────────────── */

/** Слой 01. Только объявленные методы. Отказ БЕЗ ЧТЕНИЯ ТЕЛА. */
export const methodLayer = (allowed: readonly string[] = ['POST']): Layer => (ctx) =>
  allowed.includes(ctx.request.method) ? undefined : reject(405, 'method.not-allowed')

export interface OriginOptions {
  readonly allowed: readonly string[]
  /** По умолчанию ВЫКЛЮЧЕН: корпоративные прокси вырезают заголовки. */
  readonly strict?: boolean
}

/** Слой 02. Пересылаемые заголовки недоверенные и в решении не участвуют. */
export const originLayer = (o: OriginOptions): Layer => (ctx) => {
  const origin = ctx.request.headers.get('origin')
  if (origin) return o.allowed.includes(origin) ? undefined : reject(403, 'origin.rejected')

  const referer = ctx.request.headers.get('referer')
  if (referer) {
    const match = o.allowed.some((a) => referer === a || referer.startsWith(`${a}/`))
    if (!match) return reject(403, 'origin.rejected')
    // известный компромисс: запрос без Origin принимается, если Referer совпал
    return o.strict ? reject(403, 'origin.rejected') : undefined
  }
  return o.strict ? reject(403, 'origin.rejected') : undefined
}

/**
 * Слой 03. Чтение тела.
 *
 * Самая тонкая дыра приёма форм: проверка объявленной длины не спасает, если
 * длину не объявили. Поэтому поток считается счётчиком и обрывается на границе,
 * и только потом отдаётся на разбор.
 */
export const bodyLayer: Layer = async (ctx) => {
  const type = ctx.request.headers.get('content-type') ?? ''
  if (!type.startsWith('multipart/form-data') && !type.startsWith('application/x-www-form-urlencoded'))
    return reject(415, 'body.unsupported-type')

  const declared = Number(ctx.request.headers.get('content-length') ?? 0)
  if (declared > ctx.limits.maxBytes) return reject(413, 'body.too-large')

  let form: FormData
  try { form = await metered(ctx.request, ctx.limits).formData() }
  catch { return reject(413, 'body.too-large') }

  const keys = [...new Set(form.keys())]
  if (keys.length > ctx.limits.maxKeys) return reject(413, 'body.too-many-keys')

  for (const key of keys) {
    const all = form.getAll(key)
    if (all.length > ctx.limits.maxValuesPerKey) return reject(413, 'request.too-many', { name: key })
    // предел на КАЖДЫЙ файл отдельно: суммарного недостаточно
    for (const value of all)
      if (typeof value !== 'string' && value.size > ctx.limits.maxFileSize)
        return reject(413, 'file.too-large', { name: value.name })
  }
  ctx.form = form
  return undefined
}

function metered(request: Request, limits: Limits): Request {
  if (!request.body) return request
  let seen = 0
  const stream = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength
      if (seen > limits.maxBytes) { controller.error(new Error('body.too-large')); return }
      controller.enqueue(chunk)
    },
  }))
  return new Request(request.url, {
    method: request.method, headers: request.headers, body: stream,
    // @ts-expect-error поле требуется средой при потоковом теле
    duplex: 'half',
  })
}

/**
 * Слой 04. Имена. Неизвестное поле, повтор одиночного и лишние значения —
 * ОТКАЗ, а не починка: «взять первое значение» скрывает ошибку клиента
 * или атаку и делает отладку невозможной.
 */
export const namesLayer: Layer = (ctx) => {
  const { form, description: d } = ctx
  if (!form) return undefined
  const envelope = new Set(Object.values(d.policy.envelopeKeys))

  for (const key of new Set(form.keys())) {
    if (envelope.has(key)) continue
    const field = d.byName[key]
    if (!field) return reject(400, 'request.unexpected-field', { name: key })
    if (nameProblem(key, d.policy.names)) return reject(400, 'request.unexpected-field', { name: key })
    const multiple = d.registry.types.get(field.kind).multiple
    if (!multiple && form.getAll(key).length > 1)
      return reject(400, 'request.duplicate', { name: key })
  }
  return undefined
}

/* ── идемпотентность и частота ─────────────────────────────────────── */

/**
 * Без этого семантика исхода неполна: «неизвестно» говорит «не повторяйте»,
 * но повтор всё равно возможен.
 */
export interface IdempotencyStore {
  get(key: SubmissionId): Promise<Result | undefined> | Result | undefined
  put(key: SubmissionId, result: Result, ttlMs: number): Promise<void> | void
}

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000

export class MemoryIdempotencyStore implements IdempotencyStore {
  #map = new Map<string, { result: Result; exp: number }>()
  constructor(private readonly now: () => number = Date.now) {}
  get(key: SubmissionId) {
    const hit = this.#map.get(key)
    if (!hit) return undefined
    if (hit.exp < this.now()) { this.#map.delete(key); return undefined }
    return hit.result
  }
  put(key: SubmissionId, result: Result, ttlMs: number) {
    this.#map.set(key, { result, exp: this.now() + ttlMs })
  }
  get size() { return this.#map.size }
}

export interface ThrottleVerdict { allowed: boolean; retryAfterMs?: number }
export interface Throttle {
  check(ctx: { request: Request }): Promise<ThrottleVerdict> | ThrottleVerdict
}

/** Отказ по частоте идёт ДО чтения тела: иначе отказ расходует предел. */
export function windowThrottle(
  o: { limit: number; windowMs: number; key?: (r: Request) => string },
  now: () => number = Date.now,
): Throttle {
  const hits = new Map<string, number[]>()
  const keyOf = o.key ?? ((r: Request) => r.headers.get('x-forwarded-for') ?? 'anon')
  return {
    check({ request }) {
      const key = keyOf(request)
      const t = now()
      const list = (hits.get(key) ?? []).filter((x) => t - x < o.windowMs)
      if (list.length >= o.limit) {
        hits.set(key, list)
        return { allowed: false, retryAfterMs: o.windowMs - (t - list[0]!) }
      }
      list.push(t)
      hits.set(key, list)
      return { allowed: true }
    },
  }
}

/* ── обработчик ────────────────────────────────────────────────────── */

export interface ExecuteContext<V = Record<string, unknown>> {
  readonly values: V
  readonly intent: string
  readonly request: Request
  /** Явное подтверждение успеха. «Не упало — значит хорошо» даёт «неизвестно». */
  commit(): void
  /** После фиксации: сбой уходит в предупреждения, а не отменяет результат. */
  after(fn: () => Promise<void> | void): void
  /** Ошибки ПОЛЕЙ, а не общий сбой. */
  fail(errors: readonly FormError[], outcome?: Outcome): never
}

export class ExecuteFailure extends Error {
  constructor(readonly errors: readonly FormError[], readonly outcome?: Outcome) {
    super('[form] обработчик вернул ошибки полей')
    this.name = 'ExecuteFailure'
  }
}

export interface HandlerOptions<T = unknown> {
  description: FormDescription
  /** Источник описания для полей из рантайма. */
  source?: DescriptionSource
  instance?: string
  origin?: OriginOptions
  limits?: Partial<Limits>
  messages?: MessageDictionary
  /** Асинхронные проверки: на сервере выполняются ВСЕГДА. */
  checks?: CheckRegistry
  schema?: StandardSchemaLike
  idempotency?: IdempotencyStore
  throttle?: Throttle
  /** Обработчик ошибок проекта. Проходят оба пути. */
  onErrors?: ErrorHandler
  observe?: (e: Record<string, unknown>) => void
  order?: readonly Layer[]
  execute(ctx: ExecuteContext): Promise<{ data?: T; redirect?: string }> | { data?: T; redirect?: string }
}

export interface Handled<T = unknown> { result: Result<T>; status: number }

/** Приём запроса. Возвращает РЕЗУЛЬТАТ, кодировку выбирает маршрут. */
export function createFormHandler<T>(o: HandlerOptions<T>) {
  const base = o.description
  const render = makeRenderer([o.messages, base.messages as never, ru], base.policy.interpolate)
  const limits: Limits = { ...DEFAULT_LIMITS, ...o.limits }

  const layers: readonly Layer[] = o.order ?? [
    methodLayer(),
    ...(o.origin ? [originLayer(o.origin)] : []),
    bodyLayer,
    namesLayer,
  ]

  return async function handle(request: Request, from: 'action' | 'fetch' = 'action'):
    Promise<Handled<T>> {
    const started = Date.now()
    const ctx: Ctx = { request, description: base, limits, reached: 'rejected', warnings: [] }
    const status = base.policy.status

    const make = (
      part: Partial<Result<T>> & { ok: boolean; status: number; outcome: Outcome },
    ): Result<T> => ({
      v: 1, formId: ctx.description.id, instance: o.instance ?? `${ctx.description.id}:new`,
      submissionId: '00000000-0000-4000-8000-000000000000',
      revision: ctx.description.revision, values: {}, errors: [], from, ...part,
    })

    const fail = (r: Rejection): Handled<T> => {
      const error: FormError = {
        id: stableId({ code: r.code, params: r.params }), code: r.code,
        message: render(r.code, r.params ?? {}), params: r.params,
        origin: 'server', retryable: false,
      }
      return {
        status: r.status,
        result: make({ ok: false, status: r.status, outcome: 'not-applied', errors: [error] }),
      }
    }

    const finish = (handled: Handled<T>): Handled<T> => {
      // обработчик ошибок проходят ОБА пути
      const ectx: ErrorContext = {
        from, intent: 'submit', outcome: handled.result.outcome,
      }
      const shown = applyHandler(handled.result.errors, ectx, o.onErrors)
      o.observe?.({
        submissionId: handled.result.submissionId, outcome: handled.result.outcome,
        ms: Date.now() - started, errors: handled.result.errors.length,
        removed: shown.removed, reached: ctx.reached,
      })
      return { ...handled, result: { ...handled.result, errors: shown.errors } }
    }

    try {
      if (o.throttle) {
        const verdict = await o.throttle.check({ request })
        if (!verdict.allowed)
          return finish(fail(reject(429, 'rate.limited', { retryAfterMs: verdict.retryAfterMs })))
      }

      for (const layer of layers) {
        const r = await layer(ctx)
        if (r) return finish(fail(r))
      }

      // набор полей НЕ приходит от клиента: описание поднимает сервер
      if (o.source) {
        const keys = ctx.description.policy.envelopeKeys
        const specRaw = ctx.form?.get(keys.spec)
        ctx.description = await o.source.resolve({
          formId: ctx.description.id,
          instance: o.instance ?? `${ctx.description.id}:new`,
          specVersion: typeof specRaw === 'string' ? Number(specRaw) : undefined,
        })
      }

      const ev = evaluate(ctx.form!, ctx.description, { render, instance: o.instance })
      if (ev.fatal) return finish(fail(reject(400, ev.fatal.code, ev.fatal.params)))

      const submissionId = ev.envelope!.submissionId
      const withId = (part: Partial<Result<T>> & { ok: boolean; status: number; outcome: Outcome }) =>
        make({ ...part, submissionId, instance: ev.envelope!.instance, values: ev.publicValues })

      ctx.reached = 'validating'
      const errors = [...ev.errors]

      // внешняя схема и асинхронные проверки — только если синхронные прошли:
      // проверять межполевое и чужое поверх мусора бессмысленно
      if (!errors.length && o.schema) errors.push(...await runSchema(o.schema, ev.values))
      if (!errors.length && o.checks)
        errors.push(...await runAsyncChecks(ctx.description, ev.values, o.checks))

      if (errors.length)
        return finish({
          status: status.validationFailed,
          result: withId({
            ok: false, status: status.validationFailed, outcome: 'not-applied',
            errors: normalizeErrors(errors, render, ctx.description.policy.limits),
          }),
        })

      // повтор той же отправки не выполняется заново
      if (o.idempotency) {
        const prev = await o.idempotency.get(submissionId)
        if (prev) {
          ctx.reached = 'committed'
          return finish({ status: prev.status, result: prev as Result<T> })
        }
      }

      ctx.reached = 'executing'
      let committed = false
      const afters: Array<() => Promise<void> | void> = []
      let out: { data?: T; redirect?: string }

      try {
        out = await o.execute({
          values: ev.values, intent: ev.intent, request,
          commit: () => { committed = true; ctx.reached = 'committed' },
          after: (fn) => { afters.push(fn) },
          fail: (list, outcome) => { throw new ExecuteFailure(list, outcome) },
        })
      } catch (e) {
        if (e instanceof ExecuteFailure) {
          const outcome = e.outcome ?? (committed ? 'committed' : 'not-applied')
          const code = outcome === 'not-applied' ? status.validationFailed : 500
          return finish({
            status: code,
            result: withId({ ok: false, status: code, outcome,
              errors: normalizeErrors([...e.errors], render, ctx.description.policy.limits) }),
          })
        }
        // упало ВНУТРИ обработчика: часть операций могла пройти, повтор опасен
        const outcome: Outcome = committed ? 'committed' : 'unknown'
        return finish({
          status: 500,
          result: withId({ ok: false, status: 500, outcome, errors: normalizeErrors([{
            id: stableId({ code: 'handler.failed' }), code: 'handler.failed',
            message: render('handler.failed'), origin: 'server', retryable: false,
          }], render, ctx.description.policy.limits) }),
        })
      }

      if (!committed)
        return finish({
          status: 500,
          result: withId({ ok: false, status: 500, outcome: 'unknown', errors: normalizeErrors([{
            id: stableId({ code: 'success-not-acknowledged' }), code: 'success-not-acknowledged',
            message: render('success-not-acknowledged'), origin: 'server',
          }], render, ctx.description.policy.limits) }),
        })

      for (const fn of afters) {
        // сбой последующего события НЕ отменяет фиксацию
        try { await fn() }
        catch {
          ctx.warnings.push({
            id: stableId({ code: 'after.failed' }), code: 'after.failed',
            message: render('after.failed'), origin: 'server',
          })
        }
      }

      const result = withId({
        ok: true, status: status.ok, outcome: 'committed',
        data: out.data, redirect: safeRedirect(out.redirect),
      })
      if (o.idempotency) await o.idempotency.put(submissionId, result, IDEMPOTENCY_TTL_MS)
      return finish({ status: status.ok, result })
    } catch (e) {
      const outcome: Outcome = ctx.reached === 'committed' ? 'committed'
        : ctx.reached === 'executing' ? 'unknown' : 'not-applied'
      return finish({
        status: 500,
        result: make({ ok: false, status: 500, outcome, errors: [{
          id: stableId({ code: 'handler.failed' }), code: 'handler.failed',
          message: render('handler.failed'), params: { detail: String(e) }, origin: 'server',
        }] }),
      })
    }
  }
}

/** Переход только относительный и только из проверенных значений. */
function safeRedirect(r: string | undefined): string | undefined {
  if (!r) return undefined
  return r.startsWith('/') && !r.startsWith('//') ? r : undefined
}
