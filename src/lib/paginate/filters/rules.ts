/**
 * Значения и связки: серверная проверка значений (`validateCatalogFilterValues`),
 * сработавшие связки (`catalogRuleState`) и нарушения (`catalogFilterViolations`).
 */
import {
  decode,
  validateForm,
  type EntrySource,
  matchesCondition,
} from '#lib/form/index.js'
import { modes } from './internal'
import { FILTER_KEY_PREFIX } from '../source'
import type { CatalogFilterMode, CatalogFilterRule, CatalogFilterSchema } from './schema'
import { parseCatalogFilterPath } from './url'
import { ruleCondition, compileCatalogFilterSchema } from './form'

/** Группа режимов одного поля: `{ and: [...], not: [...] }`. */
export type CatalogFilterGroup = Partial<Record<CatalogFilterMode, readonly string[]>>

/** Диапазон числового поля: обе границы необязательны. */
export type CatalogFilterRange = { min?: number; max?: number }

/**
 * Проверенные (канонические) значения фильтров: результат разбора и валидации.
 * Форма ключа зависит от поля — группа режимов, диапазон или значение; это
 * контракт между схемой и источником, а не «сырые строки из адреса».
 */
export type CatalogFilterValues = Record<string, CatalogFilterGroup | CatalogFilterRange | string>

/**
 * Разбор и проверка значений фильтров по схеме: `catalogFilterFormData` →
 * типы полей (`decode`) → правила формы (`validateForm`). Один код-путь с
 * формой: невалидное значение не «доедет» до источника ни при каком входе.
 *
 * Канон был асинхронным (его ядро формы), здесь проверка синхронна — как и у
 * `#lib/form/index.js` b1; состав проверок тот же: allowlist опций, границы числа.
 */
export function validateCatalogFilterValues(
  schemaInput: unknown,
  raw: EntrySource,
): { values: CatalogFilterValues; errors: readonly string[] } {
  const compiled = compileCatalogFilterSchema(schemaInput)
  const { values: decoded, structural } = decode(raw, compiled.definition)
  const errors = validateForm(compiled.definition, decoded, { structural })
  if (errors.length) return { values: {}, errors: errors.map((error) => error.code) }

  const values: CatalogFilterValues = {}
  for (const descriptor of compiled.schema.fields) {
    if (descriptor.type === 'multiselect') {
      const group: Partial<Record<CatalogFilterMode, readonly string[]>> = {}
      for (const mode of descriptor.modes ?? ['or']) {
        const value = decoded[`filters.${descriptor.key}.${mode}`]
        if (Array.isArray(value) && value.length) group[mode] = value as string[]
      }
      if (Object.keys(group).length) values[descriptor.key] = group
    } else if (descriptor.type === 'number') {
      // Диапазон «от/до»: границы опциональны; перевёрнутый диапазон
      // (min > max) отбрасывается целиком — deny-safe, а не исключение.
      const min = decoded[`filters.${descriptor.key}.min`]
      const max = decoded[`filters.${descriptor.key}.max`]
      const range: CatalogFilterRange = {}
      if (typeof min === 'number' && Number.isFinite(min)) range.min = min
      if (typeof max === 'number' && Number.isFinite(max)) range.max = max
      if (range.min !== undefined && range.max !== undefined && range.min > range.max) continue
      if (range.min !== undefined || range.max !== undefined) values[descriptor.key] = range
    } else {
      const value = decoded[`filters.${descriptor.key}`]
      if (typeof value === 'string' && value) values[descriptor.key] = value
    }
  }
  return { values, errors: [] }
}

/* ── значения для связок ───────────────────────────────────────────── */

/** Значения фильтров «как из адреса»: путь поля → список значений. */
export type CatalogFilterValueMap = Readonly<Record<string, readonly string[]>>

/**
 * Нарушение связки в картине панели: что столкнулось, почему и что из-за
 * этого не применяется. Считает `catalogFilterViolations`.
 */
export type CatalogFilterViolation = {
  /** Имя связки: `search-with-latest` (правило схемы) или `contradictory-modes`. */
  id: string
  /** Человекочитаемая причина — её показывает интерфейс. */
  message: string
  /** Канонические ключи столкнувшихся значений: `filters.genres.not=133`. */
  keys: readonly string[]
  /**
   * Что не применяется из-за связки: `'q'` — поиск, `{ field }` — фильтр схемы.
   * Пусто — сочетание просто невозможно (deny-safe нечего отбрасывать: форма
   * такое не пропускает, а источник честно вернёт пустую выдачу).
   */
  drop?: 'q' | { field: string }
}

/** Значения из адреса/extra → карта путей (то, что читают связки). */
export function catalogFilterValueMap(source: Record<string, unknown> | undefined): CatalogFilterValueMap {
  const out: Record<string, readonly string[]> = {}
  for (const [path, raw] of Object.entries(source ?? {})) {
    if (!path.startsWith(FILTER_KEY_PREFIX) || !parseCatalogFilterPath(path)) continue
    const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [raw]
    const items = list
      .map((item) => String(item ?? '').trim())
      .filter((item) => item.length > 0 && item.length <= 120)
    if (items.length) out[path] = items
  }
  return out
}

/** Сработавшие связки схемы при значениях-путях (`filters.status` → список). */
export type CatalogRuleState = {
  /** Все сработавшие связки в порядке схемы. */
  fired: readonly CatalogFilterRule[]
  /** Ключ поля → последняя сработавшая связка, которая его снимает. */
  fields: ReadonlyMap<string, CatalogFilterRule>
  /** Последняя сработавшая связка, запрещающая поиск. */
  search?: CatalogFilterRule
}

/**
 * Связки схемы при текущих значениях — тем же условием формы, что гасит поля
 * (`matchesCondition`): серверная защита источника, запрет поиска и картина
 * панели не могут разойтись с живой формой.
 */
export function catalogRuleState(
  schema: CatalogFilterSchema,
  values: Readonly<Record<string, unknown>>,
): CatalogRuleState {
  const fired = (schema.rules ?? []).filter((rule) => matchesCondition(ruleCondition(schema, rule), values))
  const fields = new Map<string, CatalogFilterRule>()
  let search: CatalogFilterRule | undefined
  for (const rule of fired) {
    if (rule.drop === 'q') search = rule
    else fields.set(rule.drop.field, rule)
  }
  return { fired, fields, ...(search ? { search } : {}) }
}

/**
 * Пояснения панели: сработавшие связки схемы и противоречия режимов.
 * Противоречие (одно значение в «все из» и в «кроме») связка не объявляет —
 * оно СЛЕДУЕТ из смысла. Это подсказка, а не запрет: поле не гаснет, источник
 * ничего не отбрасывает — честно вернёт пусто. Ключи — канонические:
 * `filters.status=anons`, `filters.genres.not=133`.
 */
export function catalogFilterViolations(
  schema: CatalogFilterSchema,
  map: CatalogFilterValueMap,
): CatalogFilterViolation[] {
  const out: CatalogFilterViolation[] = catalogRuleState(schema, map).fired.map((rule) => ({
    id: rule.id,
    message: rule.reason,
    keys: rule.when.map((condition) =>
      condition.value === undefined ? `filters.${condition.field}` : `filters.${condition.field}=${condition.value}`),
    drop: rule.drop === 'q' ? 'q' : { field: rule.drop.field },
  }))
  for (const field of schema.fields) {
    const modes = field.modes ?? []
    if (!modes.includes('and') || !modes.includes('not')) continue
    const required = map[`filters.${field.key}.and`] ?? []
    for (const value of new Set(map[`filters.${field.key}.not`] ?? [])) {
      if (!required.includes(value)) continue
      const name = field.options?.find((option) => option.value === value)?.label ?? value
      out.push({
        id: 'contradictory-modes',
        message: `«${field.label}»: «${name}» выбрано и в «все из», и в «кроме» — выдача будет пустой`,
        keys: [`filters.${field.key}.and=${value}`, `filters.${field.key}.not=${value}`],
      })
    }
  }
  return out
}
