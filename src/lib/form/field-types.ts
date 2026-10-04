// Реестр типов значения.
//
// Тип объявляет ДВЕ вещи сразу одной записью: какие виды ограничений к нему
// применимы и как он их проецирует в разметку.
//
//     required: (c) => ({ required: true })   применимо и проецируется
//     sameAs:   true                          применимо, атрибута не даёт
//     отсутствует                             неприменимо — дефект описания
//
// Второй таблицы нет: применимость и проекция живут в одном месте, у владельца.
import type { Constraint, ConstraintKind } from './constraints'
import { keep } from './keep'
import type { HtmlAttrs, InputMode, ValueKind } from './types'

export interface DecodeContext { path: string; input: InputMode }
export type DecodeResult<V> =
  | { ok: true; value: V }
  | { ok: false; code: string; params?: Record<string, unknown> }

export interface ProjectContext { input: InputMode; name: string }

/** Проекция вида ограничения в атрибуты. */
export type Projection =
  | true                                   // применимо, атрибута нет
  | ((c: Constraint, ctx: ProjectContext) => HtmlAttrs | { skip: string } | undefined)

export interface FieldType<V = unknown> {
  readonly kind: ValueKind
  /** Представления, которые обслуживает тип. Первое — умолчание сахара. */
  readonly inputs: readonly InputMode[]
  readonly multiple: boolean
  readonly empty: V
  decode(entries: readonly (string | File)[], ctx: DecodeContext): DecodeResult<V>
  encode(value: V, name: string, out: Array<[string, string | File]>): void
  /** Применимость и проекция в одной записи. */
  readonly constraints: Readonly<Partial<Record<ConstraintKind, Projection>>>
  /** Атрибуты самого представления, не зависящие от правил. */
  attrs(input: InputMode): HtmlAttrs
  /** Как поле живёт без скрипта: чем заменяется интерактив. */
  readonly degradation: { withoutJs: string; lost?: string }
}

export class FieldTypeRegistry {
  #types = new Map<string, FieldType<any>>()

  register<V>(type: FieldType<V>): this {
    keep(this.#types, type.kind, type as FieldType<any>, 'тип значения')
    return this
  }
  has = (kind: ValueKind) => this.#types.has(kind)
  kinds = () => [...this.#types.keys()]
  all = () => [...this.#types.values()]
  get(kind: ValueKind): FieldType<unknown> {
    const t = this.#types.get(kind)
    if (!t) throw new Error(`[form] тип значения не зарегистрирован: ${kind}`)
    return t
  }
  /** Тип, обслуживающий представление. Нужен сахару `field.*`. */
  byInput(input: InputMode): FieldType<unknown> | undefined {
    return this.all().find((t) => t.inputs.includes(input))
  }
}

export interface ProjectedAttrs {
  attrs: HtmlAttrs
  skipped: { kind: ConstraintKind; why: string }[]
}

/**
 * Единственное место, где ограничения превращаются в разметку.
 * Три причины отказа, и все названы тем, кто их знает:
 *   • правило сказало о себе `safeAsAttr: false` и объяснило почему;
 *   • тип знает вид, но в этом представлении атрибута не даёт;
 *   • тип вида не знает вовсе.
 */
export function projectAttrs(
  type: FieldType<unknown>,
  constraints: readonly Constraint[],
  ctx: ProjectContext,
): ProjectedAttrs {
  const attrs: HtmlAttrs = { ...type.attrs(ctx.input) }
  const skipped: { kind: ConstraintKind; why: string }[] = []
  const skip = (kind: ConstraintKind, why: string) => skipped.push({ kind, why })

  for (const c of constraints) {
    if (c.safeAsAttr === false) { skip(c.kind, c.why ?? 'правило не допускает атрибут'); continue }

    const projection = type.constraints[c.kind]
    if (projection === undefined) {
      skip(c.kind, `тип '${type.kind}' не знает вида ограничения '${c.kind}'`)
      continue
    }
    if (projection === true) { skip(c.kind, `вид '${c.kind}' не выражается атрибутом`); continue }

    const out = projection(c, ctx)
    if (!out) { skip(c.kind, `вид '${c.kind}' не выражается в представлении '${ctx.input}'`); continue }
    if ('skip' in out) { skip(c.kind, String(out.skip)); continue }
    Object.assign(attrs, out)
  }
  return { attrs, skipped }
}

/** Применим ли вид к типу. Для мета-валидации описания. */
export const applies = (type: FieldType<unknown>, kind: ConstraintKind) =>
  type.constraints[kind] !== undefined
