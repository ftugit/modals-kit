// Показ ошибок. Библиотека знает ровно два места: общие и поля.
//
// Всплывающее уведомление, системное уведомление, сообщение в мессенджер —
// это не её дело: разработчик забирает такие ошибки себе и обратно не возвращает.
//
// Между результатом и показом стоит один обработчик — преобразование массива.
import type { FormDescription, InvalidFrom } from './describe'
import type { FormError, Outcome } from './result'
import { safeObject } from './types'

export interface ErrorContext {
  /** Как пришёл результат. Свойство результата, а не момента отрисовки. */
  from: 'action' | 'fetch'
  intent: string
  outcome: Outcome
}

/**
 * Проходят ОБА пути. На пути `action` обработчик выполняется на сервере,
 * на пути `fetch` — в браузере, поэтому он обязан быть изоморфным:
 * браузерные вызовы допустимы только под проверкой `ctx.from === 'fetch'`.
 */
export type ErrorHandler = (
  errors: readonly FormError[], ctx: ErrorContext,
) => readonly FormError[]

export interface Shown {
  /** Что показывать: результат обработчика. */
  readonly errors: readonly FormError[]
  /** Сколько ошибок обработчик убрал. Для предупреждения при разработке. */
  readonly removed: number
}

export function applyHandler(
  facts: readonly FormError[], ctx: ErrorContext, handler?: ErrorHandler,
): Shown {
  if (!handler) return { errors: facts, removed: 0 }
  const errors = handler(facts, ctx) ?? []
  return { errors, removed: Math.max(0, facts.length - errors.length) }
}

export interface Split {
  /** Нет пути — общая. «Регистрация отключена», «запись не создана». */
  readonly common: readonly FormError[]
  /** Есть путь — ошибка поля. «Не заполнено», «не более N символов». */
  readonly byField: Readonly<Record<string, readonly FormError[]>>
}

/** Разделение на общие и поля — после обработчика. Других правил нет. */
export function split(errors: readonly FormError[]): Split {
  const common: FormError[] = []
  const byField = safeObject<FormError[]>()
  for (const e of errors) {
    if (!e.path) { common.push(e); continue }
    ;(byField[e.path] ??= []).push(e)
  }
  return { common, byField }
}

/**
 * Откуда берётся «поле невалидно». Побеждает самый узкий уровень:
 * ошибка → поле → форма → библиотека.
 */
export function invalidFromFor(
  name: string, d: FormDescription, libDefault: InvalidFrom = 'fact',
): InvalidFrom {
  return d.byName[name]?.invalidFrom ?? d.invalidFrom ?? libDefault
}

/**
 * Поле знает, что было невалидно, даже если текст забрали.
 * Ошибка с пометкой `silent` подсветки не даёт на любом уровне настройки.
 */
export function hasError(
  name: string,
  facts: readonly FormError[],
  shown: readonly FormError[],
  mode: InvalidFrom,
): boolean {
  const list = mode === 'shown' ? shown : facts
  return list.some((e) => e.path === name && !e.silent)
}
