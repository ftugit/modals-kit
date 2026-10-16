// Набор полей, который собирает пользователь: каталог видов и схема валидаторов.
//
// Разработчик описывает, ИЗ ЧЕГО можно собирать: виды полей (представление,
// правила вида, правила на выбор) и пределы аргументов у каждого валидатора.
// Пользователь присылает описания полей — данные, а не код. `compile` приводит
// их к пределам, добавляет правила вида и правила по умолчанию и говорит, что
// заменил. Тексты для человека выбирает приложение: здесь только коды.
import type { FormPolicy } from './policy'
import { defaultRegistry, type Registry } from './registry'
import { compileFieldSpecs, type FieldSpec, type SpecRule } from './spec'
import type { InputMode, ValueKind } from './types'

/** Значение «предела нет»: отсутствие ключа, `undefined`, `null`, `false`, `''`. */
type Off = undefined | null | false | ''
/** Предел: число (может быть отрицательным и нулём) или «нет предела». */
export type KitBound = number | Off

/** Пределы аргумента валидатора; `default` — правило добавляется, если его не выбрали. */
export interface KitArgLimits { readonly min?: KitBound; readonly max?: KitBound; readonly default?: KitBound }

/** Вид поля в каталоге. */
export interface KitKind {
  /** Подпись вида для выбора в интерфейсе; текст выбирает приложение. */
  readonly label?: string
  readonly input: InputMode
  readonly kind?: ValueKind
  /** Правила вида: всегда есть у поля этого вида, снять или заменить нельзя. */
  readonly locked?: readonly (string | SpecRule)[]
  /** Правила, которые пользователь может добавить (мультиселект). */
  readonly extra?: readonly string[]
  /** Пределы вида: только сужают пределы набора. */
  readonly rules?: Readonly<Record<string, KitArgLimits>>
}

/**
 * Поле, созданное пользователем, — самодостаточная спецификация: правила вида уже
 * внутри `rules`, поэтому из сохранённого списка форма строится без каталога
 * (`defineForm({ from })`). `preset` — ключ вида из каталога `kinds`.
 */
export interface FieldSetItem extends FieldSpec {
  readonly preset: string
}

/** Настройка набора. */
export interface FieldKitOptions {
  /** Пределы самого набора (поля-родителя). */
  readonly limits?: { readonly fields?: KitBound }
  /** Схема валидаторов: какие правила доступны и пределы их аргументов. */
  readonly rules: Readonly<Record<string, KitArgLimits>>
  /** Каталог видов. */
  readonly kinds: Readonly<Record<string, KitKind>>
  readonly registry?: Registry
  readonly policy?: FormPolicy
}

/** Описание поля от пользователя: данные, не код. */
export interface KitField {
  readonly name: string
  readonly kind: string
  readonly label: string
  readonly help?: string
  readonly rules?: readonly SpecRule[]
}

/** Замена `compile`: `clamped` — вне пределов, `added` — правило по умолчанию, `defaulted` — без значения. */
export interface KitChange {
  readonly field: string; readonly rule: string; readonly code: 'clamped' | 'added' | 'defaulted'
  readonly from?: unknown; readonly to: number
}

/** Почему набор не принят. */
export interface KitDefect {
  readonly code:
    | 'kit.not-list' | 'kit.too-many-fields' | 'kit.field-shape' | 'kit.unknown-kind'
    | 'kit.rule-not-allowed' | 'kit.rule-duplicate' | 'kit.arg-type' | 'kit.arg-missing' | 'kit.spec'
  /** Имя поля без префикса. */
  readonly field?: string
  readonly rule?: string
  readonly params?: Readonly<Record<string, unknown>>
  /** Для разработчика; человеку текст выбирает приложение по коду. */
  readonly message: string
}

export type KitResult =
  | { ok: true; specs: FieldSetItem[]; changes: KitChange[] }
  | { ok: false; defects: KitDefect[]; changes: KitChange[] }

/** Действующие пределы правила у вида. */
export interface KitRuleLimits { readonly min?: number; readonly max?: number; readonly default?: number }

/** Что показать в мультиселекте вида. */
export interface KitRulesFor {
  readonly locked: readonly SpecRule[]
  readonly extra: readonly string[]
  readonly limits: Readonly<Record<string, KitRuleLimits>>
}

export interface FieldKit {
  /** Виды в порядке объявления. */
  readonly kinds: readonly string[]
  /** Предел числа полей; `undefined` — без предела. */
  readonly max: number | undefined
  labelOf(kind: string): string | undefined
  inputOf(kind: string): InputMode | undefined
  rulesFor(kind: string): KitRulesFor | undefined
  compile(list: unknown): KitResult
}

const off = (x: unknown): x is Off => x === undefined || x === null || x === false || x === ''
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

/** Проверка настройки: неверная настройка молча работала бы не так — падаем сразу. */
function bound(x: unknown, where: string): number | undefined {
  if (off(x)) return undefined
  if (typeof x !== 'number' || !Number.isFinite(x))
    throw new TypeError(`[form] defineFieldKit: ${where} — число или «нет предела» (undefined/null/false/'')`)
  return x
}

function limitsOf(l: KitArgLimits | undefined, where: string) {
  if (l !== undefined && (typeof l !== 'object' || l === null))
    throw new TypeError(`[form] defineFieldKit: ${where} — объект { min?, max?, default? }`)
  return { min: bound(l?.min, `${where}.min`), max: bound(l?.max, `${where}.max`), default: bound(l?.default, `${where}.default`) }
}

/** Пересечение пределов: вид только сужает набор. */
function narrow(parent: KitRuleLimits, kind: KitRuleLimits | undefined, where: string): KitRuleLimits {
  const pick = (a: number | undefined, b: number | undefined, f: (x: number, y: number) => number) =>
    a === undefined ? b : b === undefined ? a : f(a, b)
  const min = pick(parent.min, kind?.min, Math.max)
  const max = pick(parent.max, kind?.max, Math.min)
  if (min !== undefined && max !== undefined && min > max)
    throw new RangeError(`[form] defineFieldKit: ${where} — min ${min} больше max ${max}`)
  let def = kind?.default ?? parent.default
  // значение по умолчанию живёт внутри действующих пределов: вид, сузивший max, сужает и его
  if (def !== undefined && max !== undefined) def = Math.min(def, max)
  if (def !== undefined && min !== undefined) def = Math.max(def, min)
  return { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}), ...(def !== undefined ? { default: def } : {}) }
}

const hasLimits = (l: KitRuleLimits | undefined) => !!l && (l.min !== undefined || l.max !== undefined || l.default !== undefined)
const sameRule = (a: SpecRule, b: SpecRule) => a.rule === b.rule && JSON.stringify(a.arg ?? null) === JSON.stringify(b.arg ?? null)

/**
 * Набор полей, который собирает пользователь.
 * @param o Каталог видов, схема валидаторов с пределами аргументов, пределы набора.
 * @returns `kinds`, `rulesFor(kind)` для мультиселекта и `compile(list)`.
 * @throws Неверная настройка: правило не из реестра, `min > max`, предел — не число.
 */
export function defineFieldKit(o: FieldKitOptions): FieldKit {
  const registry = o.registry ?? defaultRegistry
  const known = (rule: string) => rule === 'pattern' || registry.validators.has(rule)
  const parent: Record<string, KitRuleLimits> = Object.create(null)
  for (const [rule, l] of Object.entries(o.rules ?? {})) {
    if (!known(rule)) throw new TypeError(`[form] defineFieldKit: rules.${rule} — правило не зарегистрировано`)
    parent[rule] = narrow(limitsOf(l, `rules.${rule}`), undefined, `rules.${rule}`)
  }
  const maxFields = bound(o.limits?.fields, 'limits.fields')

  const catalog = new Map<string, { input: InputMode; kind?: ValueKind; label?: string } & KitRulesFor>()
  for (const [name, k] of Object.entries(o.kinds ?? {})) {
    const where = `kinds.${name}`
    if (!registry.types.byInput(k.input) && !k.kind)
      throw new TypeError(`[form] defineFieldKit: ${where}.input '${k.input}' не обслуживается реестром`)
    const locked = (k.locked ?? []).map((r) => (typeof r === 'string' ? { rule: r } : r))
    for (const r of locked) if (!known(r.rule)) throw new TypeError(`[form] defineFieldKit: ${where}.locked — '${r.rule}' не зарегистрировано`)
    const extra = [...(k.extra ?? [])]
    for (const r of extra) if (!own(parent, r)) throw new TypeError(`[form] defineFieldKit: ${where}.extra — '${r}' нет в схеме rules`)
    const limits: Record<string, KitRuleLimits> = {}
    for (const r of Object.keys(k.rules ?? {}))
      if (!extra.includes(r)) throw new TypeError(`[form] defineFieldKit: ${where}.rules.${r} — правила нет в extra вида`)
    for (const r of extra) {
      const l = narrow(parent[r]!, k.rules?.[r] ? limitsOf(k.rules[r], `${where}.rules.${r}`) : undefined, `${where}.rules.${r}`)
      if (hasLimits(l)) limits[r] = l
    }
    catalog.set(name, { input: k.input, ...(k.kind ? { kind: k.kind } : {}), ...(k.label ? { label: k.label } : {}), locked, extra, limits })
  }

  function compile(list: unknown): KitResult {
    const changes: KitChange[] = []
    const defects: KitDefect[] = []
    if (!Array.isArray(list)) return { ok: false, defects: [{ code: 'kit.not-list', message: 'описания полей — массив' }], changes }
    if (maxFields !== undefined && list.length > maxFields)
      return {
        ok: false, changes,
        defects: [{ code: 'kit.too-many-fields', params: { count: list.length, max: maxFields }, message: `полей ${list.length}, предел ${maxFields}` }],
      }
    const specs: FieldSetItem[] = []
    for (const raw of list as unknown[]) {
      const u = raw as Partial<KitField> | null
      if (!u || typeof u !== 'object' || typeof u.name !== 'string' || typeof u.kind !== 'string' || typeof u.label !== 'string') {
        defects.push({ code: 'kit.field-shape', message: 'поле — { name, kind, label, rules? }' })
        continue
      }
      const field = u.name
      const k = catalog.get(u.kind)
      if (!k) { defects.push({ code: 'kit.unknown-kind', field, params: { kind: u.kind }, message: `вида '${u.kind}' нет в каталоге` }); continue }
      const rules: SpecRule[] = []
      const seen = new Set<string>()
      for (const r of Array.isArray(u.rules) ? u.rules : []) {
        if (!r || typeof r !== 'object' || typeof r.rule !== 'string') { defects.push({ code: 'kit.field-shape', field, message: 'правило — { rule, arg? }' }); continue }
        // правило вида уже есть: повтор не меняет его и не снимает
        if (k.locked.some((l) => sameRule(l, r))) continue
        if (!k.extra.includes(r.rule)) {
          defects.push({ code: 'kit.rule-not-allowed', field, rule: r.rule, params: { kind: u.kind }, message: `правило '${r.rule}' не для вида '${u.kind}'` })
          continue
        }
        if (seen.has(r.rule)) { defects.push({ code: 'kit.rule-duplicate', field, rule: r.rule, message: `правило '${r.rule}' выбрано дважды` }); continue }
        seen.add(r.rule)
        const l = k.limits[r.rule]
        if (!hasLimits(l)) { rules.push(r.arg === undefined ? { rule: r.rule } : { rule: r.rule, arg: r.arg }); continue }
        if (r.arg === undefined) {
          if (l!.default === undefined) { defects.push({ code: 'kit.arg-missing', field, rule: r.rule, message: `у правила '${r.rule}' нет значения` }); continue }
          rules.push({ rule: r.rule, arg: l!.default })
          changes.push({ field, rule: r.rule, code: 'defaulted', to: l!.default })
          continue
        }
        if (typeof r.arg !== 'number' || !Number.isFinite(r.arg)) {
          defects.push({ code: 'kit.arg-type', field, rule: r.rule, params: { arg: r.arg }, message: `значение правила '${r.rule}' — число` })
          continue
        }
        let arg = r.arg
        if (l!.max !== undefined && arg > l!.max) arg = l!.max
        if (l!.min !== undefined && arg < l!.min) arg = l!.min
        if (arg !== r.arg) changes.push({ field, rule: r.rule, code: 'clamped', from: r.arg, to: arg })
        rules.push({ rule: r.rule, arg })
      }
      // правило с `default`, которое пользователь не выбрал, добавляется само
      for (const rule of k.extra) {
        const d = k.limits[rule]?.default
        if (d === undefined || seen.has(rule)) continue
        rules.push({ rule, arg: d })
        changes.push({ field, rule, code: 'added', to: d })
      }
      specs.push({
        name: field, preset: u.kind, input: k.input, ...(k.kind ? { kind: k.kind } : {}), label: u.label,
        ...(typeof u.help === 'string' && u.help ? { help: u.help } : {}),
        rules: [...k.locked, ...rules],
      })
    }
    if (defects.length) return { ok: false, defects, changes }
    // та же проверка, что у `defineForm({ from })`: имена с префиксом `u_`
    const prefix = 'u_'
    const compiled = compileFieldSpecs(specs, { registry, policy: o.policy, prefix })
    if (!compiled.ok) {
      // дефекты компиляции (конфликт границ, общий предел политики) — у своего поля
      const name = (at: string) => {
        const short = at.startsWith(prefix) ? at.slice(prefix.length) : at
        const head = short.replace(/\.rules\[\d+\]$/, '')
        return specs.some((s) => s.name === head) ? head : undefined
      }
      return {
        ok: false, changes,
        defects: compiled.defects.map((d) => {
          const field = name(d.at)
          return { code: 'kit.spec', ...(field ? { field } : {}), params: { code: d.code }, message: d.message }
        }),
      }
    }
    return { ok: true, specs, changes }
  }

  return {
    kinds: [...catalog.keys()],
    max: maxFields,
    labelOf: (kind) => catalog.get(kind)?.label,
    inputOf: (kind) => catalog.get(kind)?.input,
    rulesFor: (kind) => {
      const k = catalog.get(kind)
      return k ? { locked: k.locked, extra: k.extra, limits: k.limits } : undefined
    },
    compile,
  }
}
