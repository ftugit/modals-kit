/**
 * Универсальный GraphQL-источник: `{ url, doc, variables, map }`.
 *
 * Один и тот же транспорт обслуживает любой GraphQL-эндпоинт — Shikimori здесь
 * просто `url` (решение этапа 3: транспорт не знает про каталог, а каталог не
 * знает про транспорт). Что входит в контракт, кроме POST:
 *
 *   • User-Agent (его требуют публичные API) и жёсткий таймаут каждого запроса;
 *   • кэш по `url + doc + variables` (повторный разбор схемы не дёргает API);
 *   • single-flight: одновременные вызовы одного запроса делят ОДИН запрос —
 *     «ровно один обновляющий запрос» это свойство транспорта, а не удача;
 *   • вежливость: минимальный зазор между ЛЮБЫМИ запросами транспорта;
 *   • один повтор на 429/5xx, дальше честная ошибка (не «пустой результат»);
 *   • GraphQL-ответ с `errors` — ошибка, даже если HTTP 200: частичные данные
 *     не данные, и молча построить по ним схему нельзя.
 *
 * Ошибки наружу — `GraphqlUpstreamError` со статусом: потребитель (роут)
 * показывает их как 502/504, а не как пустой список.
 */
import { isServerSide } from '$lib/paginate'

/** Запрос к GraphQL: адрес, документ, переменные и проекция ответа. */
export type GraphqlSpec<T, V = Record<string, unknown>> = {
  url: string
  /** Документ запроса (строка GraphQL). */
  doc: string
  variables?: V
  /** Имя операции, если в документе их несколько. */
  operationName?: string
  /**
   * `data` ответа → значение домена. Проекция живёт рядом с запросом: транспорт
   * не знает ни одного поля конкретного API.
   */
  map: (data: unknown, raw: unknown) => T
}

export type GraphqlDeps = {
  fetch?: typeof globalThis.fetch
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  cacheTtlMs?: number
  minGapMs?: number
  retryDelayMs?: number
  timeoutMs?: number
  ua?: string
}

export const GRAPHQL_UA = 'modals-kit-demo/0.1 (+https://github.com/ftugit/modals-kit)'
const CACHE_TTL_MS = 60_000
const MIN_GAP_MS = 250
const RETRY_DELAY_MS = 1_000
const TIMEOUT_MS = 10_000

export class GraphqlUpstreamError extends Error {
  status: number
  constructor(message: string, status = 502) {
    super(message)
    this.name = 'GraphqlUpstreamError'
    this.status = status
  }
}

type Resolved = Required<Omit<GraphqlDeps, 'fetch'>> & { fetch: typeof globalThis.fetch }

function resolveDeps(deps: GraphqlDeps): Resolved {
  return {
    fetch: deps.fetch ?? globalThis.fetch,
    now: deps.now ?? (() => Date.now()),
    sleep: deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms))),
    cacheTtlMs: deps.cacheTtlMs ?? CACHE_TTL_MS,
    minGapMs: deps.minGapMs ?? MIN_GAP_MS,
    retryDelayMs: deps.retryDelayMs ?? RETRY_DELAY_MS,
    timeoutMs: deps.timeoutMs ?? TIMEOUT_MS,
    ua: deps.ua ?? GRAPHQL_UA,
  }
}

type Entry<T> = { at: number; value: T }
const cache = new Map<string, Entry<unknown>>()
const inflight = new Map<string, Promise<unknown>>()
let lastStartedAt = 0
let startQueue: Promise<unknown> = Promise.resolve()

/** Сброс состояния транспорта (тесты; в приложении не нужен). */
export function resetGraphqlTransport(): void {
  cache.clear()
  inflight.clear()
  lastStartedAt = 0
  startQueue = Promise.resolve()
}

/** Ключ кэша: одинаковый запрос — одна запись, разные — разные. */
export function graphqlCacheKey<T, V>(spec: GraphqlSpec<T, V>): string {
  const { url, doc, variables, operationName } = spec
  return JSON.stringify([url, doc, variables ?? null, operationName ?? null])
}

/** Запуск с соблюдением минимального зазора между обращениями к внешнему API. */
function schedule<T>(task: () => Promise<T>, deps: Resolved): Promise<T> {
  const prev = startQueue
  const run = (async () => {
    await prev.catch(() => undefined)
    const wait = Math.max(0, deps.minGapMs - (deps.now() - lastStartedAt))
    if (wait > 0) await deps.sleep(wait)
    lastStartedAt = deps.now()
    return task()
  })()
  startQueue = run.catch(() => undefined)
  return run
}

async function requestGraphql<T, V>(spec: GraphqlSpec<T, V>, deps: Resolved): Promise<T> {
  const body = JSON.stringify({
    query: spec.doc,
    ...(spec.variables !== undefined ? { variables: spec.variables } : {}),
    ...(spec.operationName ? { operationName: spec.operationName } : {}),
  })
  for (let attempt = 0; ; attempt += 1) {
    let res: Response
    try {
      res = await deps.fetch(spec.url, {
        method: 'POST',
        headers: { 'User-Agent': deps.ua, 'content-type': 'application/json', accept: 'application/json' },
        body,
        signal: AbortSignal.timeout(deps.timeoutMs),
      })
    } catch (error) {
      throw new GraphqlUpstreamError(`GraphQL недоступен: ${String(error)}`, 504)
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt === 0) {
        await deps.sleep(deps.retryDelayMs)
        continue
      }
      throw new GraphqlUpstreamError(`GraphQL ответил ${res.status}`, 502)
    }
    if (!res.ok) throw new GraphqlUpstreamError(`GraphQL ответил ${res.status}`, 502)
    const raw: unknown = await res.json()
    const payload = (raw ?? {}) as { data?: unknown; errors?: readonly { message?: string }[] }
    if (payload.errors?.length) {
      throw new GraphqlUpstreamError(
        `GraphQL: ${payload.errors.map((e) => e.message ?? 'ошибка').join('; ')}`,
        502,
      )
    }
    if (payload.data === undefined || payload.data === null) {
      throw new GraphqlUpstreamError('GraphQL: ответ без data', 502)
    }
    return spec.map(payload.data, raw)
  }
}

/**
 * Выполнить GraphQL-запрос. Повторные вызовы того же запроса в пределах TTL
 * берут кэш; одновременные — один запрос (single-flight). `signal` влияет
 * только на ОЖИДАНИЕ вызова: прерывание не отменяет общий запрос, он дозаполнит
 * кэш для остальных ожидающих.
 */
export async function fetchGraphql<T, V = Record<string, unknown>>(
  spec: GraphqlSpec<T, V>,
  { signal, ...depsIn }: GraphqlDeps & { signal?: AbortSignal } = {},
): Promise<T> {
  if (isServerSide() === false) {
    throw new Error('[graphql] транспорт схемы работает только на сервере')
  }
  const deps = resolveDeps(depsIn)
  const key = graphqlCacheKey(spec)

  const hit = cache.get(key) as Entry<T> | undefined
  if (hit && deps.now() - hit.at < deps.cacheTtlMs) return hit.value

  let job = inflight.get(key) as Promise<T> | undefined
  if (!job) {
    job = schedule(() => requestGraphql(spec, deps), deps).then(
      (value) => {
        cache.set(key, { at: deps.now(), value })
        inflight.delete(key)
        return value
      },
      (error) => {
        inflight.delete(key)
        throw error
      },
    )
    inflight.set(key, job)
  }

  if (!signal) return job
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
    job.then(
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
