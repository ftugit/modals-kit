// Объявление формы. Изоморфно: модуль импортируют и страница, и сервер.
import { BOUND_PAIRS, boundValue, type Constraint, type ConstraintKind } from './constraints'
import { applies, projectAttrs, type ProjectedAttrs } from './field-types'
import { defaultPolicy, nameProblem, type FormPolicy } from './policy'
import { defineFieldKit, type FieldKit, type FieldKitOptions, type FieldSetItem, type KitBound } from './kit'
import { createRegistry, defaultRegistry, type Registry } from './registry'
import { compileFieldSpecs, type FieldSpec } from './spec'
import { safeObject, type FieldPath, type FormId, type InputMode, type Revision, type ValueKind } from './types'
import { constraintsOf, type ValidatorRef } from './validators'

/** Один вариант выбора для select/radio-like поля. */
export interface Option { value: string; label: string; disabled?: boolean }

/**
 * Декларативное условие на значения формы — данные, поэтому сервер считает его
 * без скрипта. Им описываются и видимость (`visibleWhen`), и выключение
 * (`disabledWhen`). `filled` — поле заполнено (непустая строка или список,
 * число, `true`); `includes` — список содержит значение, скаляр равен ему
 * (сравнение строковое: значение из адреса и из разметки — строка).
 */
export type FieldCondition =
  | { field: FieldPath; equals: string | number | boolean | null }
  | { field: FieldPath; notEquals: string | number | boolean | null }
  | { field: FieldPath; filled: true }
  | { field: FieldPath; includes: string }
  | { all: readonly FieldCondition[] }
  | { any: readonly FieldCondition[] }
  | { not: FieldCondition }

/** Условие видимости поля — то же условие формы (прежнее имя типа). */
export type VisibilityCondition = FieldCondition

/**
 * Правило выключения поля (R1): когда `when` выполнено, поле видно, но
 * недоступно — браузер его не отправляет. Без JS про `disabled` никто не
 * знает, поэтому то же правило проверяет `validateForm` на обеих сторонах:
 * ЗАПОЛНЕННОЕ выключенное поле даёт отказ, пустое ничего не нарушает.
 * Текст один на подсказку под полем и на отказ. Сработало несколько правил —
 * говорят ВСЕ: виновники и причины собираются в один текст `link.blocked`.
 */
export interface DisableRule {
  readonly when: FieldCondition
  /** Причина своими словами («у анонсов нет оценки»): подставляется как `{reason}`. */
  readonly reason: string
  /** Кто мешает — подписи для `{blockers}`; по умолчанию подписи полей из `when`. */
  readonly blockers?: readonly string[]
  /** Как выключенное называется в `{field}`; по умолчанию подпись поля. */
  readonly label?: string
  /**
   * Свой текст этого правила вместо словарного — шаблон с теми же
   * подстановками `{field}`, `{blockers}`, `{reason}`. Правила со своим
   * текстом говорят каждое отдельно (код `link.message`), остальные — общим.
   */
  readonly message?: string
}

/**
 * Правила поля сгенерированы из чужой схемы (например, `formParams` модели БД):
 * `schema` — сам объект схемы, `rules` — валидаторы, которые из неё получились.
 * `pick` на сервере ставит метку «проверено» с этой схемой — получатель (`lib/db`)
 * не повторит её правила. Метка ставится, только если все `rules` остались в
 * `validate` поля: правила заменили — метки нет, получатель проверит сам.
 */
export interface RulesFrom {
  readonly schema: object
  readonly rules: readonly ValidatorRef[]
}

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
  /**
   * Вариант показа внутри одного представления (см. `FieldOptions.variant`).
   * Библиотека его не толкует — только передаёт в `resolve` и вид поля.
   */
  readonly variant?: string
  readonly defaultValue?: V
  readonly secret?: boolean
  readonly validators: readonly ValidatorRef[]
  /** Откуда правила поля (см. `FieldOptions.rulesFrom`). */
  readonly rulesFrom?: RulesFrom
  /** Тексты ошибок поля по коду (F56); в словарь формы попадают как «поле:код». */
  readonly messages?: Readonly<Record<string, string>>
  readonly options?: readonly Option[]
  readonly visibleWhen?: VisibilityCondition
  /** Правила выключения поля по значениям формы (см. `DisableRule`). */
  readonly disabledWhen?: readonly DisableRule[]
  /**
   * Поле выключено статически (видно, но недоступно): решение известно при
   * объявлении. Решения по значениям — `disabledWhen`.
   */
  readonly disabled?: boolean
  /** Причина показывается в слоте helper вместо help; бывает только у выключенного поля. */
  readonly reason?: string
  readonly cardinality?: 'first' | 'all'
  readonly invalidFrom?: InvalidFrom
  readonly fresh?: boolean
  /** Каталог видов и пределы набора `field.fields`: по нему разбор приводит значение. */
  readonly fieldSet?: FieldKit
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
  /**
   * Вариант показа внутри одного представления: какой компонент рисовать,
   * решает `resolve` приложения (`'strength'` — пароль со шкалой сложности).
   * Библиотека строку не толкует: на значение, разметку и проверки она не влияет.
   */
  variant?: string
  /** Начальное значение поля до ввода пользователя. */
  defaultValue?: V
  /** Не возвращать значение в публичном `Result.values`; полезно для паролей и токенов. */
  secret?: boolean
  /** Валидаторы поля: функции или сериализуемые ссылки на реестр. */
  validate?: readonly ValidatorRef[]
  /** Откуда правила: ставит генератор параметров (`formParams`), руками не пишется. */
  rulesFrom?: RulesFrom
  /**
   * Тексты ошибок ЭТОГО поля по коду: `{ minValue: 'Вам должно быть {min}' }`
   * (F56). Сильнее словарей формы и приложения, слабее `.message()` валидатора.
   */
  messages?: Readonly<Record<string, string>>
  /** Варианты выбора. Строка превращается в `{ value, label }`. */
  options?: readonly (string | Option)[]
  /** Условие, при котором поле участвует в показе и обычной валидации. */
  visibleWhen?: VisibilityCondition
  /**
   * Правила выключения по значениям формы: живое гашение у клиента и отказ
   * `link.blocked` в `validateForm` — одно объявление на обе стороны.
   */
  disabledWhen?: readonly DisableRule[]
  /**
   * Поле выключено статически (видно, но недоступно); `reason` — почему,
   * показывается в helper-слоте вместо `help`.
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
  return new Proxy({} as FieldSugar, {
    get: (_t, input: string) => (o: FieldOptions & Partial<FieldSetOptions> = {}) => {
      // набор полей от пользователя: каталог собирается сразу — неверный падает при объявлении
      const fieldSet = input === 'fields'
        ? defineFieldKit({ limits: { fields: o.max }, rules: o.rules ?? {}, kinds: o.kinds ?? {}, registry, prefix: o.prefix })
        : undefined
      const kind = o.kind ?? registry.types.byInput(input)?.kind
      if (!kind)
        throw new Error(
          `[form] представление '${input}' не обслуживается ни одним типом. ` +
          'Зарегистрируйте тип или укажите kind явно.')
      return {
        kind, input,
        label: o.label, help: o.help, placeholder: o.placeholder, variant: o.variant,
        defaultValue: o.defaultValue,
        // пароль не возвращается наружу: возврат пароля в разметку — типовая дыра
        secret: o.secret ?? input === 'password',
        validators: o.validate ?? [],
        rulesFrom: o.rulesFrom,
        messages: o.messages,
        options: o.options?.map((x) => (typeof x === 'string' ? { value: x, label: x } : x)),
        visibleWhen: o.visibleWhen,
        disabledWhen: o.disabledWhen,
        disabled: o.disabled,
        // Инвариант контракта: причина бывает только у выключенного поля —
        // иначе helper-узел (и aria-describedby на него) обещан, но пуст.
        reason: o.disabled ? o.reason : undefined,
        cardinality: o.cardinality,
        invalidFrom: o.invalidFrom,
        ...(fieldSet ? { fieldSet } : {}),
      } as FieldDraft
    },
  })
}

/**
 * Настройка `field.fields`: из чего пользователь собирает поля. Значение поля —
 * список `FieldSetItem`, приведённый к этим пределам на обеих сторонах.
 */
export interface FieldSetOptions extends FieldOptions<readonly FieldSetItem[]> {
  /** Сколько полей можно создать; «нет предела» — `undefined`/`null`/`false`/`''`. */
  readonly max?: KitBound
  /** Схема валидаторов: доступные правила и пределы их аргументов. */
  readonly rules: FieldKitOptions['rules']
  /** Каталог видов: представление, правила вида, правила на выбор. */
  readonly kinds: FieldKitOptions['kinds']
  /** Префикс имён полей в форме записи, `u_` по умолчанию. */
  readonly prefix?: string
}

/** Сахар `field.*`: любое представление из реестра плюс набор полей от пользователя. */
export type FieldSugar = Record<string, <V>(o?: FieldOptions<V>) => FieldDraft<V>> & {
  fields(o: FieldSetOptions): FieldDraft<readonly FieldSetItem[]>
}

/** field.* на defaultRegistry для краткого описания встроенных полей. */
export const field = makeFieldSugar()

/** Решение о доступности поля — канал `fieldState` в опциях bind или `disabledWhen`. */
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
  if (type.nested && f.kind === 'fields' && !f.fieldSet)
    out.push(defect('spec.limit', f.name, 'набору полей нужен каталог: объявляйте через field.fields({ rules, kinds })'))
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
  /**
   * Сохранённые поля (значение `field.fields` или любые `FieldSpec`): идут первыми,
   * с префиксом `u_`, затем `fields`. Так сохранённый набор становится формой
   * записи — как есть или с полями из кода.
   */
  from?: readonly FieldSpec[]
  /** Список submit-намерений. Если не задан, создаётся `submit/full`. */
  actions?: readonly ActionDescriptor[]
  /**
   * Сообщения формы поверх словаря приложения и встроенного словаря. Ключ —
   * код (`minValue`, на все поля) или «поле:код» (`'age:minValue'`, F56).
   */
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

/**
 * Словарь формы с текстами полей (F56): `messages` поля ложатся ключами
 * «поле:код» поверх таких же ключей формы — поле ближе к ошибке.
 */
function formMessages(own: Record<string, string> | undefined, fields: readonly FieldDescriptor[]) {
  const out: Record<string, string> = { ...own }
  for (const f of fields)
    for (const [code, text] of Object.entries(f.messages ?? {})) out[`${f.name}:${code}`] = text
  return out
}

/** Проверяет и компилирует FormDefinition в FormDescription. */
export function defineForm(def: FormDefinition): FormDescription {
  const registry = def.registry ?? defaultRegistry
  const policy = def.policy ?? defaultPolicy
  const names = Object.keys(def.fields)
  const defects: FieldDefect[] = []

  // Сохранённые поля — данные, не код: компилируются той же проверкой, что поля из
  // рантайма. Они уже были показаны, поэтому не «новые в этом круге» (`fresh`).
  let saved: FieldDescriptor[] = []
  if (def.from?.length) {
    const compiled = compileFieldSpecs(def.from, { registry, policy })
    if (compiled.ok) saved = compiled.fields.map(({ fresh: _fresh, ...f }) => f)
    else defects.push(...compiled.defects)
  }
  const total = saved.length + names.length
  if (total > policy.limits.fields)
    defects.push(defect('spec.limit', def.id, `полей ${total}, предел ${policy.limits.fields}`))

  const fields: FieldDescriptor[] = [
    ...saved,
    ...names.map((name) => ({ ...def.fields[name]!, name }) as FieldDescriptor),
  ].map((f, order) => ({ ...f, order }))
  const taken = new Set<string>()
  for (const f of fields) {
    if (taken.has(f.name)) defects.push(defect('spec.name-invalid', f.name, `имя '${f.name}' уже занято сохранённым полем`))
    taken.add(f.name)
  }

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
    messages: formMessages(def.messages, fields),
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
