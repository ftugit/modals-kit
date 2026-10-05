// Состояние формы и подписка. Контракт — самый бедный из трёх моделей
// реактивности: функция, снимок, отписка. Остальное надстраивает адаптер.
import type { FormError, Outcome, Result } from './result'
import type { FieldPath, Revision } from './types'

export interface FormState {
  readonly revision: Revision
  readonly status: 'idle' | 'validating' | 'submitting' | 'queued' | 'success' | 'error'
  readonly pending: boolean
  /** Какое именно действие в полёте: из двух кнопок занята только нажатая. */
  readonly pendingIntent?: string
  readonly values: Readonly<Record<string, unknown>>   // снимок для рендера; истина — DOM
  readonly dirty: Readonly<Record<FieldPath, boolean>>
  readonly touched: Readonly<Record<FieldPath, boolean>>
  readonly submitCount: number
  /** ФАКТ: ошибки как они есть. Отсюда поле берёт «я невалидно». */
  readonly facts: readonly FormError[]
  /** ПОКАЗ: то, что вернул обработчик. Отсюда берутся тексты. */
  readonly shown: readonly FormError[]
  /** Сколько ошибок обработчик убрал. */
  readonly removed: number
  /** Поля, по которым идёт асинхронная проверка. */
  readonly checking: Readonly<Record<FieldPath, true>>
  readonly fresh: Readonly<Record<FieldPath, true>>
  readonly result?: Result
  readonly outcome?: Outcome
}

/**
 * Начальное состояние формы.
 * @param revision Ревизия описания на момент связывания.
 * @param values Начальные значения (например, из продолжения).
 */
export const initialState = (revision: Revision, values: Record<string, unknown> = {}): FormState => ({
  revision, status: 'idle', pending: false, values,
  dirty: {}, touched: {}, submitCount: 0, facts: [], shown: [], removed: 0,
  checking: {}, fresh: {},
})

/**
 * Структурное разделение: неизменившаяся часть обязана сохранить ссылку.
 * Это не оптимизация, а условие корректности — иначе гранулярная
 * реактивность вырождается в полную перерисовку.
 */
/**
 * Структурное разделение: неизменившаяся часть обязана сохранить ссылку.
 * Это условие корректности гранулярной реактивности, а не оптимизация.
 * @param prev Прошлое значение.
 * @param next Новое значение.
 * @returns `prev`, если ничего не изменилось, иначе новое дерево с общими ветвями.
 */
export function share<T>(prev: T, next: T): T {
  if (Object.is(prev, next)) return prev
  if (prev === null || next === null || typeof prev !== 'object' || typeof next !== 'object') return next
  if (Array.isArray(prev) !== Array.isArray(next)) return next

  const keys = new Set([...Object.keys(prev as object), ...Object.keys(next as object)])
  let changed = false
  const out: Record<string, unknown> = Array.isArray(next) ? ([] as never) : {}
  for (const k of keys) {
    if (!(k in (next as object))) { changed = true; continue }
    const a = (prev as Record<string, unknown>)[k]
    const merged = share(a, (next as Record<string, unknown>)[k])
    out[k] = merged
    if (!Object.is(merged, a)) changed = true
  }
  if (Array.isArray(next) && (next as unknown[]).length !== (prev as unknown[]).length) changed = true
  return changed ? (out as T) : prev
}

export class FormStore {
  #state: FormState
  #listeners = new Set<() => void>()

  constructor(initial: FormState) { this.#state = initial }

  /**
   * Снимок для рендера. НЕ ПЕРЕСЧИТЫВАЕТ: обязан быть стабилен по ссылке,
   * иначе `useSyncExternalStore` зациклится.
   */
  getSnapshot = (): FormState => this.#state
  subscribe = (l: () => void) => { this.#listeners.add(l); return () => { this.#listeners.delete(l) } }

  /**
   * Применить обновление через структурное разделение.
   * Пустое обновление подписчиков не будит.
   * @param next Функция текущего состояния → нового.
   */
  set(next: (s: FormState) => FormState): void {
    const merged = share(this.#state, next(this.#state))
    if (merged === this.#state) return          // пустое обновление не будит подписчиков
    this.#state = merged
    for (const l of [...this.#listeners]) l()
  }

  /**
   * Селектор с кэшем по ссылке состояния: для точечных подписок.
   * @param sel Проекция состояния.
   * @returns Геттер, стабильный пока состояние то же.
   */
  select<T>(sel: (s: FormState) => T): () => T {
    let last: FormState | undefined
    let value: T
    return () => {
      if (last !== this.#state) { last = this.#state; value = sel(this.#state) }
      return value
    }
  }
}
