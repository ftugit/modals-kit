/**
 * Значения и связки: серверная проверка значений (`validateCatalogFilterValues`),
 * сработавшие связки (`catalogRuleState`) и нарушения (`catalogFilterViolations`).
 * Проверяет только форма; её описание даёт приложение (`CatalogFilterDescribe`).
 */
import {
  decode,
  disabledState,
  makeRenderer,
  normalizeErrors,
  ru,
  validateForm,
  type EntrySource,
  type FormDescription,
  type MessageDictionary,
  matchesCondition,
} from '#lib/form/index.js'
import { FILTER_KEY_PREFIX } from '../source'
import { validateCatalogFilterSchema, type CatalogFilterMode, type CatalogFilterRule, type CatalogFilterSchema } from './schema'
import { parseCatalogFilterPath } from './url'
import { catalogFilterFormData, ruleCondition } from './form'
import type { CatalogFilterDescribe } from './params'

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
 * Разбор и проверка значений фильтров: `catalogFilterFormData` → типы полей
 * (`decode`) → правила формы (`validateForm`) по описанию приложения. Один
 * код-путь с формой в браузере: невалидное значение не «доедет» до источника
 * ни при каком входе. Поле, которого нет в описании, не применяется — его нет
 * и в интерфейсе. Ошибка любого поля отклоняет набор целиком: частичного
 * применения нет. `failed` — где и что не прошло (для причины у ключа).
 */
export function validateCatalogFilterValues(
  schemaInput: unknown,
  raw: EntrySource,
  describe: CatalogFilterDescribe,
): { values: CatalogFilterValues; errors: readonly string[]; failed: readonly { path?: string; code: string }[] } {
  const schema = validateCatalogFilterSchema(schemaInput)
  const definition = describe(schema)
  const { values: decoded, structural } = decode(raw, definition)
  const errors = validateForm(definition, decoded, { structural })
  if (errors.length)
    return {
      values: {},
      errors: errors.map((error) => error.code),
      failed: errors.map((error) => ({ ...(error.path ? { path: error.path } : {}), code: error.code })),
    }

  const values: CatalogFilterValues = {}
  for (const descriptor of schema.fields) {
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
  return { values, errors: [], failed: [] }
}

/* ── значения для связок ───────────────────────────────────────────── */

/** Значения фильтров «как из адреса»: путь поля → список значений. */
export type CatalogFilterValueMap = Readonly<Record<string, readonly string[]>>

/**
 * Нарушение в картине панели — ошибка формы фильтров над ПРИМЕНЁННЫМ набором:
 * связка (`link.blocked`; сработавшая — и при пустом поле), перевёрнутый
 * диапазон (`notAbove`), одно значение в «все из» и в «кроме» (`noOverlap`). Без JS браузер применил адрес как есть, и
 * панель называет, почему источник набор не принял.
 */
export type CatalogFilterViolation = {
  /** Код ошибки формы: `link.blocked`, `notAbove`, `noOverlap`, … */
  id: string
  /** Текст из словаря формы: описание → приложение → пакет. */
  message: string
  /** Путь поля без адресного слоя: `filters.genres.not`. */
  keys: readonly string[]
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
 * Пояснения панели: применённый набор (`extra`) проверяется той же формой,
 * что в браузере и на сервере. `prefix` — адресный слой имён описания
 * (`page.`), `messages` — словарь приложения.
 */
export function catalogFilterViolations(
  description: FormDescription,
  schema: CatalogFilterSchema,
  extra: Record<string, unknown> | undefined,
  opts: { prefix?: string; messages?: MessageDictionary } = {},
): CatalogFilterViolation[] {
  const prefix = opts.prefix ?? ''
  const data = new FormData()
  for (const [path, value] of catalogFilterFormData(schema, extra ?? {}).entries()) {
    if (description.byName[prefix + path]) data.append(prefix + path, value)
  }
  const render = makeRenderer([description.messages, opts.messages ?? {}, ru], description.policy.interpolate)
  const { values, structural } = decode(data, description)
  const out: CatalogFilterViolation[] = normalizeErrors(validateForm(description, values, { structural }), render)
    .filter((error) => error.path)
    .map((error) => ({ id: error.code, message: error.message ?? error.code, keys: [error.path!.slice(prefix.length)] }))
  // Сработавшая связка названа и при ПУСТОМ поле: без JS человек видит, почему
  // поле недоступно, не раскрывая форму. Текст тот же, что под полем (R1), —
  // у заполненного поля он уже есть ошибкой и второй раз не пишется.
  const seen = new Set(out.map((violation) => violation.message))
  for (const field of description.fields) {
    const link = disabledState(description, field, values, render)
    if (!link?.reason || seen.has(link.reason)) continue
    seen.add(link.reason)
    out.push({ id: 'link.blocked', message: link.reason, keys: [field.name.slice(prefix.length)] })
  }
  return out
}
