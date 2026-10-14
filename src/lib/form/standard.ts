// Поле формы как Standard Schema и Standard JSON Schema — для тех, кто про формы не знает.
//
//     const title = fieldSchema(postForm, 'title')
//     title['~standard'].validate('ab')                 // { issues: [{ code: 'minLength', … }] }
//     title['~standard'].jsonSchema.input({ target: 'draft-2020-12' })
//                                                       // { type: 'string', minLength: 3, maxLength: 120 }
//
// Так `lib/db` берёт поле формы схемой колонки: проверяет значение теми же правилами и
// строит из ограничений тип и CHECK — без импорта `lib/form`.
//
// В схему входят только правила ОДНОГО значения. Межполевые (`sameAs`, `notAbove`…),
// асинхронные (`check`) и условия показа (`visibleWhen`) остаются за формой: по одному
// значению их не решить. Объект схемы один на поле — по нему `lib/db` узнаёт метку
// проверки (`proof.ts`).
import type { Constraint } from './constraints'
import type { FieldDescriptor, FormDescription } from './describe'
import { formRenderer } from './messages-order'
import type { Issue, Validator } from './validators'

/** Issue схемы поля: Standard Schema плюс код и параметры для словаря текстов. */
export interface FieldIssue {
  readonly message: string
  readonly path: readonly [string]
  readonly code: string
  readonly params?: Record<string, unknown>
  /** Свой текст правила (`.message()`), если задан: сильнее словарей. */
  readonly template?: string
}

export type FieldSchemaResult<V> =
  | { readonly value: V; readonly issues?: undefined }
  | { readonly issues: readonly FieldIssue[] }

/** Цели JSON Schema, которые поле умеет описать. Другая цель — исключение (так велит стандарт). */
export type JsonSchemaTarget = 'draft-2020-12' | 'draft-07' | (string & {})

/** Поле формы как Standard Schema v1 + Standard JSON Schema v1. */
export interface FieldSchema<V = unknown> {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: 'modals-kit/form'
    validate(value: unknown): FieldSchemaResult<V>
    readonly jsonSchema: {
      input(options: { readonly target: JsonSchemaTarget }): Record<string, unknown>
      output(options: { readonly target: JsonSchemaTarget }): Record<string, unknown>
    }
    readonly types?: { readonly input: unknown; readonly output: V }
  }
}

const cache = new WeakMap<FieldDescriptor, FieldSchema<unknown>>()

/** Правило заглянуло в соседнее поле: по одному значению его не решить. */
const CROSS = Symbol('cross-field')

/** Тип значения встроенных видов. Свои виды типом не проверяются — только правилами. */
const TYPE_OK: Record<string, (x: unknown) => boolean> = {
  text: (x) => typeof x === 'string',
  number: (x) => x === null || (typeof x === 'number' && Number.isFinite(x)),
  checkbox: (x) => typeof x === 'boolean',
  date: (x) => x === null || typeof x === 'string',
  time: (x) => x === null || typeof x === 'string',
  datetime: (x) => x === null || typeof x === 'string',
  select: (x) => x === null || typeof x === 'string',
  multiselect: (x) => Array.isArray(x) && x.every((i) => typeof i === 'string'),
}

/**
 * Поле формы как Standard Schema и Standard JSON Schema. Повторный вызов для того же
 * поля возвращает тот же объект: по нему `lib/db` сверяет метку проверки.
 * @param d Описание формы (`defineForm`).
 * @param name Имя поля.
 * @returns Схема поля. Тип значения задаёт вызывающий: `fieldSchema<string>(form, 'title')`.
 */
export function fieldSchema<V = unknown>(d: FormDescription, name: string): FieldSchema<V> {
  const f = d.byName[name]
  if (!f) throw new Error(`[form] поле не объявлено: ${name}`)
  const hit = cache.get(f)
  if (hit) return hit as FieldSchema<V>
  const render = formRenderer(d.messages as never, undefined, d.policy.interpolate)
  const constraints = d.constraintsOf(name)
  const issueOf = (i: Issue): FieldIssue => ({
    message: render(i.code, i.params ?? {}, { path: name, template: i.message }),
    path: [name], code: i.code,
    ...(i.params ? { params: i.params } : {}),
    ...(i.message !== undefined ? { template: i.message } : {}),
  })
  const json = (o: { readonly target: JsonSchemaTarget }) => {
    if (o?.target !== 'draft-2020-12' && o?.target !== 'draft-07')
      throw new Error(`[form] цель JSON Schema не поддерживается: ${String(o?.target)}`)
    return jsonSchemaOf(f, constraints)
  }
  const schema: FieldSchema<unknown> = Object.freeze({
    '~standard': Object.freeze({
      version: 1 as const,
      vendor: 'modals-kit/form' as const,
      validate(value: unknown): FieldSchemaResult<unknown> {
        const typeOk = TYPE_OK[f.kind]
        if (typeOk && !typeOk(value)) return { issues: [issueOf({ code: 'invalid' })] }
        // Соседних значений нет: правило, которое к ним обратится, пропускается целиком.
        const values = new Proxy({} as Record<string, unknown>, {
          get: (_t, key) => { if (key === name) return value; if (typeof key === 'symbol') return undefined; throw CROSS },
          has: (_t, key) => { if (key === name) return true; throw CROSS },
          ownKeys: () => [name],
          getOwnPropertyDescriptor: (_t, key) =>
            key === name ? { value, enumerable: true, configurable: true, writable: false } : undefined,
        })
        const issues: FieldIssue[] = []
        for (const ref of f.validators) {
          let fn: Validator<unknown>
          try { fn = d.registry.validators.resolve(ref) } catch { continue }
          if ((fn as { asyncCheck?: unknown }).asyncCheck) continue
          let found: Issue | null
          try { found = fn(value, { path: name, values, constraints }) } catch (e) {
            if (e === CROSS) continue
            throw e
          }
          if (found) issues.push(issueOf(found))
        }
        return issues.length ? { issues } : { value }
      },
      jsonSchema: Object.freeze({ input: json, output: json }),
    }),
  })
  cache.set(f, schema)
  return schema as FieldSchema<V>
}

/**
 * Ограничения поля → JSON Schema. Только то, что поле знает точно: межполевое и
 * «непрозрачное» (`opaque`) не описывается. Обязательность строки — `minLength ≥ 1`;
 * NOT NULL колонки решает не форма, а поле БД (`nullable`).
 */
function jsonSchemaOf(f: FieldDescriptor, list: readonly Constraint[]): Record<string, unknown> {
  const c = (kind: string) => list.filter((x) => x.kind === kind) as (Constraint & Record<string, unknown>)[]
  const tightest = (kind: string, pick: 'min' | 'max') => {
    const xs = c(kind).map((x) => x.value).filter((x): x is number => typeof x === 'number')
    return xs.length ? (pick === 'min' ? Math.min(...xs) : Math.max(...xs)) : undefined
  }
  // самая строгая нижняя граница — наибольшая из заданных, верхняя — наименьшая
  const lowerBound = (kind: string) => tightest(kind, 'max')
  const upperBound = (kind: string) => tightest(kind, 'min')
  const required = c('required').length > 0
  const enumOf = () => {
    const sets = c('oneOf').map((x) => x.values as readonly string[])
    return sets.length ? [...sets.reduce((a, b) => a.filter((x) => b.includes(x)))] : undefined
  }
  const nullable = (type: string) => (required ? type : [type, 'null'])
  switch (f.kind) {
    case 'text': case 'select': case 'date': {
      const out: Record<string, unknown> = { type: f.kind === 'text' ? 'string' : nullable('string') }
      if (f.kind === 'date') out.format = 'date'
      const min = Math.max(lowerBound('minLength') ?? 0, required && f.kind === 'text' ? 1 : 0)
      if (min > 0) out.minLength = min
      const max = upperBound('maxLength')
      if (max !== undefined) out.maxLength = max
      const pattern = c('pattern')[0]?.source
      if (typeof pattern === 'string') out.pattern = pattern
      const values = enumOf()
      if (values) out.enum = required ? values : [...values, null]
      return out
    }
    case 'number': {
      const integer = c('step').some((x) => x.value === 1 && (x.unit === undefined || x.unit === 'number'))
      const out: Record<string, unknown> = { type: nullable(integer ? 'integer' : 'number') }
      for (const [kind, key, exKey] of [['minMagnitude', 'minimum', 'exclusiveMinimum'], ['maxMagnitude', 'maximum', 'exclusiveMaximum']] as const) {
        const xs = c(kind).filter((x) => typeof x.value === 'number')
        if (!xs.length) continue
        const pick = kind === 'minMagnitude'
          ? xs.reduce((a, b) => ((b.value as number) > (a.value as number) ? b : a))
          : xs.reduce((a, b) => ((b.value as number) < (a.value as number) ? b : a))
        out[pick.exclusive ? exKey : key] = pick.value
      }
      const step = c('step').find((x) => typeof x.value === 'number' && x.value !== 1 && (x.unit === undefined || x.unit === 'number'))
      if (step) out.multipleOf = step.value
      return out
    }
    case 'checkbox':
      return required ? { type: 'boolean', const: true } : { type: 'boolean' }
    case 'multiselect': {
      const items: Record<string, unknown> = { type: 'string' }
      const values = enumOf()
      if (values) items.enum = values
      const out: Record<string, unknown> = { type: 'array', items }
      const min = Math.max(lowerBound('minCount') ?? 0, required ? 1 : 0)
      if (min > 0) out.minItems = min
      const max = upperBound('maxCount')
      if (max !== undefined) out.maxItems = max
      return out
    }
    default:
      throw new Error(`[form] вид значения '${f.kind}' (поле '${f.name}') не описывается JSON Schema`)
  }
}
