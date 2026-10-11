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

/** Пределы приёма: защита тела запроса, а не настройка поведения. */
export interface Limits {
  /** Предел всего тела — по счётчику потока, а не по заголовку. */
  readonly maxBytes: number
  /** Предел числа различных ключей. */
  readonly maxKeys: number
  /** Предел на КАЖДЫЙ файл отдельно. */
  readonly maxFileSize: number
  /** Предел значений одного ключа. */
  readonly maxValuesPerKey: number
  /** Общий таймаут приёма. */
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
/**
 * Слой 01. Только объявленные методы. Отказ БЕЗ ЧТЕНИЯ ТЕЛА.
 * @param allowed Разрешённые HTTP-методы.
 */
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
 * Источник описания текущего запроса. Приватно и по ссылке на ctx: публичный
 * `Ctx` и порядок слоёв (`order`) не меняются, а слой имён и обработчик
 * разрешают источник РОВНО ОДИН раз — кто первый.
 */
const pendingSource = new WeakMap<Ctx, { source: DescriptionSource; instance: string; done: boolean }>()

/**
 * Поднять описание из источника по версии из конверта (однократно на запрос).
 * Набор полей НЕ приходит от клиента: описание поднимает сервер.
 */
async function resolveSource(ctx: Ctx): Promise<void> {
  const pending = pendingSource.get(ctx)
  if (!pending || pending.done) return
  pending.done = true
  const specRaw = ctx.form?.get(ctx.description.policy.envelopeKeys.spec)
  ctx.description = await pending.source.resolve({
    formId: ctx.description.id,
    instance: pending.instance,
    specVersion: typeof specRaw === 'string' ? Number(specRaw) : undefined,
  })
}

/**
 * Слой 04. Имена. Неизвестное поле, повтор одиночного и лишние значения —
 * ОТКАЗ, а не починка: «взять первое значение» скрывает ошибку клиента
 * или атаку и делает отладку невозможной.
 *
 * Имена сверяются с описанием, ПОДНЯТЫМ из `source` по `__form_spec`, а не с
 * базой из кода: иначе поле из рантайма отвергалось бы как неизвестное (F16).
 */
export const namesLayer: Layer = async (ctx) => {
  if (!ctx.form) return undefined
  await resolveSource(ctx)
  const { form, description: d } = ctx
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

/** Исход брони ключа идемпотентности. */
export type Reservation<R = Result> =
  | { status: 'reserved' }
  | { status: 'done'; result: R }
  | { status: 'busy' }

/**
 * Без этого семантика исхода неполна: «неизвестно» говорит «не повторяйте»,
 * но повтор всё равно возможен.
 *
 * `get`/`put` защищают от ПОСЛЕДОВАТЕЛЬНОГО повтора. От параллельного (двойной
 * клик, повтор прокси, пока первый запрос ещё выполняется) — только бронь:
 * `reserve` обязана АТОМАРНО занять ключ (в БД — `INSERT … ON CONFLICT DO NOTHING`
 * или `SET NX`), иначе два запроса оба увидят «пусто» и оба выполнятся.
 * Хранилище без `reserve` работает как раньше; тогда `release` не вызывается.
 */
export interface IdempotencyStore {
  get(key: SubmissionId): Promise<Result | undefined> | Result | undefined
  /** Записать окончательный результат; заменяет бронь. */
  put(key: SubmissionId, result: Result, ttlMs: number): Promise<void> | void
  /**
   * Атомарно занять ключ на время выполнения.
   * `done` — результат уже есть; `busy` — ключ занят другим запросом.
   * @param ttlMs Срок брони: после него ключ считается свободным (процесс мог умереть).
   */
  reserve?(key: SubmissionId, ttlMs: number): Promise<Reservation> | Reservation
  /** Снять бронь без результата. Обязательна вместе с `reserve`. */
  release?(key: SubmissionId): Promise<void> | void
}

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000
/** Срок брони: дольше выполняться отправке незачем, а умерший процесс не держит ключ вечно. */
export const IDEMPOTENCY_RESERVE_MS = 5 * 60 * 1000

type MemoryEntry = { result: Result; exp: number } | { result?: undefined; exp: number }

/**
 * Хранилище в памяти процесса: для одного процесса и разработки. Бронь
 * атомарна (однопоточный JS: проверка и запись без `await` между ними).
 * Просроченные записи вычищаются обходом не чаще раза в минуту — карта не
 * растёт сверх отправок за `ttlMs`.
 */
export class MemoryIdempotencyStore implements IdempotencyStore {
  #map = new Map<string, MemoryEntry>()
  #sweptAt: number
  constructor(private readonly now: () => number = Date.now) { this.#sweptAt = now() }

  #live(key: SubmissionId, t: number): MemoryEntry | undefined {
    const hit = this.#map.get(key)
    if (hit && hit.exp <= t) { this.#map.delete(key); return undefined }
    return hit
  }

  #sweep(t: number) {
    if (t - this.#sweptAt < 60_000) return
    this.#sweptAt = t
    for (const [k, v] of this.#map) if (v.exp <= t) this.#map.delete(k)
  }

  get(key: SubmissionId) {
    return this.#live(key, this.now())?.result
  }
  put(key: SubmissionId, result: Result, ttlMs: number) {
    const t = this.now()
    this.#sweep(t)
    this.#map.set(key, { result, exp: t + ttlMs })
  }
  reserve(key: SubmissionId, ttlMs: number): Reservation {
    const t = this.now()
    this.#sweep(t)
    const hit = this.#live(key, t)
    if (hit?.result) return { status: 'done', result: hit.result }
    if (hit) return { status: 'busy' }
    this.#map.set(key, { exp: t + ttlMs })
    return { status: 'reserved' }
  }
  release(key: SubmissionId) {
    if (!this.#map.get(key)?.result) this.#map.delete(key)
  }
  get size() { return this.#map.size }
}

export interface ThrottleVerdict { allowed: boolean; retryAfterMs?: number }
export interface Throttle {
  check(ctx: { request: Request }): Promise<ThrottleVerdict> | ThrottleVerdict
}

/**
 * Ограничение частоты скользящим окном в памяти процесса. Отказ по частоте идёт
 * ДО чтения тела: иначе отказ расходует предел.
 *
 * Ключ обязателен: умолчания «по адресу клиента» у библиотеки нет и быть не может.
 * Сырой `x-forwarded-for` задаёт сам клиент — подставив случайный, он получает
 * новое окно на каждый запрос. Доверенный адрес знает только развёртывание:
 * заголовок, который ПЕРЕЗАПИСЫВАЕТ ваш прокси, идентификатор сессии или
 * пользователя. Для SvelteKit это то же, что `event.getClientAddress()` с
 * настройками адаптера (`ADDRESS_HEADER`, `XFF_DEPTH` у adapter-node).
 *
 * Память: окна без попаданий удаляются; полный обход ключей — не чаще раза за
 * `windowMs`, так что в карте живут только ключи, активные за последнее окно.
 * @param o Лимит, окно и функция ключа.
 * @param now Часы — для тестов.
 * @returns Ограничитель; `size` — число живых окон (для наблюдения и тестов).
 */
export function windowThrottle(
  o: { limit: number; windowMs: number; key: (r: Request) => string },
  now: () => number = Date.now,
): Throttle & { readonly size: number } {
  if (typeof o.key !== 'function')
    throw new TypeError('[form] windowThrottle: key обязателен — сырой x-forwarded-for подделывается клиентом')
  const hits = new Map<string, number[]>()
  let sweptAt = now()
  const live = (list: readonly number[], t: number) => list.filter((x) => t - x < o.windowMs)
  const sweep = (t: number) => {
    sweptAt = t
    for (const [key, list] of hits) {
      const rest = live(list, t)
      if (rest.length) hits.set(key, rest)
      else hits.delete(key)
    }
  }
  return {
    check({ request }) {
      const key = o.key(request)
      const t = now()
      if (t - sweptAt >= o.windowMs) sweep(t)
      const list = live(hits.get(key) ?? [], t)
      if (list.length >= o.limit) {
        hits.set(key, list)
        return { allowed: false, retryAfterMs: o.windowMs - (t - list[0]!) }
      }
      list.push(t)
      hits.set(key, list)
      return { allowed: true }
    },
    get size() { return hits.size },
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

/** Настройка приёма запроса формой. */
export interface HandlerOptions<T = unknown> {
  /** Описание формы: изоморфный модуль, импортированный и сервером. */
  description: FormDescription
  /** Источник описания для полей из рантайма. */
  source?: DescriptionSource
  /** Экземпляр формы, если адресован. */
  instance?: string
  /** Слой Origin: список разрешённых, `strict` запрещает запрос без заголовков. */
  origin?: OriginOptions
  /** Правки пределов приёма поверх умолчаний. */
  limits?: Partial<Limits>
  /** Тексты поверх словаря формы. */
  messages?: MessageDictionary
  /** Асинхронные проверки: на сервере выполняются ВСЕГДА. */
  checks?: CheckRegistry
  /** Внешняя схема: ещё один источник ошибок. */
  schema?: StandardSchemaLike
  /** Хранилище идемпотентности: повтор не выполняется заново. */
  idempotency?: IdempotencyStore
  /** Ограничение частоты: отказ ДО чтения тела. */
  throttle?: Throttle
  /** Обработчик ошибок проекта. Проходят оба пути. */
  onErrors?: ErrorHandler
  /** Телеметрия: одна запись на запрос; при сбое вне execute — с полем `failure`. */
  observe?: (e: Record<string, unknown>) => void
  /** Своий порядок слоёв. Обязательные выбрасывать нельзя. */
  order?: readonly Layer[]
  /** Бизнес-действие: обязано позвать `commit()` или `fail()`. */
  execute(ctx: ExecuteContext): Promise<{ data?: T; redirect?: string }> | { data?: T; redirect?: string }
}

export interface Handled<T = unknown> { result: Result<T>; status: number }

/** Приём запроса. Возвращает РЕЗУЛЬТАТ, кодировку выбирает маршрут. */
/**
 * Собрать приёмник запроса из переставляемых слоёв.
 * @param o Описание, слои, проверки и бизнес-действие.
 * @returns Функция `Request → { result, status }`: кодировку выбирает маршрут.
 */
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
  if (!layers.includes(bodyLayer) || !layers.includes(namesLayer))
    throw new Error('[form] order обязан содержать bodyLayer и namesLayer')
  if (o.idempotency && !o.idempotency.reserve !== !o.idempotency.release)
    throw new Error('[form] IdempotencyStore: reserve и release реализуются только вместе')

  return async function handle(request: Request, from: 'action' | 'fetch' = 'action'):
    Promise<Handled<T>> {
    const started = Date.now()
    const ctx: Ctx = { request, description: base, limits, reached: 'rejected', warnings: [] }
    if (o.source) pendingSource.set(ctx, { source: o.source, instance: o.instance ?? `${base.id}:new`, done: false })
    /** Сбой вне execute: текст — только в телеметрию и лог сервера, не клиенту. */
    let failure: unknown
    let currentIntent = 'submit'
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
        from, intent: currentIntent, outcome: handled.result.outcome,
      }
      const shown = applyHandler(handled.result.errors, ectx, o.onErrors)
      o.observe?.({
        submissionId: handled.result.submissionId, outcome: handled.result.outcome,
        ms: Date.now() - started, errors: handled.result.errors.length,
        removed: shown.removed, reached: ctx.reached,
        ...(failure !== undefined ? { failure: String(failure) } : {}),
      })
      return { ...handled, result: {
        ...handled.result,
        errors: shown.errors,
        warnings: ctx.warnings.length ? [...ctx.warnings] : handled.result.warnings,
      } }
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

      // обычно уже поднято слоем имён; здесь — если order поставил его до тела
      await resolveSource(ctx)

      const ev = evaluate(ctx.form!, ctx.description, { render, instance: o.instance })
      if (ev.fatal) return finish(fail(reject(400, ev.fatal.code, ev.fatal.params)))

      currentIntent = ev.intent
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

      // повтор той же отправки не выполняется заново; параллельный — тоже (бронь)
      let reserved = false
      if (o.idempotency) {
        const store = o.idempotency
        const r: Reservation = store.reserve
          ? await store.reserve(submissionId, IDEMPOTENCY_RESERVE_MS)
          : await (async () => {
            const prev = await store.get(submissionId)
            return prev ? { status: 'done' as const, result: prev } : { status: 'reserved' as const }
          })()
        if (r.status === 'done') {
          ctx.reached = 'committed'
          return finish({ status: r.result.status, result: r.result as Result<T> })
        }
        if (r.status === 'busy')
          // «не применено» и тот же submissionId: адаптер не создаёт новый id, и
          // следующая попытка получит результат первой отправки из хранилища.
          return finish({
            status: 409,
            result: withId({ ok: false, status: 409, outcome: 'not-applied', errors: normalizeErrors([{
              id: stableId({ code: 'submission.in-flight' }), code: 'submission.in-flight',
              message: render('submission.in-flight'), origin: 'server', retryable: true,
            }], render, ctx.description.policy.limits) }),
          })
        reserved = !!store.reserve
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
          // Бронь снимается ТОЛЬКО при достоверном «не применено»: исправленная
          // отправка с тем же id должна пройти. При «неизвестно»/«зафиксировано»
          // без записи бронь держится до срока — повтор получит отказ, а не второе выполнение.
          if (reserved && outcome === 'not-applied') await o.idempotency!.release!(submissionId)
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
      // Текст исключения (адреса, логины БД, пути) клиенту не отдаётся.
      failure = e
      console.error('[form] сбой приёма запроса', e)
      const outcome: Outcome = ctx.reached === 'committed' ? 'committed'
        : ctx.reached === 'executing' ? 'unknown' : 'not-applied'
      return finish({
        status: 500,
        result: make({ ok: false, status: 500, outcome, errors: [{
          id: stableId({ code: 'handler.failed' }), code: 'handler.failed',
          message: render('handler.failed'), origin: 'server',
        }] }),
      })
    }
  }
}

const REDIRECT_BASE = 'http://redirect.invalid'

/**
 * Переход только на свой сайт. Строковой проверки «начинается с `/`, но не с
 * `//`» мало: браузер читает `\` как `/` и вырезает табы и переводы строк, так
 * что `/\evil.com` и `/<TAB>/evil.com` уводят на чужой хост. Поэтому адрес
 * разбирается тем же алгоритмом URL, что у браузера, и отдаётся нормализованным.
 */
function safeRedirect(r: string | undefined): string | undefined {
  if (!r || !r.startsWith('/')) return undefined
  let url: URL
  try { url = new URL(r, REDIRECT_BASE) } catch { return undefined }
  if (url.origin !== REDIRECT_BASE) return undefined
  return url.pathname + url.search + url.hash
}
