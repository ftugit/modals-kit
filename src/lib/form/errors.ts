// Показ ошибок. Библиотека знает ровно два места: общие и поля.
//
// Всплывающее уведомление, системное уведомление, сообщение в мессенджер —
// это не её дело: разработчик забирает такие ошибки себе и обратно не возвращает.
//
// Между результатом и показом стоит один обработчик — преобразование массива.
import type { FormDescription, InvalidFrom } from './describe'
import type { FormError, Outcome, Result } from './result'
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

/**
 * Пропустить факты через обработчик: что вернулось — то и показывается.
 * @param facts Ошибки как есть.
 * @param ctx Как пришёл результат и с каким исходом.
 * @param handler Обработчик формы или проекта. Не задан — показ как есть.
 */
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

/**
 * Разделение на общие и поля — после обработчика. Других правил нет.
 * @param errors Ошибки показа.
 */
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
/**
 * Источник подсветки поля: побеждает самый узкий уровень — поле, потом форма.
 * @param name Имя поля.
 * @param d Описание формы.
 * @param libDefault Умолчание библиотеки/проекта.
 * @returns Настройка поля, иначе формы.
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
/**
 * Поле знает, что было невалидно, даже если текст забрали.
 * @param name Имя поля.
 * @param facts Ошибки-факты.
 * @param shown Ошибки показа.
 * @param mode Откуда считать: по факту или по показу.
 * @returns Подсвечивать ли поле. `silent`-ошибка подсветки не даёт.
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

/* ─────────────────────────── приёмник ошибок (Q1) ─────────────────── */

/**
 * Конверт ошибки — нормализованный ВЫХОД lib. `fatal` намеренно нет: форма не
 * знает, чем рисуется страница; 500/консоль решает хост. Тип — структурная
 * копия конвертов соседних lib (общего импорта между lib нет).
 */
export interface LibError {
  readonly lib: 'form'
  readonly code: 'external-error' | 'outcome-unknown' | 'warnings' | (string & {})
  readonly cause: unknown
  readonly ctx?: Record<string, unknown>
}

/** Приёмник: `createConfig({ onError })` или `bind(..., { onError })`. */
export type ErrorSink = (e: LibError) => void

/**
 * Сообщить о применённом результате (Q1). Зовётся СЛЕДОМ за применением —
 * показ не трогает (данные остаются в state как были). Дедуп: один
 * `submissionId` не сообщается дважды (lift и submit применяют один результат).
 * @returns ключ для хранения (предыдущий, если сообщение не потребовалось).
 */
export function notifyResultErrors(
  sink: ErrorSink | undefined,
  result: Result,
  prevNotified?: string,
): string | undefined {
  if (!sink) return prevNotified
  if (result.submissionId === prevNotified) return prevNotified
  const base = {
    formId: result.formId, instance: result.instance,
    outcome: result.outcome, from: result.from,
  }
  for (const e of result.errors) {
    if (e.origin === 'external') {
      sink({ lib: 'form', code: 'external-error', cause: e, ctx: { ...base, path: e.path } })
    }
  }
  if (result.outcome === 'unknown') {
    sink({ lib: 'form', code: 'outcome-unknown', cause: null, ctx: base })
  }
  for (const w of result.warnings ?? []) {
    sink({ lib: 'form', code: 'warnings', cause: w, ctx: base })
  }
  return result.submissionId
}
