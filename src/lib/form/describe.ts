// Объявление формы. Изоморфно: модуль импортируют и страница, и сервер.
import { BOUND_PAIRS, boundValue, type Constraint, type ConstraintKind } from './constraints'
import { applies, projectAttrs, type ProjectedAttrs } from './field-types'
import { defaultPolicy, nameProblem, type FormPolicy } from './policy'
import { createRegistry, defaultRegistry, type Registry } from './registry'
import { safeObject, type FieldPath, type FormId, type InputMode, type Revision, type ValueKind } from './types'
import { constraintsOf, type ValidatorRef } from './validators'

/** Один вариант выбора для select/radio-like поля. */
export interface Option { value: string; label: string; disabled?: boolean }

/** Декларативное условие видимости поля. */
export type VisibilityCondition =
  | { field: FieldPath; equals: string | number | boolean | null }
  | { field: FieldPath; notEquals: string | number | boolean | null }
  | { all: readonly VisibilityCondition[] }
  | { any: readonly VisibilityCondition[] }
  | { not: VisibilityCondition }

/** Откуда берётся «поле невалидно»: по факту ошибки или по тому, что показано. */
export type InvalidFrom = 'fact' | 'shown'

/** Полное описание поля после defineForm: имя, тип, представление и правила. */
export interface FieldDescriptor<V = unknown> {
  readonly name: string
  readonly kind: ValueKind
  readonly input: InputMode
  readonly order: number
  readonly label?: string
  readonly help?: string
  readonly placeholder?: string
  readonly defaultValue?: V
  readonly secret?: boolean
  readonly validators: readonly ValidatorRef[]
  readonly options?: readonly Option[]
  readonly visibleWhen?: VisibilityCondition
  /**
   * Решение связочного слоя: поле выключено — видно, но недоступно.
   * Ядро только несёт это до компонента; кто выключил — вопрос слоя.
   */
  readonly disabled?: boolean
  /** Причина показывается в слоте helper вместо help; бывает только у выключенного поля. */
  readonly reason?: string
  readonly cardinality?: 'first' | 'all'
  readonly invalidFrom?: InvalidFrom
  readonly fresh?: boolean
}

/** Описание submit-намерения формы. */
export interface ActionDescriptor {
  readonly id: string
  readonly label?: string
  readonly validate: 'full' | 'partial' | 'none'
  /** Виды ограничений, снятые действием: черновик снимает обязательность. */
  readonly relax?: readonly ConstraintKind[]
  readonly subset?: readonly FieldPath[]
  readonly sideEffect?: 'mutate-schema' | 'submit' | 'none'
}

/* ── дефекты описания ──────────────────────────────────────────────── */

export type DefectCode =
  | 'constraint.not-applicable' | 'constraint.conflict' | 'constraint.unreachable'
  | 'constraint.duplicate' | 'spec.name-invalid' | 'spec.limit' | 'spec.unknown-kind'
  | 'spec.pattern-unsafe' | 'spec.validator-invalid'

/** Один дефект описания формы, найденный мета-валидацией. */
export interface FieldDefect {
  code: DefectCode
  severity: 'error' | 'warn'
  at: string
  message: string
}

const defect = (code: DefectCode, at: string, message: string,
                severity: FieldDefect['severity'] = 'error'): FieldDefect =>
  ({ code, severity, at, message })

/** Ошибка объявления формы с полным списком дефектов. */
export class FormDefinitionError extends Error {
  constructor(readonly defects: readonly FieldDefect[], formId: string) {
    super(`[form] форма '${formId}' не объявлена:\n` +
      defects.map((d) => `  [${d.severity}] ${d.code} @ ${d.at}: ${d.message}`).join('\n'))
    this.name = 'FormDefinitionError'
  }
}

/* ── сахар field.* ─────────────────────────────────────────────────── */

export interface FieldOptions<V = unknown> {
  /** Текст подписи поля. Адаптер обычно рендерит его в `<label>`. */
  label?: string
  /** Подсказка поля. Адаптер должен включить её id в `aria-describedby`. */
  help?: string
  /** Placeholder для нативного поля, если представление его поддерживает. */
  placeholder?: string
  /** Начальное значение поля до ввода пользователя. */
  defaultValue?: V
  /** Не возвращать значение в публичном `Result.values`; полезно для паролей и токенов. */
  secret?: boolean
  /** Валидаторы поля: функции или сериализуемые ссылки на реестр. */
  validate?: readonly ValidatorRef[]
  /** Варианты выбора. Строка превращается в `{ value, label }`. */
  options?: readonly (string | Option)[]
  /** Условие, при котором поле участвует в показе и обычной валидации. */
  visibleWhen?: VisibilityCondition
  /**
   * Поле выключено (видно, но недоступно); `reason` — почему, показывается
   * в helper-слоте вместо `help`. Решение считает связочный слой, ядро несёт.
   */
  disabled?: boolean
  reason?: string
  /** Переопределение режима «первая ошибка» / «все ошибки» на уровне поля. */
  cardinality?: 'first' | 'all'
  /** Переопределение источника `aria-invalid` на уровне поля. */
  invalidFrom?: InvalidFrom
  /** Тип значения, если одно input-представление обслуживают несколько типов. */
  kind?: ValueKind
}

/** Черновик поля до присвоения имени и порядка. */
export type FieldDraft<V = unknown> = Omit<FieldDescriptor<V>, 'name' | 'order'>

/**
 * Сахар — Proxy, а не кодогенерация. Тип значения ищется в реестре по
 * представлению, поэтому `field.customInput(...)` работает сразу после регистрации
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
        disabled: o.disabled,
        // Инвариант контракта: причина бывает только у выключенного поля —
        // иначе helper-узел (и aria-describedby на него) обещан, но пуст.
        reason: o.disabled ? o.reason : undefined,
        cardinality: o.cardinality,
        invalidFrom: o.invalidFrom,
      } as FieldDraft
    },
  })
}

/** field.* на defaultRegistry для краткого описания встроенных полей. */
export const field = makeFieldSugar()

/** Решение связочного слоя об одном поле — канал `fieldState` в опциях bind. */
export interface FieldLink {
  readonly disabled?: boolean
  readonly reason?: string
}

/**
 * Наложение решения связки на статическое объявление: если связка про поле
 * что-то сказала — её ответ перекрывает дескриптор (включая разблокировку);
 * молчит — как объявлено. Инвариант `reason` только при `disabled`
 * обеспечивается здесь, а не в трёх адаптерах.
 */
export function fieldLinkState(
  d: FieldDescriptor<any>,
  link: FieldLink | undefined,
): FieldLink {
  const s = link ?? d
  return s.disabled ? { disabled: true, reason: s.reason } : {}
}

/* ── мета-валидация ────────────────────────────────────────────────── */

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
  for (const [i, ref] of f.validators.entries()) {
    try { validators.resolve(ref) } catch (e) {
      const label = typeof ref === 'function' ? `#${i}` : ref.name
      out.push(defect('spec.validator-invalid', `${f.name}.validators[${i}]`,
        `валидатор '${label}' не разрешён: ${e instanceof Error ? e.message : String(e)}`))
    }
  }
  const constraints = constraintsOf(f.validators, validators)

  if (constraints.length > limits.constraintsPerField)
    out.push(defect('spec.limit', f.name, `ограничений ${constraints.length}, предел ${limits.constraintsPerField}`))
  if (f.label && f.label.length > limits.labelLength)
    out.push(defect('spec.limit', `${f.name}.label`, 'подпись слишком длинная'))
  if (f.help && f.help.length > limits.helpLength)
    out.push(defect('spec.limit', `${f.name}.help`, 'подсказка слишком длинная'))
  if (f.options && f.options.length > limits.options)
    out.push(defect('spec.limit', `${f.name}.options`, 'вариантов слишком много'))

  // применимость спрашивается у ТИПА, центральной матрицы нет
  constraints.forEach((c, i) => {
    if (c.kind === 'pattern') {
      const source = (c as { source?: unknown }).source
      if (typeof source === 'string' && source.length > limits.patternLength)
        out.push(defect('spec.pattern-unsafe', `${f.name}.constraints[${i}]`, 'шаблон длиннее предела'))
    }
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

export interface FormDefinition {
  /** Стабильный id формы: входит в envelope, Result и имена DOM id. */
  id: FormId
  /** Ревизия описания. Повышайте при несовместимом изменении набора полей. */
  revision?: Revision
  /** Словарь `имя поля → черновик поля`; имя станет `FieldDescriptor.name`. */
  fields: Record<string, FieldDraft<any>>
  /** Список submit-намерений. Если не задан, создаётся `submit/full`. */
  actions?: readonly ActionDescriptor[]
  /** Сообщения формы поверх словаря приложения и встроенного словаря. */
  messages?: Record<string, string>
  /** Режим ошибки по умолчанию для полей формы. */
  cardinality?: 'first' | 'all'
  /** Источник невалидности по умолчанию: факты или только показанные ошибки. */
  invalidFrom?: InvalidFrom
  /** Изолированный реестр типов/валидаторов/инструкций для этой формы. */
  registry?: Registry
  /** Политика имён, лимитов, envelope и intent для этой формы. */
  policy?: FormPolicy
}

/** Нормализованное и проверенное описание формы, используемое клиентом и сервером. */
export interface FormDescription {
  /** Стабильный id формы. */
  readonly id: FormId
  /** Ревизия нормализованного описания. */
  readonly revision: Revision
  /** Поля в порядке объявления. */
  readonly fields: readonly FieldDescriptor[]
  /** Быстрый доступ к полю по имени. */
  readonly byName: Readonly<Record<string, FieldDescriptor>>
  /** Доступные submit-намерения. */
  readonly actions: readonly ActionDescriptor[]
  /** Словарь сообщений, заданный на форме. */
  readonly messages: Readonly<Record<string, string>>
  /** Режим количества ошибок по умолчанию. */
  readonly cardinality: 'first' | 'all'
  /** Источник невалидности по умолчанию. */
  readonly invalidFrom: InvalidFrom
  /** Предупреждения описания; ошибки не допускаются до создания FormDescription. */
  readonly defects: readonly FieldDefect[]
  /** Реестр, которым была собрана форма. */
  readonly registry: Registry
  /** Политика, которой была собрана форма. */
  readonly policy: FormPolicy
  /** Атрибуты считает ядро: примитив получает готовый набор, а не правила. */
  attrsOf(name: string): ProjectedAttrs
  /** Ограничения поля — для отчёта, devtools и диагностики. */
  constraintsOf(name: string): readonly Constraint[]
}

const DEFAULT_ACTIONS: readonly ActionDescriptor[] = [
  { id: 'submit', validate: 'full', sideEffect: 'submit' },
]

/** Проверяет и компилирует FormDefinition в FormDescription. */
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
      const constraints = constraintsFor(name)
      const projected = projectAttrs(registry.types.get(f.kind), constraints,
                                     { input: f.input, name, constraints, attrs: {} })
      if (f.placeholder) projected.attrs['placeholder'] = f.placeholder
      attrCache.set(name, projected)
      return projected
    },
  }
}

export { createRegistry, defaultRegistry }
export type { Registry }
