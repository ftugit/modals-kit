// Шаги одной формы внутри ОДНОГО POST.
//
// Несколько состояний формы (вход → восстановление → профиль) — одна форма:
// поля общие и живут в DOM от шага к шагу, ничего не переносится скрытыми
// полями. Маркер шага — в АДРЕСЕ ЭКШЕНА (`?step=…`), не в поле: подделка
// маркера ничего не даёт — сервер на каждом шаге проверяет подпись и права.
//
//  • с JS: экшен отвечает обычным `Result`, шаг следующего состояния едет в
//    `Result.data.step`; виджет читает и переключает состояние на месте.
//  • без JS: экшен отвечает `fail(status, { result })` — страница
//    перерисовывается с тем же `result` и ТЕМИ ЖЕ полями (значения остаются
//    в DOM), шаг видит из `form.result.data.step`.
//
// Ограничение (пока потребители не дойдут до ядра): описание формы статично,
// поэтому «обязательное только на шаге N» не поддерживается — правила полей
// работают всегда, когда значение непусто. Обязательность конкретного шага
// решает сам `execute` (не дошло нужное — `ctx.fail` по своему коду).
import type { Result } from './result'

/** Ключ маркера шага в адресе экшена. */
export const STEP_QUERY = 'step'

/** Шаг из адреса экшена: `?step=…` или запас, если маркера нет. */
export function stepOf(request: Request, fallback: string): string {
  const value = new URL(request.url).searchParams.get(STEP_QUERY)
  return value === null || value === '' ? fallback : value
}

/** Адрес экшена с маркером шага: правит только свой ключ, остальное не трогает. */
export function stepAction(action: string, step: string): string {
  const url = new URL(action, 'http://x') // база нужна только для разбора; относительный адрес сохраняется
  url.searchParams.set(STEP_QUERY, step)
  const query = url.searchParams.toString()
  const base = `${url.pathname}${url.hash}`
  return query ? `${base}?${query}` : base
}

/** Данные результата с шагом: то, что `execute` кладёт в `Result.data`. */
export type StepData = { readonly step: string }

/** Пометить данные результата шагом (данные потребителя сохраняются). */
export function withStep<T extends Record<string, unknown>>(data: T | undefined, step: string): T & StepData {
  return { ...(data ?? {}), step } as T & StepData
}

/** Шаг из результата; `undefined` — результат не о шагах. */
export function stepOfResult(result: Result): string | undefined {
  const data = result.data as StepData | undefined
  const step = data?.step
  return typeof step === 'string' && step !== '' ? step : undefined
}
