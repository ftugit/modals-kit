import { FetchError } from './errors.js'

/** Повторы: сколько попыток, какие паузы, на какие ответы. */
export interface RetryPolicy {
  /** Всего попыток вместе с первой. По умолчанию 3. `1` — без повторов. */
  attempts?: number
  /** Основа экспоненты паузы: `base · 2^(n-1)`, со случайным разбросом (full jitter). По умолчанию 300. */
  baseDelayMs?: number
  /**
   * Потолок одной паузы, мс. По умолчанию 5000. Если сервис через `Retry-After`
   * просит ждать дольше, повтора нет: вызывающий получает ответ как есть.
   */
  maxDelayMs?: number
  /** На какие коды ответа повторять. По умолчанию 408, 425, 429, 500, 502, 503, 504. */
  statuses?: readonly number[]
}

/** Правила для одного хоста. */
export interface HostPolicy {
  /** Не больше стольких запусков за любую секунду (скользящее окно). */
  rps?: number
  /** Не больше стольких запусков за любую минуту (скользящее окно). */
  rpm?: number
  /** Заголовки по умолчанию (например, `User-Agent`); заголовки вызова важнее. */
  headers?: Record<string, string>
}

/** Часы и случайность — заменяются в тестах. */
export interface FetchClock {
  now(): number
  /** Пауза; прерывание `signal` отклоняет её с `signal.reason`. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>
  /** Число в [0, 1) для разброса пауз. */
  random(): number
}

export interface CreateFetchOptions {
  /** Нижний `fetch`. По умолчанию `globalThis.fetch` на момент вызова. */
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
  /** Таймаут одной попытки, мс (вместе с чтением тела). По умолчанию 10 000. */
  timeoutMs?: number
  /** Повторы; `false` — выключены. */
  retry?: RetryPolicy | false
  /** Правила по хостам (`URL.hostname`); хосты вне списка идут без очереди. */
  hosts?: Record<string, HostPolicy>
  /**
   * Склеивать одинаковые одновременные запросы в один: GET/HEAD без тела, а
   * также `idempotent: true` со строковым телом. Каждый получает свою копию
   * ответа (тело читается в память). По умолчанию `true`.
   */
  dedupe?: boolean
  clock?: Partial<FetchClock>
}

/** Параметры вызова: обычный `RequestInit` и несколько своих полей. */
export interface FetchInit extends RequestInit {
  /** Таймаут одной попытки для этого вызова. */
  timeoutMs?: number
  /** Повторы для этого вызова (поля поверх общих) или `false`. */
  retry?: RetryPolicy | false
  /**
   * Запрос безопасно повторить. По умолчанию — по методу (GET, HEAD, OPTIONS,
   * PUT, DELETE). Нужен для POST, который ничего не меняет (запрос GraphQL).
   */
  idempotent?: boolean
  /** Склеивать ли этот вызов с одинаковыми (см. `CreateFetchOptions.dedupe`). */
  dedupe?: boolean
  /**
   * Вызов ждёт — для показа ожидания: очередь лимита хоста или пауза перед
   * повтором. Склеенный вызов получает ожидания общего запроса, включая последнее
   * случившееся до него.
   */
  onWait?: (wait: FetchWait) => void
}

/**
 * Почему вызов ждёт.
 * - `queue`: место в лимитах хоста. `ahead` — сколько вызовов впереди (известно
 *   при входе в очередь); `waitMs` — пауза до запуска, когда она уже посчитана.
 * - `retry`: пауза перед попыткой `attempt` из `attempts` (`Retry-After` или
 *   экспонента).
 */
export type FetchWait =
  | { reason: 'queue'; host: string; ahead: number; waitMs?: number }
  | { reason: 'retry'; attempt: number; attempts: number; waitMs: number }

type Notify = ((wait: FetchWait) => void) | undefined

/** Совместим с `fetch`: тот же вызов, тот же `Response`. */
export type AppFetch = (input: string | URL | Request, init?: FetchInit) => Promise<Response>

const DEFAULT_RETRY: Required<RetryPolicy> = {
  attempts: 3,
  baseDelayMs: 300,
  maxDelayMs: 5_000,
  statuses: [408, 425, 429, 500, 502, 503, 504],
}
const IDEMPOTENT = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'])
const NULL_BODY = new Set([101, 204, 205, 304])
const SECOND = 1_000
const MINUTE = 60_000

const realClock: FetchClock = {
  now: () => Date.now(),
  random: () => Math.random(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason)
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }, ms)
      const onAbort = () => {
        clearTimeout(timer)
        reject(signal!.reason)
      }
      signal?.addEventListener('abort', onAbort, { once: true })
    }),
}

type HostState = {
  policy: HostPolicy
  /** Времена запусков за последнюю минуту (или секунду, если `rpm` нет). */
  starts: number[]
  /** Сервис попросил паузу (`Retry-After`): до этого момента запусков нет. */
  blockedUntil: number
  /** Хвост очереди: запуски идут строго по порядку. */
  tail: Promise<void>
  /** Сколько вызовов сейчас в очереди (для `onWait`). */
  queued: number
}

type Snapshot = { status: number; statusText: string; headers: [string, string][]; body: ArrayBuffer | null }
/** Общий запрос в полёте и те, кто ждёт его ожиданий (`onWait`). */
type InflightEntry = { shared: Promise<Snapshot>; listeners: Set<(wait: FetchWait) => void>; last?: FetchWait }

/**
 * Обёртка над `fetch` с тем, что нужно каждому обращению к чужому сервису:
 * таймаут попытки, свой `signal`, повторы с паузами и `Retry-After`, лимит
 * запусков на хост, склейка одинаковых одновременных GET.
 *
 * Кэша здесь нет: что и сколько хранить, решает тот, кто знает данные.
 *
 * @example
 * const upstream = createFetch({ hosts: { 'api.example.com': { rps: 4, rpm: 80 } } })
 * const res = await upstream('https://api.example.com/items', { signal })
 * const items = await readJson<Item[]>(res)
 */
export function createFetch(options: CreateFetchOptions = {}): AppFetch {
  const clock: FetchClock = { ...realClock, ...options.clock }
  const baseTimeout = options.timeoutMs ?? 10_000
  const baseRetry = options.retry
  const hosts = new Map<string, HostState>()
  const inflight = new Map<string, InflightEntry>()
  const lower = (input: string | URL | Request, init?: RequestInit) =>
    (options.fetch ?? globalThis.fetch)(input, init)

  for (const [name, policy] of Object.entries(options.hosts ?? {})) {
    hosts.set(name, { policy, starts: [], blockedUntil: 0, tail: Promise.resolve(), queued: 0 })
  }

  const retryFor = (call: RetryPolicy | false | undefined): Required<RetryPolicy> | null => {
    if (baseRetry === false || call === false) return null
    return { ...DEFAULT_RETRY, ...baseRetry, ...call }
  }

  /** Ждать места в лимитах хоста. Порядок запусков — порядок вызовов. */
  async function acquire(name: string, host: HostState, signal: AbortSignal | undefined, notify: Notify): Promise<void> {
    const prev = host.tail
    let release!: () => void
    host.tail = new Promise<void>((r) => (release = r))
    const ahead = host.queued++
    try {
      if (ahead > 0) notify?.({ reason: 'queue', host: name, ahead })
      await abortable(prev, signal)
      for (;;) {
        const wait = waitTime(host, clock.now())
        if (wait <= 0) break
        notify?.({ reason: 'queue', host: name, ahead: 0, waitMs: wait })
        await clock.sleep(wait, signal)
      }
      host.starts.push(clock.now())
    } finally {
      host.queued -= 1
      // Очередь не рвётся: следующий ждёт предыдущего, даже если этот прерван.
      prev.then(release, release)
    }
  }

  async function attempt(
    method: string,
    url: URL,
    input: string | URL | Request,
    init: RequestInit,
    timeoutMs: number,
    signal: AbortSignal | undefined,
    notify: Notify,
  ): Promise<Response> {
    const host = hosts.get(url.hostname)
    if (host) await acquire(url.hostname, host, signal, notify)
    const timeout = AbortSignal.timeout(timeoutMs)
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
    try {
      return await lower(input instanceof Request ? input.clone() : input, { ...init, signal: combined })
    } catch (error) {
      if (signal?.aborted) throw signal.reason
      const cause = { method, url: url.href, error }
      if (timeout.aborted) throw new FetchError('fetch.timeout', 'внешний сервис не ответил вовремя', { cause })
      throw new FetchError('fetch.network', 'внешний сервис недоступен', { cause })
    }
  }

  async function run(
    method: string,
    url: URL,
    input: string | URL | Request,
    init: RequestInit,
    call: FetchInit,
    signal: AbortSignal | undefined,
    notify: Notify,
  ): Promise<Response> {
    const retry = retryFor(call.retry)
    const repeatable = call.idempotent ?? IDEMPOTENT.has(method)
    const attempts = retry && repeatable ? Math.max(1, retry.attempts) : 1
    const timeoutMs = call.timeoutMs ?? baseTimeout
    for (let n = 1; ; n += 1) {
      let res: Response
      try {
        res = await attempt(method, url, input, init, timeoutMs, signal, notify)
      } catch (error) {
        if (!(error instanceof FetchError) || n >= attempts) throw error
        const waitMs = backoff(retry!, n, clock)
        notify?.({ reason: 'retry', attempt: n + 1, attempts, waitMs })
        await clock.sleep(waitMs, signal)
        continue
      }
      const asked = retryAfter(res, clock.now())
      const host = hosts.get(url.hostname)
      if (asked !== null && host && (res.status === 429 || res.status === 503)) {
        host.blockedUntil = Math.max(host.blockedUntil, clock.now() + asked)
      }
      if (!retry || n >= attempts || !retry.statuses.includes(res.status)) return res
      if (asked !== null && asked > retry.maxDelayMs) return res
      await res.body?.cancel().catch(() => undefined)
      const waitMs = asked ?? backoff(retry, n, clock)
      notify?.({ reason: 'retry', attempt: n + 1, attempts, waitMs })
      await clock.sleep(waitMs, signal)
    }
  }

  return async function appFetch(input, init = {}) {
    const { timeoutMs, retry, idempotent, dedupe, signal, onWait, ...rest } = init
    signal?.throwIfAborted()
    const url = new URL(input instanceof Request ? input.url : String(input))
    const method = (rest.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const host = hosts.get(url.hostname)
    const headers = new Headers(input instanceof Request ? input.headers : undefined)
    for (const [k, v] of Object.entries(host?.policy.headers ?? {})) if (!headers.has(k)) headers.set(k, v)
    for (const [k, v] of new Headers(rest.headers)) headers.set(k, v)
    const lowerInit: RequestInit = { ...rest, method, headers }
    const call: FetchInit = { timeoutMs, retry, idempotent }

    // Склеиваются GET/HEAD без тела и запросы, объявленные безопасными, со
    // строковым телом (запрос GraphQL): тело входит в ключ.
    const body = rest.body
    const safeRead = (method === 'GET' || method === 'HEAD') && body == null
    const safeWithBody = call.idempotent === true && typeof body === 'string'
    const canShare =
      (dedupe ?? options.dedupe ?? true) &&
      (safeRead || safeWithBody) &&
      !(input instanceof Request && input.body)
    if (!canShare) return await run(method, url, input, lowerInit, call, signal ?? undefined, onWait)

    const key = JSON.stringify([method, url.href, [...headers].sort(), typeof body === 'string' ? body : null])
    let entry = inflight.get(key)
    if (!entry) {
      // Ожидания общего запроса — всем, кто его ждёт; последнее помнится для
      // присоединившихся позже (наследуют ход).
      const made = { listeners: new Set() } as InflightEntry
      const notify = (wait: FetchWait) => {
        made.last = wait
        for (const listener of made.listeners) listener(wait)
      }
      // Общий запрос не знает ни одного `signal` ожидающих: уход одного не рвёт
      // запрос остальным. Сверху его держит только таймаут попытки.
      made.shared = run(method, url, input, lowerInit, call, undefined, notify)
        .then((res) => snapshot(res, method, url))
        .finally(() => inflight.delete(key))
      // Все ожидающие могли уйти: отказ общего запроса тогда некому принять.
      made.shared.catch(() => undefined)
      entry = made
      inflight.set(key, made)
    }
    if (onWait) {
      entry.listeners.add(onWait)
      if (entry.last) onWait(entry.last)
    }
    try {
      const snap = await abortable(entry.shared, signal ?? undefined)
      return new Response(snap.body, { status: snap.status, statusText: snap.statusText, headers: snap.headers })
    } finally {
      if (onWait) entry.listeners.delete(onWait)
    }
  }
}

/** Пауза перед повтором `n`: full jitter в пределах `base · 2^(n-1)`, не выше потолка. */
function backoff(retry: Required<RetryPolicy>, n: number, clock: FetchClock): number {
  const ceiling = Math.min(retry.maxDelayMs, retry.baseDelayMs * 2 ** (n - 1))
  return Math.round(ceiling * clock.random())
}

/** `Retry-After` в мс: секунды или HTTP-дата; `null`, если заголовка нет или он кривой. */
export function retryAfter(res: Response, now: number): number | null {
  const raw = res.headers.get('retry-after')
  if (raw == null || raw.trim() === '') return null
  const seconds = Number(raw)
  if (Number.isFinite(seconds)) return seconds >= 0 ? Math.round(seconds * 1000) : null
  const at = Date.parse(raw)
  return Number.isNaN(at) ? null : Math.max(0, at - now)
}

/** Сколько ждать до следующего разрешённого запуска (0 — можно сейчас). */
function waitTime(host: HostState, now: number): number {
  const { rps, rpm } = host.policy
  const keep = rpm ? MINUTE : SECOND
  while (host.starts.length && host.starts[0]! <= now - keep) host.starts.shift()
  let wait = host.blockedUntil - now
  for (const [limit, window] of [
    [rps, SECOND],
    [rpm, MINUTE],
  ] as const) {
    if (!limit) continue
    const recent = host.starts.filter((t) => t > now - window)
    if (recent.length >= limit) wait = Math.max(wait, recent[recent.length - limit]! + window - now)
  }
  return wait
}

/** Ответ в память, чтобы раздать каждому ожидающему свою копию. */
async function snapshot(res: Response, method: string, url: URL): Promise<Snapshot> {
  const empty = method === 'HEAD' || NULL_BODY.has(res.status) || res.body === null
  let body: ArrayBuffer | null = null
  if (!empty) {
    try {
      body = await res.arrayBuffer()
    } catch (error) {
      throw bodyError(error, method, url)
    }
  }
  return { status: res.status, statusText: res.statusText, headers: [...res.headers], body }
}

/** Сбой чтения тела → та же ошибка, что у сбоя запроса. */
export function bodyError(error: unknown, method: string, url: URL | string): FetchError {
  const cause = { method, url: String(url), error }
  const name = error instanceof Error ? error.name : ''
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new FetchError('fetch.timeout', 'внешний сервис не ответил вовремя', { cause })
  }
  return new FetchError('fetch.network', 'внешний сервис недоступен', { cause })
}

/** Ждать обещание, но отказаться по своему `signal` (само обещание не отменяется). */
function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}
