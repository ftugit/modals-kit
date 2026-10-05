// Асинхронные проверки.
//
// Это ОПТИМИЗАЦИЯ, а не отдельная возможность: на сервере те же проверки
// выполняются всегда, просто без подавления частых вызовов. Отправку они
// не блокируют — иначе путь без скрипта и путь с перехватом разошлись бы.
import { opaque } from './constraints'
import type { FormDescription } from './describe'
import type { FormError } from './result'
import { stableId } from './result'
import { describe, type Issue, type Validator } from './validators'
import type { FieldPath } from './types'

/** Контекст одной асинхронной проверки поля: путь, текущие значения и AbortSignal. */
export interface CheckContext { path: FieldPath; values: Record<string, unknown>; signal: AbortSignal }
/** Асинхронный валидатор поля. Возвращает Issue или null, если значение принято. */
export type AsyncCheck = (value: unknown, ctx: CheckContext) => Promise<Issue | null>

/** Настройки debounce, кеширования и таймаута для асинхронных проверок. */
export interface AsyncPolicy {
  readonly debounceMs: number
  readonly cacheByValue: boolean
  readonly timeoutMs: number
}
/** Политика асинхронных проверок по умолчанию. */
export const DEFAULT_ASYNC: AsyncPolicy = { debounceMs: 400, cacheByValue: true, timeoutMs: 5000 }

/** Реестр асинхронных проверок приложения. */
export class CheckRegistry {
  #byName = new Map<string, AsyncCheck>()
  register(name: string, fn: AsyncCheck): this {
    this.#byName.set(name, fn)
    return this
  }
  has = (name: string) => this.#byName.has(name)
  get = (name: string) => this.#byName.get(name)
}

/**
 * Валидатор-обёртка: синхронно он всегда пропускает, настоящая проверка идёт
 * отдельно. Вида ограничения у него нет и быть не может — отсюда `opaque`.
 */
export function check(name: string, policy: Partial<AsyncPolicy> = {}): Validator<unknown> {
  const v = describe<unknown>(() => null, [opaque('асинхронная проверка не выражается атрибутом')])
  return Object.assign(v, { asyncCheck: { name, policy: { ...DEFAULT_ASYNC, ...policy } } })
}

/** Нормализованная ссылка на асинхронную проверку с уже разрешённой политикой. */
export interface AsyncRef { name: string; policy: AsyncPolicy }

/** Асинхронные проверки поля — их надо прогнать и на сервере, и в браузере. */
export function asyncRefsOf(d: FormDescription, name: string): AsyncRef[] {
  const f = d.byName[name]
  if (!f) return []
  const out: AsyncRef[] = []
  for (const ref of f.validators) {
    let v: Validator<any>
    try { v = d.registry.validators.resolve(ref) } catch { continue }
    const meta = (v as { asyncCheck?: AsyncRef }).asyncCheck
    if (meta) out.push(meta)
  }
  return out
}

const toError = (i: Issue, path: string): FormError => ({
  id: stableId({ path, code: i.code, params: i.params }),
  code: i.code, message: i.code, params: i.params, path, origin: 'core',
})

/** Прогон всех асинхронных проверок формы. Сервер делает это ВСЕГДА. */
export async function runAsyncChecks(
  d: FormDescription, values: Record<string, unknown>, checks: CheckRegistry,
  signal: AbortSignal = new AbortController().signal,
): Promise<FormError[]> {
  const out: FormError[] = []
  for (const f of d.fields) {
    for (const ref of asyncRefsOf(d, f.name)) {
      const fn = checks.get(ref.name)
      if (!fn) continue
      try {
        const issue = await fn(values[f.name], { path: f.name, values, signal })
        if (issue) out.push(toError(issue, f.name))
      } catch {
        // сбой проверки — ошибка на СВОЁМ поле, форма не падает целиком
        out.push(toError({ code: 'check.failed', params: { check: ref.name } }, f.name))
      }
    }
  }
  return out
}

/**
 * Браузерная сторона: подавление частых вызовов, отмена предыдущей проверки
 * того же поля, кэш по значению.
 */
export class AsyncRunner {
  #timers = new Map<FieldPath, ReturnType<typeof setTimeout>>()
  #inflight = new Map<FieldPath, AbortController>()
  #cache = new Map<string, FormError | null>()

  constructor(private readonly checks: CheckRegistry) {}

  get pending(): number { return this.#inflight.size }

  schedule(
    d: FormDescription, path: FieldPath, values: Record<string, unknown>,
    onResult: (e: FormError | null) => void,
  ): void {
    const refs = asyncRefsOf(d, path)
    if (!refs.length) return
    const debounce = Math.max(...refs.map((r) => r.policy.debounceMs))
    clearTimeout(this.#timers.get(path))
    this.#timers.set(path, setTimeout(() => {
      void this.run(d, path, values).then(onResult)
    }, debounce))
  }

  async run(d: FormDescription, path: FieldPath, values: Record<string, unknown>):
    Promise<FormError | null> {
    const refs = asyncRefsOf(d, path)
    if (!refs.length) return null
    const key = `${path}:${JSON.stringify(values[path] ?? null)}`
    if (refs.every((r) => r.policy.cacheByValue) && this.#cache.has(key))
      return this.#cache.get(key)!

    this.#inflight.get(path)?.abort('superseded')
    const controller = new AbortController()
    this.#inflight.set(path, controller)
    const timeout = setTimeout(() => controller.abort('timeout'),
                               Math.max(...refs.map((r) => r.policy.timeoutMs)))
    try {
      for (const ref of refs) {
        const fn = this.checks.get(ref.name)
        if (!fn) continue
        const issue = await fn(values[path], { path, values, signal: controller.signal })
        if (controller.signal.aborted) return null
        if (issue) {
          const e = toError(issue, path)
          this.#cache.set(key, e)
          return e
        }
      }
      this.#cache.set(key, null)
      return null
    } catch {
      if (controller.signal.aborted) return null
      return toError({ code: 'check.failed' }, path)
    } finally {
      clearTimeout(timeout)
      if (this.#inflight.get(path) === controller) this.#inflight.delete(path)
    }
  }

  cancel(path?: FieldPath): void {
    if (path) {
      clearTimeout(this.#timers.get(path)); this.#timers.delete(path)
      this.#inflight.get(path)?.abort('cancelled'); this.#inflight.delete(path)
      return
    }
    for (const t of this.#timers.values()) clearTimeout(t)
    for (const c of this.#inflight.values()) c.abort('cancelled')
    this.#timers.clear(); this.#inflight.clear()
  }
}
