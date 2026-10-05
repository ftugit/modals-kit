// Проверка значений. Один и тот же код исполняется в браузере и на сервере.
import type { ConstraintKind } from './constraints'
import type { FieldDescriptor, FormDescription, VisibilityCondition } from './describe'
import type { Structural } from './decode'
import type { FormError } from './result'
import { stableId } from './result'
import type { Issue, ValidatorRef } from './validators'

/** Условия — данные, поэтому сервер считает видимость без скрипта. */
export function isVisible(c: VisibilityCondition | undefined, values: Record<string, unknown>): boolean {
  if (!c) return true
  if ('all' in c) return c.all.every((x) => isVisible(x, values))
  if ('any' in c) return c.any.some((x) => isVisible(x, values))
  if ('not' in c) return !isVisible(c.not, values)
  if ('equals' in c) return values[c.field] === c.equals
  return values[c.field] !== c.notEquals
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
      toError({ code: s.code, params: s.params }, s.path, f),
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
    if (collected.length === 0) {
      const mode = f.cardinality ?? opts.cardinality ?? d.cardinality
      const constraints = d.constraintsOf(f.name)
      for (const ref of f.validators) {
        const kinds = kindsOf(ref)
        if (kinds.some((k) => relax.has(k))) continue
        // мягкий первый круг: поле, созданное в этом круге, не ругается обязательностью
        if (f.fresh && kinds.includes('required')) continue
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
