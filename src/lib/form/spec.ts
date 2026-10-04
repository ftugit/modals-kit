// Поля, создаваемые пользователем в рантайме.
//
// Спецификация полностью сериализуема: валидаторы — ДАННЫЕ, функции
// запрещены на уровне типа. Иначе поле из рантайма исполняло бы чужой код.
import type { FieldDescriptor, FieldDefect, Option, VisibilityCondition } from './describe'
import { checkFieldDefinition } from './describe'
import { defaultPolicy, nameProblem, type FormPolicy } from './policy'
import { defaultRegistry, type Registry } from './registry'
import type { InputMode, ValueKind } from './types'
import type { ValidatorRef } from './validators'

export interface SpecRule {
  /** Имя зарегистрированного валидатора. */
  readonly rule: string
  readonly arg?: string | number | readonly string[]
}

export interface FieldSpec {
  readonly name: string
  readonly kind?: ValueKind
  readonly input: InputMode
  readonly label: string
  readonly help?: string
  readonly placeholder?: string
  readonly defaultAsString?: string
  readonly required?: boolean
  readonly rules?: readonly SpecRule[]
  readonly options?: readonly Option[]
  readonly visibleWhen?: VisibilityCondition
}

export interface CompileOptions {
  prefix?: string
  registry?: Registry
  policy?: FormPolicy
  /** Разрешить произвольный шаблон вместо имени из реестра. */
  allowCustomPattern?: boolean
}

export type CompileResult =
  | { ok: true; field: FieldDescriptor }
  | { ok: false; defects: readonly FieldDefect[] }

/** Вложенный квантификатор над группой — классический катастрофический откат. */
const UNSAFE_PATTERN = /\([^)]*[+*{][^)]*\)\s*[+*{]/

const defect = (code: FieldDefect['code'], at: string, message: string): FieldDefect =>
  ({ code, severity: 'error', at, message })

export function compileFieldSpec(spec: FieldSpec, o: CompileOptions = {}): CompileResult {
  const registry = o.registry ?? defaultRegistry
  const policy = o.policy ?? defaultPolicy
  const prefix = o.prefix ?? 'u_'
  const at = spec?.name ?? '<без имени>'
  const defects: FieldDefect[] = []

  if (!spec || typeof spec !== 'object')
    return { ok: false, defects: [defect('spec.limit', at, 'спецификация не объект')] }

  // функции в спецификации запрещены: поле из рантайма не исполняет чужой код
  for (const [key, value] of Object.entries(spec))
    if (typeof value === 'function')
      defects.push(defect('spec.limit', at, `свойство '${key}' содержит функцию`))

  // имя проверяется ДО префикса: выйти из своего пространства имён нельзя
  if (typeof spec.name !== 'string' || spec.name.includes('.') || nameProblem(spec.name, policy.names))
    defects.push(defect('spec.name-invalid', at, `имя '${spec.name}' недопустимо`))

  if (typeof spec.label !== 'string' || spec.label.length === 0)
    defects.push(defect('spec.limit', at, 'подпись обязательна'))

  const kind = spec.kind ?? registry.types.byInput(spec.input)?.kind
  if (!kind) {
    defects.push(defect('spec.unknown-kind', at, `представление '${spec.input}' не обслуживается`))
    return { ok: false, defects }
  }

  const validators: ValidatorRef[] = []
  if (spec.required) validators.push({ name: 'required' })

  for (const [i, r] of (spec.rules ?? []).entries()) {
    const where = `${at}.rules[${i}]`
    if (r.rule === 'pattern') {
      const named = typeof r.arg === 'string' ? registry.pattern(r.arg) : undefined
      if (named) { validators.push({ name: 'pattern', arg: { source: named } }); continue }
      const custom = typeof r.arg === 'string' ? r.arg : ''
      if (!o.allowCustomPattern) {
        defects.push(defect('spec.pattern-unsafe', where, 'шаблон не из реестра'))
        continue
      }
      if (custom.length > policy.limits.patternLength) {
        defects.push(defect('spec.pattern-unsafe', where, 'шаблон длиннее предела'))
        continue
      }
      if (UNSAFE_PATTERN.test(custom)) {
        defects.push(defect('spec.pattern-unsafe', where,
          'вложенный квантификатор над группой — риск катастрофического отката'))
        continue
      }
      validators.push({ name: 'pattern', arg: { source: custom } })
      continue
    }
    if (!registry.validators.has(r.rule)) {
      defects.push(defect('spec.limit', where, `правило '${r.rule}' не зарегистрировано`))
      continue
    }
    validators.push({ name: r.rule, arg: r.arg })
  }

  const field: FieldDescriptor = {
    name: `${prefix}${spec.name}`,
    kind, input: spec.input, order: 0,
    label: spec.label, help: spec.help, placeholder: spec.placeholder,
    defaultValue: spec.defaultAsString,
    validators,
    options: spec.options ? [...spec.options] : undefined,
    visibleWhen: spec.visibleWhen,
    fresh: true,
  }

  defects.push(...checkFieldDefinition(field, registry, policy))
  return defects.some((d) => d.severity === 'error')
    ? { ok: false, defects }
    : { ok: true, field }
}

export function compileFieldSpecs(specs: readonly FieldSpec[], o: CompileOptions = {}):
  { ok: true; fields: FieldDescriptor[] } | { ok: false; defects: FieldDefect[] } {
  const policy = o.policy ?? defaultPolicy
  if (specs.length > policy.limits.fields)
    return { ok: false, defects: [defect('spec.limit', '<набор>', 'полей больше предела')] }

  const fields: FieldDescriptor[] = []
  const defects: FieldDefect[] = []
  const seen = new Set<string>()
  for (const spec of specs) {
    const r = compileFieldSpec(spec, o)
    if (!r.ok) { defects.push(...r.defects); continue }
    if (seen.has(r.field.name)) {
      defects.push(defect('spec.limit', r.field.name, 'дубль имени в наборе'))
      continue
    }
    seen.add(r.field.name)
    fields.push(r.field)
  }
  return defects.length ? { ok: false, defects } : { ok: true, fields }
}
