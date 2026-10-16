// Проверка значений. Один и тот же код исполняется в браузере и на сервере.
import type { ConstraintKind } from './constraints'
import type { DisableRule, FieldCondition, FieldDescriptor, FieldLink, FormDescription, VisibilityCondition } from './describe'
import type { Structural } from './decode'
import type { FormError } from './result'
import { stableId } from './result'
import type { Issue, ValidatorRef } from './validators'

/** Заполнено ли значение: непустая строка/список, число, `true`. */
export function isFilled(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(isFilled)
  return v === true || typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')
}

/** Выполнено ли условие при этих значениях. Один расчёт для браузера и сервера. */
export function matchesCondition(c: FieldCondition, values: Readonly<Record<string, unknown>>): boolean {
  if ('all' in c) return c.all.every((x) => matchesCondition(x, values))
  if ('any' in c) return c.any.some((x) => matchesCondition(x, values))
  if ('not' in c) return !matchesCondition(c.not, values)
  const v = values[c.field]
  if ('filled' in c) return isFilled(v)
  if ('includes' in c) return (Array.isArray(v) ? v : [v]).some((x) => x != null && String(x) === c.includes)
  if ('equals' in c) return v === c.equals
  return v !== c.notEquals
}

/** Условия — данные, поэтому сервер считает видимость без скрипта. */
export function isVisible(c: VisibilityCondition | undefined, values: Record<string, unknown>): boolean {
  return !c || matchesCondition(c, values)
}

/** Сработавшие правила выключения поля — все, в порядке объявления. */
export function disabledBy(f: FieldDescriptor, values: Readonly<Record<string, unknown>>): DisableRule[] {
  return (f.disabledWhen ?? []).filter((rule) => matchesCondition(rule.when, values))
}

const fieldsOf = (c: FieldCondition): string[] =>
  'all' in c ? c.all.flatMap(fieldsOf) : 'any' in c ? c.any.flatMap(fieldsOf) : 'not' in c ? fieldsOf(c.not) : [c.field]

/** «А» · «А» и «Б» · «А», «Б» и «В». */
const quoteList = (xs: readonly string[]): string => {
  const q = xs.map((x) => `«${x}»`)
  return q.length < 2 ? q.join('') : `${q.slice(0, -1).join(', ')} и ${q[q.length - 1]}`
}

/**
 * Подстановки текста о выключении по сработавшим правилам: `field` — как
 * называется выключенное, `blockers` — кто мешает (без повторов, в порядке
 * объявления, уже в кавычках и через «и»), `reason` — причины через «; ».
 */
export function disableParams(
  d: FormDescription, f: FieldDescriptor, rules: readonly DisableRule[],
): { field: string; blockers: string; reason: string } {
  const blockers = rules.flatMap((rule) => rule.blockers ?? fieldsOf(rule.when).map((name) => d.byName[name]?.label ?? name))
  return {
    field: rules.find((rule) => rule.label)?.label ?? f.label ?? f.name,
    blockers: quoteList([...new Set(blockers)]),
    reason: [...new Set(rules.map((rule) => rule.reason))].join('; '),
  }
}

/**
 * Сработавшие правила → коды и подстановки текста: правила без своего текста
 * дают ОДИН общий `link.blocked`, со своим — `link.message` (`{text}` — их
 * тексты через «; »). Одни данные на подсказку под полем и на отказ.
 */
export function disableIssues(d: FormDescription, f: FieldDescriptor, rules: readonly DisableRule[]): Issue[] {
  const plain = rules.filter((rule) => rule.message === undefined)
  const own = rules.filter((rule) => rule.message !== undefined)
  const out: Issue[] = []
  if (plain.length) out.push({ code: 'link.blocked', params: disableParams(d, f, plain) })
  if (own.length) {
    const text = own.map((rule) => d.policy.interpolate(rule.message!, disableParams(d, f, [rule]))).join('; ')
    out.push({ code: 'link.message', params: { text } })
  }
  return out
}

/** Живое решение `disabledWhen` для поля: выключено + строка под ним, или ничего. */
export function disabledState(
  d: FormDescription, f: FieldDescriptor, values: Readonly<Record<string, unknown>>,
  render: (code: string, params: Record<string, unknown>) => string,
): FieldLink | undefined {
  const rules = disabledBy(f, values)
  if (!rules.length) return undefined
  return { disabled: true, reason: disableIssues(d, f, rules).map((i) => render(i.code, i.params ?? {})).join('; ') }
}

/** Возвращает множество видимых полей формы. */
export function visibleFields(d: FormDescription, values: Record<string, unknown>): Set<string> {
  const out = new Set<string>()
  for (const f of d.fields) if (isVisible(f.visibleWhen, values)) out.add(f.name)
  return out
}

/** Опции validateForm. */
export interface ValidateOptions {
  /** Виды ограничений, снятые действием. */
  relax?: readonly ConstraintKind[]
  subset?: readonly string[]
  structural?: readonly Structural[]
  cardinality?: 'first' | 'all'
  formValidator?: (values: Record<string, unknown>) => readonly Issue[]
}

const toError = (i: Issue, path: string, f: FieldDescriptor): FormError => ({
  id: stableId({ path, code: i.code, params: i.params }),
  code: i.code,
  message: i.code,                 // текст подставит нормализация по словарю
  params: i.params,
  path,
  origin: 'core',
  ...(i.message !== undefined ? { template: i.message } : {}),
})

/** Выполняет структурную, полевую и формовую валидацию. */
export function validateForm(
  d: FormDescription, values: Record<string, unknown>, opts: ValidateOptions = {},
): FormError[] {
  const errors: FormError[] = []
  const visible = visibleFields(d, values)
  const relax = new Set(opts.relax ?? [])
  const subset = opts.subset ? new Set(opts.subset) : null

  const structuralByPath = new Map<string, FormError[]>()
  for (const s of opts.structural ?? []) {
    const f = d.byName[s.path]
    if (!f) continue
    structuralByPath.set(s.path, [
      ...(structuralByPath.get(s.path) ?? []),
      toError({ code: s.code, params: s.params }, s.at ? `${s.path}.${s.at}` : s.path, f),
    ])
  }

  /** Виды ограничений одной ссылки — чтобы понять, снято ли правило действием. */
  const kindsOf = (ref: ValidatorRef): ConstraintKind[] => {
    try {
      const v = d.registry.validators.resolve(ref)
      return v.describe ? v.describe().map((c) => c.kind) : []
    } catch { return [] }
  }

  for (const f of d.fields) {
    if (subset && !subset.has(f.name)) continue
    // скрытое поле не проверяется: требовать невидимое — заблокировать форму молча
    if (!visible.has(f.name)) continue

    // значение не разобралось — правила поверх мусора дадут ложные ошибки
    const collected = structuralByPath.get(f.name) ?? []
    // Выключенное поле с выбором: без JS браузер его отправил — набор
    // отклоняется по связке, остальные правила к такому значению неприменимы.
    const blocked = collected.length === 0 && isFilled(values[f.name]) ? disabledBy(f, values) : []
    if (blocked.length) collected.push(...disableIssues(d, f, blocked).map((i) => toError(i, f.name, f)))
    else if (collected.length === 0) {
      const mode = f.cardinality ?? opts.cardinality ?? d.cardinality
      const constraints = d.constraintsOf(f.name)
      for (const ref of f.validators) {
        const kinds = kindsOf(ref)
        if (kinds.some((k) => relax.has(k))) continue
        let fn
        try { fn = d.registry.validators.resolve(ref) } catch { continue }
        const issue = fn(values[f.name], { path: f.name, values, constraints })
        if (!issue) continue
        collected.push(toError(issue, issue.path ?? f.name, f))
        if (mode === 'first') break
      }
    }
    errors.push(...collected)
  }

  // проверка уровня формы идёт ПОСЛЕ полевой: межполевое над мусором бессмысленно
  for (const i of opts.formValidator?.(values) ?? []) {
    errors.push({
      id: stableId({ path: i.path, code: i.code, params: i.params }),
      code: i.code, message: i.code, params: i.params, path: i.path, origin: 'core',
    })
  }
  return errors
}
