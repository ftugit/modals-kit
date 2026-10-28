// Приём запроса: переставляемые слои с готовым набором по умолчанию.
//
// Модуль предназначен только для серверного кода. Порядок слоёв менять можно,
// выбрасывать обязательные — нет.
import { runAsyncChecks, type CheckRegistry } from './async'
import { applyHandler, type ErrorContext, type ErrorHandler } from './errors'
import type { FormDescription } from './describe'
import type { MessageDictionary } from './messages'
import { formRenderer } from './messages-order'
import { normalizeErrors, stableId, type FormError, type Outcome, type Result } from './result'
import { assertQueuedProtocol, type QueuedData } from './queued'
import { issueError, runSchema, type IssueLike, type StandardSchemaLike } from './schema'
import type { DescriptionSource } from './source'
import { evaluate } from './submit'
import { fieldSetOp } from './field-set'
import { stampProof } from './proof'
import { visibleFields } from './validate'
import { nameProblem } from './policy'
import type { SubmissionId } from './types'

/** Пределы приёма: защита тела запроса, а не настройка поведения. */
export interface Limits {
  /** Предел всего тела — по счётчику потока, а не по заголовку. */
  readonly maxBytes: number
  /** Предел числа различных ключей. */
  readonly maxKeys: number
  /** Предел значений одного ключа. */
  readonly maxValuesPerKey: number
  /**
   * Крайний срок всего приёма, мс: от первого байта тела до готового `Result`.
   * Полуживой сервер обязан отказать сам (`408 request.timeout`), а не ждать
   * таймаута платформы, держа воркер и память. Работа не прерывается — её
   * результат уже никому не нужен, поэтому исход «неизвестно», если обработчик
   * успел начать действие.
   */
  readonly timeoutMs: number
}

/** Пределы приёма по умолчанию: байты тела, число ключей и значений, таймаут. */
export const DEFAULT_LIMITS: Limits = {
  maxBytes: 2 * 1024 * 1024, maxKeys: 256,
  maxValuesPerKey: 64, timeoutMs: 15_000,
}

/** Различение «дошёл / не дошёл» — основа семантики исхода. */
export type Reached = 'rejected' | 'validating' | 'executing' | 'committed'

/** Отказ слоя приёма: статус, код и параметры для текста. */
export interface Rejection { status: number; code: string; params?: Record<string, unknown> }
/** Отказ слоя приёма одной строкой: `reject(413, "too-large")`. */
export const reject = (status: number, code: string, params?: Record<string, unknown>): Rejection =>
  ({ status, code, params })

/** Контекст слоя приёма: запрос, описание, значения и уже накопленные отказы. */
export interface Ctx {
  readonly request: Request
  description: FormDescription
  limits: Limits
  reached: Reached
  form?: FormData
  warnings: FormError[]
}

/** Слой приёма: проверка, которая может отказать до обработчика. */
export type Layer = (ctx: Ctx) => Promise<Rejection | undefined> | Rejection | undefined

/* ── слои ──────────────────────────────────────────────────────────── */

/** Слой 01. Только объявленные методы. Отказ БЕЗ ЧТЕНИЯ ТЕЛА. */
/**
 * Слой 01. Только объявленные методы. Отказ БЕЗ ЧТЕНИЯ ТЕЛА.
 * @param allowed Разрешённые HTTP-методы.
 */
export const methodLayer = (allowed: readonly string[] = ['POST']): Layer => (ctx) =>
  allowed.includes(ctx.request.method) ? undefined : reject(405, 'method.not-allowed')

/** Настройка проверки origin: разрешённые источники и режим сравнения. */
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
    if (form.getAll(key).length > ctx.limits.maxValuesPerKey)
      return reject(413, 'request.too-many', { name: key })
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
  // вложенный тип держит значение в `имя.…`: такие ключи — его, форму записей проверит decode
  const nested = d.fields.filter((f) => d.registry.types.get(f.kind).nested).map((f) => `${f.name}.`)

  for (const key of new Set(form.keys())) {
    if (envelope.has(key)) continue
    if (nested.some((head) => key.startsWith(head))) {
      if (nameProblem(key, d.policy.names)) return reject(400, 'request.unexpected-field', { name: key })
      continue
    }
    const field = d.byName[key]
    if (!field) return reject(400, 'request.unexpected-field', { name: key })
    if (nameProblem(key, d.policy.names)) return reject(400, 'request.unexpected-field', { name: key })
    const multiple = d.registry.types.get(field.kind).multiple || Boolean(field.multiple)
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

/** Срок жизни брони отправки: сутки — в пределах срока результата. */
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

/**
 * Минимум, который нужен брони от внешнего хранилища: атомарное «записать, если
 * пусто» и обычные чтение, запись, удаление. По форме совпадает с `AtomicStore`
 * из `#lib/cache` (подходит его `memoryStore` и любое сетевое хранилище с тем же
 * контрактом), но lib/form от него не зависит: годится любой объект с этими
 * методами.
 */
export interface IdempotencyKv {
  get<T>(key: string): Promise<T | undefined> | T | undefined
  set<T>(key: string, value: T, ttlMs: number): Promise<void> | void
  /** Атомарно: записать, только если ключа нет. `true` — записали. */
  add<T>(key: string, value: T, ttlMs: number): Promise<boolean> | boolean
  delete(key: string): Promise<void> | void
}

type KvRecord = { result: Result } | { result?: undefined; pending: true }

/**
 * `IdempotencyStore` поверх внешнего хранилища. Бронь — атомарный `add`, поэтому
 * параллельный дубль получает `busy`, даже если хранилище общее для нескольких
 * инстансов (тогда и защита общая).
 *
 * Хранилище с потолком (память процесса) может вытеснить запись раньше срока —
 * тогда повтор, пришедший после вытеснения, выполнится заново. Потолок выбирают с
 * запасом на число отправок за `IDEMPOTENCY_TTL_MS`.
 * @param store Хранилище с атомарным `add`; проверяется при подключении.
 * @returns Хранилище брони с `reserve`/`release`.
 */
export function storeIdempotency(store: IdempotencyKv): IdempotencyStore {
  if (typeof store?.add !== 'function')
    throw new TypeError('[form] storeIdempotency: нужно хранилище с атомарным add — без него параллельный дубль выполнится дважды')
  const read = async (key: SubmissionId) => (await store.get<KvRecord>(key)) ?? undefined
  return {
    async get(key) {
      return (await read(key))?.result
    },
    async put(key, result, ttlMs) {
      await store.set<KvRecord>(key, { result }, ttlMs)
    },
    async reserve(key, ttlMs) {
      if (await store.add<KvRecord>(key, { pending: true }, ttlMs)) return { status: 'reserved' }
      const hit = await read(key)
      // Ключ мог истечь между add и get: «занято» безопаснее, повтор придёт снова.
      return hit?.result ? { status: 'done', result: hit.result } : { status: 'busy' }
    },
    async release(key) {
      // Снимает только бронь без результата. Результат пишет тот же запрос, что
      // держит бронь, поэтому между чтением и удалением его никто не подменит.
      const hit = await read(key)
      if (hit && !hit.result) await store.delete(key)
    },
  }
}

/** Вердикт ограничителя: пропустить или подождать указанное время. */
export interface ThrottleVerdict { allowed: boolean; retryAfterMs?: number }
/**
 * Ограничитель частоты. `event` — контекст запроса фреймворка, который маршрут
 * передал третьим аргументом приёмника (`handle(request, from, event)`):
 * библиотека его не читает, только доносит до ключа. Для SvelteKit это
 * `RequestEvent` с `getClientAddress()`.
 */
export interface Throttle<E = unknown> {
  check(ctx: { request: Request; event?: E }): Promise<ThrottleVerdict> | ThrottleVerdict
}

/**
 * Хранилище окон частоты: «ключ → метки попаданий» со сроком. Подходит любое
 * хранилище с таким контрактом, например область `localStore` из `lib/cache`
 * (`localStore.scope('signup:throttle', { max: 10_000 })`): истёкшие окна
 * убирает срок, лишние ключи — потолок области. Библиотека его не импортирует —
 * контракт структурный, как у `storeIdempotency`.
 *
 * Чтение и запись — две операции. С синхронным хранилищем (память процесса)
 * между ними никто не вклинится, и окно точное. С сетевым два одновременных
 * запроса могут прочесть одно окно и оба пройти — лимит тогда «примерно»;
 * для общего лимита на несколько инстансов нужен атомарный счётчик.
 */
export interface ThrottleKv {
  get<T>(key: string): Promise<T | undefined> | T | undefined
  set<T>(key: string, value: T, ttlMs: number): Promise<void> | void
}

/** Значение или обещание — продолжить синхронно, если значение уже есть. */
const thenMaybe = <T, R>(value: Promise<T> | T, next: (v: T) => R | Promise<R>): R | Promise<R> =>
  value instanceof Promise ? value.then(next) : next(value)

/**
 * Окна по умолчанию — карта в памяти процесса: библиотека работает и без
 * внешнего хранилища. Окна без попаданий удаляются; полный обход ключей — не
 * чаще раза за `windowMs`, так что в карте живут только ключи, активные за
 * последнее окно.
 */
function mapWindows(windowMs: number, now: () => number): ThrottleKv & { readonly size: number } {
  const hits = new Map<string, readonly number[]>()
  let sweptAt = now()
  return {
    get<T>(key: string) {
      const t = now()
      if (t - sweptAt >= windowMs) {
        sweptAt = t
        for (const [k, list] of hits) if (!list.some((x) => t - x < windowMs)) hits.delete(k)
      }
      return hits.get(key) as T | undefined
    },
    set<T>(key: string, value: T) {
      hits.set(key, value as readonly number[])
    },
    get size() { return hits.size },
  }
}

/**
 * Ограничение частоты скользящим окном: в окне `windowMs` до `limit` попаданий
 * на ключ, считая от каждого запроса назад (на стыке окон всплеска «2×» нет).
 * Отказ по частоте идёт ДО чтения тела: иначе отказ расходует предел.
 *
 * Ключ обязателен: умолчания «по адресу клиента» у библиотеки нет и быть не может.
 * Сырой `x-forwarded-for` задаёт сам клиент — подставив случайный, он получает
 * новое окно на каждый запрос. Доверенный адрес знает только развёртывание:
 * заголовок, который ПЕРЕЗАПИСЫВАЕТ ваш прокси, идентификатор сессии или
 * пользователя. Для SvelteKit это `event.getClientAddress()` с настройками
 * адаптера (`ADDRESS_HEADER`, `XFF_DEPTH` у adapter-node): маршрут передаёт
 * `event` в приёмник, и он приходит вторым аргументом ключа —
 * `key: (_request, event) => event!.getClientAddress()`. Без `event` (вызов
 * приёмника без третьего аргумента) ключ получает `undefined`.
 *
 * Память: без `store` окна живут в карте процесса (см. `mapWindows`). Со `store`
 * окна живут в нём со сроком `windowMs` от последнего попадания — их убирают
 * срок и потолок хранилища (у карты потолка нет; у области `localStore` есть).
 * Значения записываются новыми массивами: записанное в хранилище не меняется.
 * @param o Лимит, окно, функция ключа `(request, event) => string` и хранилище окон.
 * @param now Часы меток — для тестов (срок записей считает часы хранилища).
 * @returns Ограничитель; `size` — число живых окон встроенной карты (для
 *   наблюдения и тестов), со своим `store` — `undefined`.
 */
export function windowThrottle<E = unknown>(
  o: {
    limit: number
    windowMs: number
    key: (r: Request, event: E | undefined) => string
    /** Где хранить окна; по умолчанию — карта в памяти процесса. */
    store?: ThrottleKv
  },
  now: () => number = Date.now,
): Throttle<E> & { readonly size: number | undefined } {
  if (typeof o.key !== 'function')
    throw new TypeError('[form] windowThrottle: key обязателен — сырой x-forwarded-for подделывается клиентом')
  const own = o.store ? null : mapWindows(o.windowMs, now)
  const store: ThrottleKv = o.store ?? own!
  return {
    check({ request, event }) {
      const key = o.key(request, event)
      const t = now()
      return thenMaybe(store.get<readonly number[]>(key), (stored): ThrottleVerdict | Promise<ThrottleVerdict> => {
        const list = (Array.isArray(stored) ? stored : []).filter((x) => t - x < o.windowMs)
        if (list.length >= o.limit) {
          const retryAfterMs = o.windowMs - (t - list[0]!)
          // Отказ не попадание: окно не удлиняется. Срок записи — до выхода
          // МЛАДШЕЙ метки (раньше нельзя: потерялись бы метки, ещё живые в окне).
          const keepMs = o.windowMs - (t - list[list.length - 1]!)
          return thenMaybe(store.set(key, list, keepMs), () => ({ allowed: false, retryAfterMs }))
        }
        return thenMaybe(store.set(key, [...list, t], o.windowMs), () => ({ allowed: true }))
      })
    },
    get size() { return own?.size },
  }
}

/* ── метка проверки ────────────────────────────────────────────────── */

/**
 * Какие поля можно пометить «проверено» для получателя (`lib/db`, `proof.ts`): действие
 * проверяло форму целиком (`validate: 'full'`, без `relax` и `subset`), поле видимо и не
 * «свежее», правила поля сгенерированы из чужой схемы (`rulesFrom`) и все остались в
 * `validate`. Ответ — имя → схема; значение берёт `pick` в момент вызова.
 */
function provenSchemas(d: FormDescription, values: Record<string, unknown>, intent: string): Map<string, object> {
  const out = new Map<string, object>()
  const { action } = d.policy.intent.parse(intent)
  const descriptor = d.actions.find((a) => a.id === action) ?? d.actions[0]!
  if (descriptor.validate !== 'full' || descriptor.relax?.length || descriptor.subset) return out
  const visible = visibleFields(d, values)
  for (const f of d.fields) {
    const from = f.rulesFrom
    if (!from || !visible.has(f.name)) continue
    if (from.rules.every((r) => f.validators.includes(r))) out.set(f.name, from.schema)
  }
  return out
}

/** `{ value, note }` из `prepare`: новое значение и подсказка к полю. */
const isNoted = (x: unknown): x is { value: unknown; note: string } =>
  !!x && typeof x === 'object' && Object.getPrototypeOf(x) === Object.prototype &&
  Object.keys(x).length === 2 && 'value' in x && typeof (x as { note?: unknown }).note === 'string'

/* ── обработчик ────────────────────────────────────────────────────── */

export interface ExecuteContext<V = Record<string, unknown>> {
  readonly values: V
  /**
   * Копия только перечисленных полей — то, что уходит получателю (`lib/db`). На ней
   * метка «проверено» для полей с правилами из чужой схемы (`rulesFrom`): получатель
   * не повторит эти правила. `values` метки не несут. Поле не из формы — ошибка.
   */
  pick<K extends keyof V & string>(keys: readonly K[]): Pick<V, K>
  readonly intent: string
  readonly request: Request
  /** Явное подтверждение успеха. «Не упало — значит хорошо» даёт «неизвестно». */
  commit(): void
  /** После фиксации: сбой уходит в предупреждения, а не отменяет результат. */
  after(fn: () => Promise<void> | void): void
  /** Ошибки ПОЛЕЙ, а не общий сбой. */
  /**
   * Отказ с ошибками. Кроме `FormError` принимает issues Standard Schema (в том
   * числе с `code`/`params`/`template`, как отдаёт `failureIssues` из `lib/db`):
   * они становятся ошибками полей по `path` с текстами из словарей формы.
   */
  fail(errors: readonly (FormError | IssueLike)[], outcome?: Outcome): never
}

/** Отказ обработчика формы в языке библиотеки: результат и статус ответа. */
export class ExecuteFailure extends Error {
  constructor(readonly errors: readonly FormError[], readonly outcome?: Outcome) {
    super('[form] обработчик вернул ошибки полей')
    this.name = 'ExecuteFailure'
  }
}

/** Настройка приёма запроса формой. */
export interface HandlerOptions<T = unknown, E = unknown> {
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
  /** Тексты приложения: слабее словаря формы, сильнее пакета (F55). */
  messages?: MessageDictionary
  /** Асинхронные проверки: на сервере выполняются ВСЕГДА. */
  checks?: CheckRegistry
  /** Внешняя схема: ещё один источник ошибок. */
  schema?: StandardSchemaLike
  /**
   * Подготовка значения ДО правил формы, только на сервере (списки слов не уходят в
   * браузер): `(value, values) => новое` или `{ value, note }` — `note` уходит в
   * `Result.notes` подсказкой к полю. Правила проверяют уже подготовленное значение,
   * а при ошибке в поле возвращается оно же: человек видит то, что будет сохранено.
   * Синхронно: внешняя модерация — в `checks`/`execute`.
   */
  prepare?: Readonly<Record<string, (value: unknown, values: Readonly<Record<string, unknown>>) => unknown>>
  /** Хранилище идемпотентности: повтор не выполняется заново. */
  idempotency?: IdempotencyStore
  /** Ограничение частоты: отказ ДО чтения тела. */
  throttle?: Throttle<E>
  /** Обработчик ошибок проекта. Проходят оба пути. */
  onErrors?: ErrorHandler
  /** Телеметрия: одна запись на запрос; при сбое вне execute — с полем `failure`. */
  observe?: (e: Record<string, unknown>) => void
  /** Свой порядок слоёв. Обязательные выбрасывать нельзя. */
  order?: readonly Layer[]
  /**
   * Бизнес-действие: обязано позвать `commit()` или `fail()`. Принятая в очередь
   * заявка — тоже `commit()` (заявка записана) плюс `queued`: исход `queued`, адреса
   * опроса уходят в `Result.data` (`queuedData`).
   */
  execute(ctx: ExecuteContext): Promise<ExecuteOutput<T>> | ExecuteOutput<T>
}

/** Ответ бизнес-действия: данные, переход или заявка в очереди. */
export interface ExecuteOutput<T = unknown> {
  data?: T
  redirect?: string
  /** Результат будет позже: опрос `pollUrl`, без скрипта — ссылка `statusUrl`. */
  queued?: QueuedData
}

/** Итог обработки запроса: результат формы и HTTP-статус ответа. */
export interface Handled<T = unknown> { result: Result<T>; status: number }

/** Приём запроса. Возвращает РЕЗУЛЬТАТ, кодировку выбирает маршрут. */
/**
 * Собрать приёмник запроса из переставляемых слоёв.
 * @param o Описание, слои, проверки и бизнес-действие.
 * @returns Функция `(request, from?, event?) → { result, status }`: кодировку
 *   выбирает маршрут. `event` — контекст запроса фреймворка (для SvelteKit —
 *   `RequestEvent`); библиотека передаёт его ограничителю частоты, не читая.
 */
export function createFormHandler<T, E = unknown>(o: HandlerOptions<T, E>) {
  const base = o.description
  const render = formRenderer(base.messages as never, o.messages, base.policy.interpolate)
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
  for (const [name, fn] of Object.entries(o.prepare ?? {}))
    if (!base.byName[name] || typeof fn !== 'function')
      throw new Error(`[form] prepare.${name}: ${base.byName[name] ? 'обязан быть функцией' : 'нет такого поля в форме'}`)
  const prepare = o.prepare && Object.keys(o.prepare).length
    ? (values: Record<string, unknown>) => {
      const notes: Record<string, string> = {}
      for (const [name, fn] of Object.entries(o.prepare!)) {
        if (!(name in values)) continue
        const out = fn(values[name], Object.freeze({ ...values }))
        if (isNoted(out)) { values[name] = out.value; notes[name] = out.note }
        else values[name] = out
      }
      return notes
    }
    : undefined

  return async function handle(request: Request, from: 'action' | 'fetch' = 'action', event?: E):
    Promise<Handled<T>> {
    const started = Date.now()
    const ctx: Ctx = { request, description: base, limits, reached: 'rejected', warnings: [] }
    if (o.source) pendingSource.set(ctx, { source: o.source, instance: o.instance ?? `${base.id}:new`, done: false })
    /** Сбой вне execute: текст — только в телеметрию и лог сервера, не клиенту. */
    let failure: unknown
    let currentIntent = 'submit'
    /** Интент по факту разбора конверта — штамп `Result.intent`; до `evaluate` его нет. */
    let knownIntent: string | undefined
    const status = base.policy.status

    const make = (
      part: Partial<Result<T>> & { ok: boolean; status: number; outcome: Outcome },
    ): Result<T> => ({
      v: 1, formId: ctx.description.id, instance: o.instance ?? `${ctx.description.id}:new`,
      submissionId: '00000000-0000-4000-8000-000000000000',
      ...(knownIntent !== undefined ? { intent: knownIntent } : {}),
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

    // Приём целиком — одна работа с крайним сроком: висящее чтение тела,
    // молчащий обработчик и зависшее хранилище обрываются одинаково.
    const pipeline = async (): Promise<Handled<T>> => {
      try {
        if (o.throttle) {
          const verdict = await o.throttle.check({ request, event })
          if (!verdict.allowed)
            return finish(fail(reject(429, 'rate.limited', { retryAfterMs: verdict.retryAfterMs })))
        }

        for (const layer of layers) {
          const r = await layer(ctx)
          if (r) return finish(fail(r))
        }

        // обычно уже поднято слоем имён; здесь — если order поставил его до тела
        await resolveSource(ctx)

        // бюджет тела — тот же, по которому режет `bodyLayer`: объявленный формой
        // меньше потолка окружения, иначе действует потолок (в `limits.maxBytes`)
        const ev = evaluate(ctx.form!, ctx.description, {
          render, instance: o.instance, prepare, budget: ctx.limits.maxBytes,
        })
        if (ev.fatal) return finish(fail(reject(400, ev.fatal.code, ev.fatal.params)))

        currentIntent = ev.intent
        knownIntent = ev.intent
        const submissionId = ev.envelope!.submissionId
        const withId = (part: Partial<Result<T>> & { ok: boolean; status: number; outcome: Outcome }) =>
          make({ ...part, submissionId, instance: ev.envelope!.instance, values: ev.publicValues,
                 ...(ev.notes ? { notes: ev.notes } : {}) })

        // кнопка набора полей без JS: места возвращаются с новым или без удалённого, ничего не выполняется
        const op = fieldSetOp(ctx.form!, ctx.description, ev.intent)
        if (op)
          return finish({ status: status.ok, result: make({
            ok: true, status: status.ok, outcome: 'not-applied', submissionId, instance: ev.envelope!.instance,
            values: { ...ev.publicValues, [op.name]: op.items },
          }) })

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
        const proven = provenSchemas(ctx.description, ev.values, ev.intent)
        const pick = (keys: readonly string[]) => {
          const out: Record<string, unknown> = {}
          const fields: Record<string, { schema: object; value: unknown }> = {}
          for (const k of keys) {
            if (!ctx.description.byName[k]) throw new Error(`[form] pick: нет поля '${k}' в форме`)
            if (!(k in ev.values)) continue
            out[k] = ev.values[k]
            const schema = proven.get(k)
            if (schema) fields[k] = { schema, value: ev.values[k] }
          }
          return stampProof(out, fields)
        }
        let committed = false
        const afters: Array<() => Promise<void> | void> = []
        let out: ExecuteOutput<T>

        try {
          out = await o.execute({
            values: ev.values, intent: ev.intent, request,
            pick: pick as ExecuteContext['pick'],
            commit: () => { committed = true; ctx.reached = 'committed' },
            after: (fn) => { afters.push(fn) },
            fail: (list, outcome) => {
              throw new ExecuteFailure(
                list.map((x) => ('origin' in x && typeof x.origin === 'string' ? x as FormError : issueError(x as IssueLike, 'server'))),
                outcome)
            },
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

        // Очередь: принято, итог позже. Без адресов опроса исход — тупик (ошибка разработки).
        const result = out.queued
          ? withId({ ok: true, status: status.queued, outcome: 'queued', data: out.queued as T })
          : withId({
            ok: true, status: status.ok, outcome: 'committed',
            data: out.data, redirect: safeRedirect(out.redirect),
          })
        assertQueuedProtocol(result)
        if (o.idempotency) await o.idempotency.put(submissionId, result, IDEMPOTENCY_TTL_MS)
        return finish({ status: result.status, result })
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

    return withDeadline(limits.timeoutMs, pipeline, () => {
      // Тело больше не нужно: отпускаем поток, чтобы он не держал память.
      void request.body?.cancel().catch(() => undefined)
      failure = new Error('[form] приём не уложился в timeoutMs')
      const outcome: Outcome = ctx.reached === 'committed' ? 'committed'
        : ctx.reached === 'executing' ? 'unknown' : 'not-applied'
      return finish({
        status: 408,
        result: make({ ok: false, status: 408, outcome, errors: [{
          id: stableId({ code: 'request.timeout' }), code: 'request.timeout',
          message: render('request.timeout'), origin: 'server',
          retryable: outcome === 'not-applied',
        }] }),
      })
    })
  }
}

/**
 * Крайний срок работы: `onTimeout` собирает ответ, а работа продолжается в фоне
 * (прервать чужой `execute` нельзя) — её результат уже никому не нужен.
 * Тело запроса при этом отменяется вызывающим: поток не должен держать память.
 */
function withDeadline<T>(
  ms: number,
  work: () => Promise<T>,
  onTimeout: () => T,
): Promise<T> {
  if (!(ms > 0)) return work()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout()), ms)
  })
  const running = work()
  // Отказ работы после срока не должен всплыть необработанным исключением.
  running.catch(() => undefined)
  return Promise.race([running, deadline]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
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
