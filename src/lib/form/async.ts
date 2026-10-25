// Асинхронные проверки.
//
// Это ОПТИМИЗАЦИЯ, а не отдельная возможность: на сервере те же проверки
// выполняются всегда, просто без подавления частых вызовов. Отправку они
// не блокируют — иначе путь без скрипта и путь с перехватом разошлись бы.
import { opaque } from './constraints'
import { decode, type EntrySource } from './decode'
import type { FormDescription } from './describe'
import type { FormError } from './result'
import { stableId } from './result'
import { describe, type Issue, type MessageValidator, type Validator } from './validators'
import type { FieldPath } from './types'

/** Контекст асинхронной проверки. */
export interface CheckContext {
  /** Проверяемое поле. */
  path: FieldPath
  /** Значения всей формы: для межполевых проверок. */
  values: Record<string, unknown>
  /** Сигнал отмены: новая проверка того же поля отменяет предыдущую. */
  signal: AbortSignal
}
/**
 * Асинхронная проверка. Возвращает одну ошибку, несколько или ничего:
 * несколько — когда проверяемое значение это СПИСОК (файлы), и отказать
 * должен каждый плохой элемент, а не первый попавшийся.
 */
export type AsyncCheck = (value: unknown, ctx: CheckContext) => Promise<Issue | readonly Issue[] | null>

/** Настройка асинхронных проверок: задержка, кэш по значению, таймаут. */
export interface AsyncPolicy {
  readonly debounceMs: number
  readonly cacheByValue: boolean
  readonly timeoutMs: number
}
/** Умолчания асинхронных проверок: 400 мс дебаунса, кэш по значению, таймаут 5 с. */
export const DEFAULT_ASYNC: AsyncPolicy = { debounceMs: 400, cacheByValue: true, timeoutMs: 5000 }

/** Реестр асинхронных проверок по имени правила — их зовёт клиент и сервер. */
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
 * Валидатор-обёртка асинхронной проверки: синхронно всегда пропускает,
 * настоящая проверка идёт отдельно — в браузере с подавлением частых
 * вызовов, на сервере всегда. Вида ограничения у неё нет — отсюда `opaque`.
 * @param name Имя проверки в `CheckRegistry`.
 * @param policy Дебаунс, кэш по значению, таймаут.
 */
export function check(name: string, policy: Partial<AsyncPolicy> = {}): MessageValidator<unknown> {
  const v = describe<unknown>(() => null, [opaque('асинхронная проверка не выражается атрибутом')])
  return Object.assign(v, { asyncCheck: { name, policy: { ...DEFAULT_ASYNC, ...policy } } })
}

/** `message` — свой текст ошибки проверки: `check(…).message('…')` (F56). */
export interface AsyncRef { name: string; policy: AsyncPolicy; message?: string }

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

/** Один вердикт проверки → список: несколько ошибок — это список файлов. */
const toIssues = (x: Issue | readonly Issue[] | null): readonly Issue[] =>
  x === null || x === undefined ? [] : Array.isArray(x) ? x : [x as Issue]

const toError = (i: Issue, path: string, own?: string): FormError => {
  const template = i.message ?? own
  return {
    id: stableId({ path, code: i.code, params: i.params }),
    code: i.code, message: i.code, params: i.params, path, origin: 'core',
    ...(template !== undefined ? { template } : {}),
  }
}

/** Прогон всех асинхронных проверок формы. Сервер делает это ВСЕГДА. */
/**
 * Прогон всех асинхронных проверок формы. Сервер делает это ВСЕГДА.
 * @param d Описание формы.
 * @param values Проверенные значения.
 * @param checks Реестр проверок.
 * @param signal Сигнал отмены всего прогона.
 */
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
        for (const one of toIssues(issue)) out.push(toError(one, f.name, ref.message))
      } catch {
        // сбой проверки — ошибка на СВОЁМ поле, форма не падает целиком
        out.push(toError({ code: 'check.failed', params: { check: ref.name } }, f.name))
      }
    }
  }
  return out
}

/**
 * Значения формы для асинхронных проверок в браузере — ТЕ ЖЕ, что сервер даёт
 * `runAsyncChecks`: разобранные типом поля (`decode`), а не сырые строки
 * `FormData` (число `"42"` вместо `42`, флажок `"on"` вместо `true`, мультиполе —
 * последнее значение). Иначе одна проверка решала бы по-разному на двух путях.
 * @param data Данные формы (`new FormData(form)`).
 * @param d Описание формы.
 */
export function valuesForChecks(data: EntrySource, d: FormDescription): Record<string, unknown> {
  return decode(data, d).values
}

/**
 * Предел кэша проверок по значению. Ключ — значение поля: без предела каждое
 * набранное значение (логин, e-mail) оставалось в памяти до ухода со страницы.
 */
const CACHE_MAX = 200

/**
 * Браузерная сторона: подавление частых вызовов, отмена предыдущей проверки
 * того же поля, кэш по значению.
 */
export class AsyncRunner {
  #timers = new Map<FieldPath, ReturnType<typeof setTimeout>>()
  #inflight = new Map<FieldPath, AbortController>()
  /** Кэш по значению; самые старые записи вытесняются после `CACHE_MAX`. */
  #cache = new Map<string, readonly FormError[]>()
  /**
   * Поколение поля: растёт на каждом `schedule` и `cancel`. Ответ отдаётся в
   * колбэк, только если поколение не сменилось — иначе вытесненная проверка
   * сообщила бы «ошибки нет» поверх новой (и сняла бы признак «идёт проверка»).
   */
  #generation = new Map<FieldPath, number>()

  constructor(private readonly checks: CheckRegistry) {}

  #remember(key: string, e: readonly FormError[]): void {
    this.#cache.delete(key)
    this.#cache.set(key, e)
    if (this.#cache.size > CACHE_MAX) this.#cache.delete(this.#cache.keys().next().value!)
  }

  #bump(path: FieldPath): number {
    const next = (this.#generation.get(path) ?? 0) + 1
    this.#generation.set(path, next)
    return next
  }

  get pending(): number { return this.#inflight.size }

  /**
   * Запланировать проверку поля с дебаунсом.
   * @param d Описание формы.
   * @param path Поле.
   * @param values Значения формы.
   * @param onResult Колбэк с ошибкой или `null`.
   */
  schedule(
    d: FormDescription, path: FieldPath, values: Record<string, unknown>,
    onResult: (e: readonly FormError[]) => void,
  ): void {
    const refs = asyncRefsOf(d, path)
    if (!refs.length) return
    const debounce = Math.max(...refs.map((r) => r.policy.debounceMs))
    const generation = this.#bump(path)
    clearTimeout(this.#timers.get(path))
    this.#timers.set(path, setTimeout(() => {
      void this.run(d, path, values).then((e) => {
        if (this.#generation.get(path) === generation) onResult(e)
      })
    }, debounce))
  }

  /**
   * Прогнать проверки поля.
   * @returns Ошибки поля: пусто — вердикт положительный. Ошибок бывает несколько,
   *   когда проверка судит список (файлы): по строке на плохой элемент.
   */
  async run(d: FormDescription, path: FieldPath, values: Record<string, unknown>):
    Promise<readonly FormError[]> {
    const refs = asyncRefsOf(d, path)
    if (!refs.length) return []
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
        if (controller.signal.aborted) return []
        const errors = toIssues(issue).map((one) => toError(one, path, ref.message))
        if (errors.length) {
          this.#remember(key, errors)
          return errors
        }
      }
      this.#remember(key, [])
      return []
    } catch {
      if (controller.signal.aborted) return []
      return [toError({ code: 'check.failed' }, path)]
    } finally {
      clearTimeout(timeout)
      if (this.#inflight.get(path) === controller) this.#inflight.delete(path)
    }
  }

  /**
   * Отменить таймеры и полёты одного поля или всех.
   * @param path Поле; без него — все.
   */
  cancel(path?: FieldPath): void {
    if (path) {
      this.#bump(path)
      clearTimeout(this.#timers.get(path)); this.#timers.delete(path)
      this.#inflight.get(path)?.abort('cancelled'); this.#inflight.delete(path)
      return
    }
    for (const p of [...this.#timers.keys(), ...this.#inflight.keys()]) this.#bump(p)
    for (const t of this.#timers.values()) clearTimeout(t)
    for (const c of this.#inflight.values()) c.abort('cancelled')
    this.#timers.clear(); this.#inflight.clear()
  }
}
