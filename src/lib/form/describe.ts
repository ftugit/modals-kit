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
  readonly cardinality?: 'first' | 'all'
  readonly invalidFrom?: InvalidFrom
  readonly fresh?: boolean
}

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

export interface FieldOptions<V = unknown> {
  label?: string
  help?: string
  placeholder?: string
  defaultValue?: V
  secret?: boolean
  validate?: readonly ValidatorRef[]
  options?: readonly (string | Option)[]
  visibleWhen?: VisibilityCondition
  cardinality?: 'first' | 'all'
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

export interface FormDefinition {
  id: FormId
  revision?: Revision
  fields: Record<string, FieldDraft<any>>
  actions?: readonly ActionDescriptor[]
  messages?: Record<string, string>
  cardinality?: 'first' | 'all'
  invalidFrom?: InvalidFrom
  registry?: Registry
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
