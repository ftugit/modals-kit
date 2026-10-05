// Объявление формы. Изоморфно: модуль импортируют и страница, и сервер.
import { BOUND_PAIRS, boundValue, type Constraint, type ConstraintKind } from './constraints'
import { applies, projectAttrs, type ProjectedAttrs } from './field-types'
import { defaultPolicy, nameProblem, type FormPolicy } from './policy'
import { createRegistry, defaultRegistry, type Registry } from './registry'
import { safeObject, type FieldPath, type FormId, type InputMode, type Revision, type ValueKind } from './types'
import { constraintsOf, type ValidatorRef } from './validators'

export interface Option { value: string; label: string; disabled?: boolean }

export type VisibilityCondition =
  | { field: FieldPath; equals: string | number | boolean | null }
  | { field: FieldPath; notEquals: string | number | boolean | null }
  | { all: readonly VisibilityCondition[] }
  | { any: readonly VisibilityCondition[] }
  | { not: VisibilityCondition }

/** Откуда берётся «поле невалидно»: по факту ошибки или по тому, что показано. */
export type InvalidFrom = 'fact' | 'shown'

export interface FieldDescriptor<V = unknown> {
  /** Имя-путь: сегменты через точку, ключ строки — не индекс. */
  readonly name: string
  /** Тип значения: решает разбор и проекцию ограничений. */
  readonly kind: ValueKind
  /** Представление в разметке: `text`, `number`, `select`… */
  readonly input: InputMode
  /** Позиция в порядке объявления. Производное, назначает `defineForm`. */
  readonly order: number
  /** Подпись для человека. */
  readonly label?: string
  /** Постоянная подсказка под полем. */
  readonly help?: string
  readonly placeholder?: string
  /** Значение до первого ввода. */
  readonly defaultValue?: V
  /** Не возвращается наружу: пароль в разметку не едет. */
  readonly secret?: boolean
  /** Правила проверки: функции или сериализуемые ссылки `{ name, arg }`. */
  readonly validators: readonly ValidatorRef[]
  /** Варианты для `select`/`radio`/`multiselect`. */
  readonly options?: readonly Option[]
  /** Условие видимости — данные: сервер считает его без скрипта. */
  readonly visibleWhen?: VisibilityCondition
  /** Сколько ошибок на поле: первая или все. Перебивает форму. */
  readonly cardinality?: 'first' | 'all'
  /** Источник подсветки этого поля: по факту или по показу. */
  readonly invalidFrom?: InvalidFrom
  /** Создано в этом круге: обязательность в первом круге не навязывается. */
  readonly fresh?: boolean
}

/**
 * Кнопка формы. Намерение `action[:arg]` из конверта выбирает действие.
 */
export interface ActionDescriptor {
  /** Идентификатор в намерении: `submit`, `save-draft`, `add-row`. */
  readonly id: string
  /** Подпись кнопки для приложения. */
  readonly label?: string
  /**
   * Объём проверки: `full` — все правила, `partial` — без снятых видов,
   * `none` — без проверки (операции над набором полей).
   */
  readonly validate: 'full' | 'partial' | 'none'
  /** Виды ограничений, снятые действием: черновик снимает обязательность. */
  readonly relax?: readonly ConstraintKind[]
  /** Проверять только эти поля. */
  readonly subset?: readonly FieldPath[]
  /** Побочный эффект действия: изменение схемы или отправка. */
  readonly sideEffect?: 'mutate-schema' | 'submit' | 'none'
}

/* ── дефекты описания ──────────────────────────────────────────────── */

export type DefectCode =
  | 'constraint.not-applicable' | 'constraint.conflict' | 'constraint.unreachable'
  | 'constraint.duplicate' | 'spec.name-invalid' | 'spec.limit' | 'spec.unknown-kind'
  | 'spec.pattern-unsafe'

export interface FieldDefect {
  code: DefectCode
  severity: 'error' | 'warn'
  at: string
  message: string
}

const defect = (code: DefectCode, at: string, message: string,
                severity: FieldDefect['severity'] = 'error'): FieldDefect =>
  ({ code, severity, at, message })

export class FormDefinitionError extends Error {
  constructor(readonly defects: readonly FieldDefect[], formId: string) {
    super(`[form] форма '${formId}' не объявлена:\n` +
      defects.map((d) => `  [${d.severity}] ${d.code} @ ${d.at}: ${d.message}`).join('\n'))
    this.name = 'FormDefinitionError'
  }
}

/* ── сахар field.* ─────────────────────────────────────────────────── */

/** Опции сахара `field.*`: всё, кроме правил, — метаданные поля. */
export interface FieldOptions<V = unknown> {
  /** Подпись для человека. */
  label?: string
  /** Постоянная подсказка под полем. */
  help?: string
  placeholder?: string
  /** Значение до первого ввода. */
  defaultValue?: V
  /** Не возвращать значение наружу. У `password` — умолчание. */
  secret?: boolean
  /** Правила проверки. */
  validate?: readonly ValidatorRef[]
  /** Варианты: строка превращается в `{ value, label }`. */
  options?: readonly (string | Option)[]
  /** Условие видимости. */
  visibleWhen?: VisibilityCondition
  /** Сколько ошибок на поле: первая или все. */
  cardinality?: 'first' | 'all'
  /** Источник подсветки поля. */
  invalidFrom?: InvalidFrom
  /** Тип значения, если представление обслуживают несколько типов. */
  kind?: ValueKind
}

export type FieldDraft<V = unknown> = Omit<FieldDescriptor<V>, 'name' | 'order'>

/**
 * Сахар — Proxy, а не кодогенерация. Тип значения ищется в реестре по
 * представлению, поэтому `field.rating(...)` работает сразу после регистрации
 * своего типа — без правки библиотеки.
 */
export function makeFieldSugar(registry: Registry = defaultRegistry) {
  return new Proxy({} as Record<string, <V>(o?: FieldOptions<V>) => FieldDraft<V>>, {
    get: (_t, input: string) => (o: FieldOptions = {}) => {
      const kind = o.kind ?? registry.types.byInput(input)?.kind
      if (!kind)
        throw new Error(
          `[form] представление '${input}' не обслуживается ни одним типом. ` +
          'Зарегистрируйте тип или укажите kind явно.')
      return {
        kind, input,
        label: o.label, help: o.help, placeholder: o.placeholder, defaultValue: o.defaultValue,
        // пароль не возвращается наружу: возврат пароля в разметку — типовая дыра
        secret: o.secret ?? input === 'password',
        validators: o.validate ?? [],
        options: o.options?.map((x) => (typeof x === 'string' ? { value: x, label: x } : x)),
        visibleWhen: o.visibleWhen,
        cardinality: o.cardinality,
        invalidFrom: o.invalidFrom,
      } as FieldDraft
    },
  })
}

export const field = makeFieldSugar()

/* ── мета-валидация ────────────────────────────────────────────────── */

/**
 * Мета-валидация одного поля: имена, пределы, применимость видов,
 * противоречия и дубли границ.
 * @param f Готовый дескриптор.
 * @param registry Реестр типов и правил.
 * @param policy Политика имён и пределов.
 * @returns Дефекты: `error` рушит `defineForm`, `warn` — только отчёт.
 */
export function checkFieldDefinition(
  f: FieldDescriptor,
  registry: Registry = defaultRegistry,
  policy: FormPolicy = defaultPolicy,
): FieldDefect[] {
  const out: FieldDefect[] = []
  const { types, validators } = registry
  const limits = policy.limits

  const np = nameProblem(f.name, policy.names)
  if (np === 'forbidden') out.push(defect('spec.name-invalid', f.name, `имя '${f.name}' зарезервировано`))
  else if (np === 'format')
    out.push(defect('spec.name-invalid', f.name,
      `имя '${f.name}': каждый сегмент обязан совпасть с ${policy.names.pattern}`))

  if (!types.has(f.kind)) {
    out.push(defect('spec.unknown-kind', f.name, `тип значения '${f.kind}' не зарегистрирован`))
    return out
  }
  const type = types.get(f.kind)
  const constraints = constraintsOf(f.validators, validators)

  if (constraints.length > limits.constraintsPerField)
    out.push(defect('spec.limit', f.name, `ограничений ${constraints.length}, предел ${limits.constraintsPerField}`))
  if (f.label && f.label.length > limits.labelLength)
    out.push(defect('spec.limit', `${f.name}.label`, 'подпись слишком длинная'))
  if (f.options && f.options.length > limits.options)
    out.push(defect('spec.limit', `${f.name}.options`, 'вариантов слишком много'))

  // применимость спрашивается у ТИПА, центральной матрицы нет
  constraints.forEach((c, i) => {
    if (!applies(type, c.kind))
      out.push(defect('constraint.not-applicable', `${f.name}.constraints[${i}]`,
        `вид ограничения '${c.kind}' неприменим к типу значения '${f.kind}'`))
  })

  const byKind = new Map<ConstraintKind, Constraint[]>()
  for (const c of constraints) byKind.set(c.kind, [...(byKind.get(c.kind) ?? []), c])

  for (const [lo, hi] of BOUND_PAIRS) {
    const a = byKind.get(lo)?.[0], b = byKind.get(hi)?.[0]
    if (!a || !b) continue
    const av = boundValue(a), bv = boundValue(b)
    if (av !== undefined && bv !== undefined && av > bv)
      out.push(defect('constraint.conflict', f.name,
        `${lo}(${av}) больше ${hi}(${bv}) — ни одно значение не пройдёт`))
  }

  for (const [kind, list] of byKind) {
    if (kind === 'opaque' || list.length < 2) continue
    const values = new Set(list.map(boundValue))
    if (values.size > 1)
      out.push(defect('constraint.duplicate', f.name,
        `вид '${kind}' задан дважды с разными значениями`))
  }

  if (byKind.has('required') && f.options && f.options.length === 0)
    out.push(defect('constraint.unreachable', f.name, 'обязательность при пустом списке вариантов недостижима'))

  return out
}

/* ── объявление формы ──────────────────────────────────────────────── */

/** Вход `defineForm`: черновик, из которого собирается описание. */
export interface FormDefinition {
  /** Идентификатор формы. */
  id: FormId
  /** Версия набора полей: смена набора — новая ревизия. */
  revision?: Revision
  /** Черновики полей по имени. */
  fields: Record<string, FieldDraft<any>>
  /** Кнопки. Умолчание — один `submit`. */
  actions?: readonly ActionDescriptor[]
  /** Тексты поверх словаря: код → шаблон. */
  messages?: Record<string, string>
  /** Сколько ошибок на поле по всей форме. */
  cardinality?: 'first' | 'all'
  /** Источник подсветки по всей форме. */
  invalidFrom?: InvalidFrom
  /** Свои реестры типов и правил. Умолчание — общие. */
  registry?: Registry
  /** Своя политика имён, пределов и ключей конверта. */
  policy?: FormPolicy
}

export interface FormDescription {
  readonly id: FormId
  readonly revision: Revision
  readonly fields: readonly FieldDescriptor[]
  readonly byName: Readonly<Record<string, FieldDescriptor>>
  readonly actions: readonly ActionDescriptor[]
  readonly messages: Readonly<Record<string, string>>
  readonly cardinality: 'first' | 'all'
  readonly invalidFrom: InvalidFrom
  readonly defects: readonly FieldDefect[]
  readonly registry: Registry
  readonly policy: FormPolicy
  /** Атрибуты считает ядро: примитив получает готовый набор, а не правила. */
  attrsOf(name: string): ProjectedAttrs
  /** Ограничения поля — для отчёта. */
  constraintsOf(name: string): readonly Constraint[]
}

const DEFAULT_ACTIONS: readonly ActionDescriptor[] = [
  { id: 'submit', validate: 'full', sideEffect: 'submit' },
]

/**
 * Собрать описание формы из черновика: назначает имена и порядок,
 * мета-валидирует каждое поле и кэширует проекцию атрибутов.
 * @param def Черновик объявления.
 * @returns Неизменяемое описание.
 * @throws {FormDefinitionError} Найден дефект уровня `error`.
 */
export function defineForm(def: FormDefinition): FormDescription {
  const registry = def.registry ?? defaultRegistry
  const policy = def.policy ?? defaultPolicy
  const names = Object.keys(def.fields)
  const defects: FieldDefect[] = []

  if (names.length > policy.limits.fields)
    defects.push(defect('spec.limit', def.id, `полей ${names.length}, предел ${policy.limits.fields}`))

  const fields: FieldDescriptor[] = names.map((name, order) =>
    ({ ...def.fields[name]!, name, order }) as FieldDescriptor)

  for (const f of fields) defects.push(...checkFieldDefinition(f, registry, policy))
  if (defects.some((d) => d.severity === 'error')) throw new FormDefinitionError(defects, def.id)

  const byName = safeObject<FieldDescriptor>()
  for (const f of fields) byName[f.name] = f
  const attrCache = new Map<string, ProjectedAttrs>()
  const constraintCache = new Map<string, readonly Constraint[]>()

  const constraintsFor = (name: string) => {
    const hit = constraintCache.get(name)
    if (hit) return hit
    const f = byName[name]
    if (!f) throw new Error(`[form] поле не объявлено: ${name}`)
    const list = constraintsOf(f.validators, registry.validators)
    constraintCache.set(name, list)
    return list
  }

  return {
    id: def.id,
    revision: def.revision ?? 1,
    fields, byName,
    actions: def.actions ?? DEFAULT_ACTIONS,
    messages: def.messages ?? {},
    cardinality: def.cardinality ?? 'first',
    invalidFrom: def.invalidFrom ?? 'fact',
    defects, registry, policy,
    constraintsOf: constraintsFor,
    attrsOf(name) {
      const hit = attrCache.get(name)
      if (hit) return hit
      const f = byName[name]!
      const projected = projectAttrs(registry.types.get(f.kind), constraintsFor(name),
                                     { input: f.input, name })
      if (f.placeholder) projected.attrs['placeholder'] = f.placeholder
      attrCache.set(name, projected)
      return projected
    },
  }
}

export { createRegistry, defaultRegistry }
export type { Registry }
