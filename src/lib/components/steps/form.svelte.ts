// form × step: срезы ОДНОЙ формы. formSteps самостоятелен: срезы объявлены
// его опциями (тип объявления импортируется из обычного steps), текущий
// срез — его собственное состояние, адрес он не трогает — адрес пишет только
// хост. Опционально подключается к хосту кустом на его шаге (`at` + `host`):
// тогда срез читается из остатка полного ключа хоста, а переходы formSteps
// просит у хоста полным ключом; без хоста всё работает так же.
//
// Одна форма на все срезы; срезы — нарезка отрисовки. Поля свёрнутых срезов
// НЕ вырезаются из DOM (их прячет CSS `FormSteps`) и едут в каждом POST, а
// валидаторы среза включает сам lib/form: у экшена среза — `subset` из его
// полей, у финального экшена подмножества нет (проверяется всё). Переход
// между срезами и отправка — ОДНА кнопка под всеми срезами (`fs.submit()`):
// на проходном срезе её интенция — экшен среза (subset-проверка и переход),
// на последнем — финальный экшен (полная проверка, отправка формы).
//
// Шаг едет ВНУТРИ формы, отдельного поля под него не заводят: отправленный
// срез назван интентом конверта (техническое поле самого lib/form),
// результат несёт его обратно (`Result.intent`), и formSteps выводит
// отправленный срез по subset-карте — одинаково с JS и без (no-JS:
// результат-продолжение привязки). Следующий срез при успехе называет
// сервер в `Result.data.step` (решение приложения); ключ не из своих
// срезов formSteps не трогает.
//
// Режим разбора (провал отправки с ошибками не только на текущем шаге —
// на практике это финальный `save` или серверная-only ошибка): открытыми
// остаются ТОЛЬКО шаги с ошибками (решение владельца — «текущий» ничего не
// значит, пока сервер не вернул ошибку), все прочие свёрнуты в «Отобразить
// шаг N» (`collapsed` — нативный details в FormSteps: раскрытие без JS,
// открытое живёт до отправки). Правило смотрит только на ошибки показа и
// текущий срез:
//   провал + есть ошибки на ЧУЖИХ шагах  → разбор;
//   провал + показываемых ошибок нет вовсе (только общие/серверные) → разбор:
//   всё свёрнуто, блок общих — единственный сигнал;
//   провал + ошибки только текущего шага → обычный вид (они и так видны).
// Показываемые ошибки чинятся на месте (recheck): показываемых не осталось —
// разбора больше нет, форма вернулась в обычный вид. Повторная отправка
// перезаписывает результат: ошибка ушла — шаг схлопнулся.
import type { FormDescription, FormError, Result } from '#lib/form/index.js'
import type { BoundForm, IntentProps } from '#lib/form/svelte/index.js'
import type { StepDef } from './steps.svelte.js'
import { suffixOf } from './keys.js'

export interface FormStepsOptions {
  /** Срезы формы: ключи и подписи (объявление — как у обычного steps). */
  steps: readonly StepDef[]
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
  /**
   * Начальный шаг, если результат-продолжение привязки его не назвал.
   * По умолчанию — первый шаг списка.
   */
  initial?: string
  /**
   * Подключение кустом к хосту шагов: сегмент шага хоста, на котором живёт
   * форма; полный ключ среза — `${at}.${срез}`. formSteps читает текущий
   * срез из остатка полного ключа хоста (deep-link, навигация), а когда
   * результат называет следующий срез — просит хост переключить полный
   * ключ (только пока хост внутри этого куста). Работает парой с `host`.
   */
  at?: string
  /**
   * Хост шагов узко: полный ключ и переключение (`StepsHost` подходит как
   * есть). Имеет смысл только вместе с `at`; адрес пишет сам хост.
   */
  host?: { readonly fullKey: string | null; set(stepKey: string): void }
}

/** Вид шага в разметке `FormSteps`. */
export type StepView =
  | 'current'    // обычный режим: текущий срез
  | 'pinned'     // разбор: на шаге показанные ошибки, сворачивать нельзя
  | 'collapsed'  // свёрт: в DOM есть (значения едут в POST), вида нет до щелчка

export interface FormStepsApi {
  /** Срезы в порядке объявления: по ним `FormSteps` рисует панели. */
  readonly steps: readonly StepDef[]
  /** Текущий срез. */
  readonly current: string
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
 * Шаг, который называет результат отправки. При успехе следующий шаг
 * называет сервер в `data.step` (берётся, только если это свой шаг — своим
 * ключом или, при `at`, полным ключом куста; чужой ключ — не дело
 * formSteps). Иначе — отправленный шаг: `Result.intent` →
 * экшен → шаг, чья интенция этот экшен; кнопка финального экшена стоит на
 * последнем шаге. Ничего не названо — `undefined` (шаг не меняется).
 */
export function stepOfResult(
  result: Result | undefined,
  stepKeys: readonly string[],
  o: {
    /** Шаг → id экшена (как `FormStepsOptions.actionOf`). */
    actionOf?: (step: string) => string | undefined
    /** Сегмент куста на хосте: `data.step` принимается и полным ключом (`auth.restore`). */
    at?: string
    /** Id финального экшена; его кнопка стоит на `last`. */
    final?: string
    /** Шаг финальной кнопки. */
    last?: string
    /** Интент конверта → id экшена (политика описания формы). */
    parseAction: (intent: string) => string
  },
): string | undefined {
  if (!result) return undefined
  if (result.ok) {
    const d = result.data as { step?: unknown } | undefined
    if (typeof d?.step === 'string') {
      if (stepKeys.includes(d.step)) return d.step
      // куст: сервер мог назвать срез полным ключом цепочки
      const inner = o.at ? suffixOf(d.step, o.at) : null
      if (inner && stepKeys.includes(inner)) return inner
    }
  }
  if (!result.intent) return undefined
  const action = o.parseAction(result.intent)
  const own = stepKeys.find((k) => (o.actionOf?.(k) ?? k) === action)
  if (own) return own
  if (o.final !== undefined && action === o.final) return o.last
  return undefined
}

/**
 * Срезы одной формы: `const fs = formSteps(bound, { steps })`. Состояние
 * формы не трогает — только читает. Текущий срез ведёт сам: начальный — из
 * результата-продолжения привязки (в кусте — иначе из полного ключа хоста),
 * дальше — по каждому новому результату (`stepOfResult`) и, в кусте, по
 * полному ключу хоста.
 */
export function formSteps(bound: BoundForm, o: FormStepsOptions): FormStepsApi {
  const actionId = (step: string): string => o.actionOf?.(step) ?? step
  const keys = o.steps.map((s) => s.key)
  const map = fieldStepMap(keys, bound.description.actions, o.actionOf)
  // последний шаг и финальный экшен: умолчания выводятся из описания
  const lastKey = o.last ?? keys[keys.length - 1] ?? ''
  const finalId = ((): string | undefined => {
    if (o.final) return o.final
    const full = bound.description.actions.filter((a) => !a.subset?.length)
    return full.length === 1 ? full[0]!.id : undefined
  })()
  // куст на шаге хоста: пара at+host; по отдельности опций нет
  const bush = o.at && o.host ? { at: o.at, host: o.host } : undefined
  /** Свой срез из остатка полного ключа хоста; вне куста или чужой остаток — нет. */
  const fromHost = (): string | undefined => {
    if (!bush) return undefined
    const s = suffixOf(bush.host.fullKey, bush.at)
    return s && keys.includes(s) ? s : undefined
  }
  const named = (r: Result | undefined): string | undefined =>
    stepOfResult(r, keys, {
      actionOf: o.actionOf, at: bush?.at, final: finalId, last: lastKey || undefined,
      parseAction: (intent) => bound.description.policy.intent.parse(intent).action,
    })

  let current = $state(named(bound.state.result) ?? fromHost() ?? o.initial ?? keys[0] ?? '')
  // каждый НОВЫЙ результат ведёт срез; уже учтённый (продолжение) — нет.
  // Куст: хост внутри куста — переключить его полным ключом (адрес пишет хост).
  let seen = bound.state.result
  $effect(() => {
    const r = bound.state.result
    if (r === seen) return
    seen = r
    const s = named(r)
    if (!s) return
    current = s
    if (bush && suffixOf(bush.host.fullKey, bush.at) !== null) {
      const full = `${bush.at}.${s}`
      if (bush.host.fullKey !== full) bush.host.set(full)
    }
  })
  // хост ведёт срез снаружи: deep-link, назад/вперёд, смена страницей
  $effect(() => {
    const s = fromHost()
    if (s && s !== current) current = s
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

  const review = $derived(isReview(bound.state.result, bound.state.shown, map, current))

  function stepOfField(path: string): string | undefined {
    if (map.has(path)) return map.get(path)
    for (const [p, s] of map) if (path.startsWith(`${p}.`)) return s
    return undefined
  }

  function viewOf(step: string): StepView {
    // разбор: открыты только шаги с ошибками; обычный режим: только текущий
    if (review) return errorSteps.includes(step) ? 'pinned' : 'collapsed'
    return current === step ? 'current' : 'collapsed'
  }

  return {
    steps: o.steps,
    get current() { return current },
    get review() { return review },
    get errorSteps() { return errorSteps },
    viewOf,
    stepOfField,
    submit: () => {
      // на последнем шаге кнопка — отправка формы (финальный экшен);
      // финальный не выведен — действует экшен текущего шага
      return bound.intent(current !== '' && current === lastKey && finalId ? finalId : actionId(current))
    },
    get isLast() {
      return keys.length > 0 && current === lastKey
    },
  }
}
