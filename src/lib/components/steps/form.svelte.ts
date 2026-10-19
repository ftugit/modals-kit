// form × step — «паразит»: склейка одной формы (bound) и хоста шагов.
//
// Одна форма на все шаги; шаги — нарезка отрисовки. Поля свёрнутых шагов НЕ
// вырезаются из DOM (их прячет CSS `FormSteps`) и едут в каждом POST, а
// валидаторы шага включает сам lib/form: у экшена шага — `subset` из его
// полей, у финального экшена подмножества нет (проверяется всё). Переход
// между шагами и отправка — ОДНА кнопка под всеми шагами (`fs.submit()`):
// на проходном шаге её интенция — экшен этого шага (subset-проверка и переход),
// на последнем — финальный экшен (полная проверка, отправка формы).
//
// Режим разбора (провал отправки с ошибками не только на текущем шаге —
// на практике это финальный `save` или серверная-only ошибка): открытыми
// остаются ТОЛЬКО шаги с ошибками (решение владельца — «текущий» ничего не
// значит, пока сервер не вернул ошибку), все прочие свёрнуты в «Отобразить
// шаг N» (`collapsed` — нативный details в FormSteps: раскрытие без JS,
// открытое живёт до отправки). Правило без памяти об интенции (Result её
// не несёт):
//   провал + есть ошибки на ЧУЖИХ шагах  → разбор;
//   провал + показываемых ошибок нет вовсе (только общие/серверные) → разбор:
//   всё свёрнуто, блок общих — единственный сигнал;
//   провал + ошибки только текущего шага → обычный вид (они и так видны).
// Показываемые ошибки чинятся на месте (recheck): показываемых не осталось —
// разбора больше нет, форма вернулась в обычный вид. Повторная отправка
// перезаписывает результат: ошибка ушла — шаг схлопнулся.
import type { FormDescription, FormError, Result } from '#lib/form/index.js'
import type { BoundForm, IntentProps } from '#lib/form/svelte/index.js'
import type { StepsHost } from './steps.svelte.js'

export interface FormStepsOptions {
  /**
   * Шаг → id экшена, который его проверяет и уводит дальше. По умолчанию id
   * экшена равен ключу шага. Финальный экшен (без subset) в карте не участвует.
   */
  actionOf?: (step: string) => string | undefined
  /**
   * Последний шаг (на нём кнопка под шагами отправляет форму). По умолчанию —
   * последний шаг списка. Если после него есть неотправляющий шаг (экран
   * результата), укажите явно.
   */
  last?: string
  /**
   * Id финального экшена — полной отправки. По умолчанию единственный экшен
   * описания без `subset`.
   */
  final?: string
}

/** Вид шага в разметке `FormSteps`. */
export type StepView =
  | 'current'    // обычный режим: текущий шаг хоста
  | 'pinned'     // разбор: на шаге показанные ошибки, сворачивать нельзя
  | 'collapsed'  // свёрт: в DOM есть (значения едут в POST), вида нет до щелчка

export interface FormStepsApi {
  /** Разбор: провал с чужими или только общими ошибками (см. шапку файла). */
  readonly review: boolean
  /** Шаги с показанными ошибками (в разборе — закреплены). */
  readonly errorSteps: readonly string[]
  /** Вид шага. */
  viewOf(step: string): StepView
  /** Шаг поля (по subset'ам экшенов шагов); вложенные пути — по префиксу. */
  stepOfField(path: string): string | undefined
  /**
   * Единственная кнопка ПОД всеми шагами: на проходном шаге её интенция —
   * экшен шага (subset-проверка + переход), на последнем — финальная
   * отправка. Подпись кнопки — `isLast` («Далее» / «Сохранить»).
   */
  submit(): IntentProps
  /** Текущий шаг — последний (кнопка отправляет форму). */
  readonly isLast: boolean
}

/** Карта «путь поля → шаг»: subset экшена каждого шага. Первый шаг выигрывает. */
export function fieldStepMap(
  stepKeys: readonly string[],
  actions: FormDescription['actions'],
  actionOf?: (step: string) => string | undefined,
): Map<string, string> {
  const map = new Map<string, string>()
  for (const key of stepKeys) {
    const id = actionOf?.(key) ?? key
    const a = actions.find((x) => x.id === id)
    for (const p of a?.subset ?? []) if (!map.has(p)) map.set(p, key)
  }
  return map
}

/** Режим разбора (правило — в шапке файла). */
export function isReview(
  result: Result | undefined,
  shown: readonly FormError[],
  map: ReadonlyMap<string, string>,
  currentKey: string | null,
): boolean {
  if (!result || result.ok || result.errors.length === 0) return false
  const steps = new Set<string>()
  for (const e of shown) {
    if (!e.path) continue
    const hit = map.get(e.path)
    if (hit) { steps.add(hit); continue }
    for (const [p, s] of map) if (e.path.startsWith(`${p}.`)) { steps.add(s); break }
  }
  if (steps.size === 0) return shown.length > 0
  return [...steps].some((s) => s !== currentKey)
}

/**
 * Паразит форм-режима: `const fs = formSteps(bound, steps)`. Состояние формы и
 * шагов не трогает — только читает и ведёт список «раскрыто юзером».
 */
export function formSteps(bound: BoundForm, host: StepsHost, o: FormStepsOptions = {}): FormStepsApi {
  const actionId = (step: string): string => o.actionOf?.(step) ?? step
  const keys = $derived(host.items.map((s) => s.key))
  const map = $derived(fieldStepMap(keys, bound.description.actions, o.actionOf))
  // последний шаг и финальный экшен: умолчания выводятся из описания
  const lastKey = $derived(o.last ?? keys[keys.length - 1] ?? '')
  const finalId = $derived.by(() => {
    if (o.final) return o.final
    const full = bound.description.actions.filter((a) => !a.subset?.length)
    return full.length === 1 ? full[0]!.id : undefined
  })

  const errorSteps = $derived.by(() => {
    const out = new Set<string>()
    for (const e of bound.state.shown) {
      if (!e.path) continue
      const s = stepOfField(e.path)
      if (s) out.add(s)
    }
    return [...out]
  })

  const review = $derived(isReview(bound.state.result, bound.state.shown, map, host.currentKey))

  function stepOfField(path: string): string | undefined {
    if (map.has(path)) return map.get(path)
    for (const [p, s] of map) if (path.startsWith(`${p}.`)) return s
    return undefined
  }

  function viewOf(step: string): StepView {
    // разбор: открыты только шаги с ошибками; обычный режим: только текущий
    if (review) return errorSteps.includes(step) ? 'pinned' : 'collapsed'
    return host.currentKey === step ? 'current' : 'collapsed'
  }

  return {
    get review() { return review },
    get errorSteps() { return errorSteps },
    viewOf,
    stepOfField,
    submit: () => {
      const k = host.currentKey ?? ''
      // на последнем шаге кнопка — отправка формы (финальный экшен);
      // финальный не выведен — действует экшен текущего шага
      return bound.intent(k !== '' && k === lastKey && finalId ? finalId : actionId(k))
    },
    get isLast() {
      return keys.length > 0 && (host.currentKey ?? '') === lastKey
    },
  }
}
