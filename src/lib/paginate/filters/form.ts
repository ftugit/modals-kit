/**
 * Общие помощники фильтров поверх `#lib/form`: политика формы, список допустимых
 * значений, связки схемы → `disabledWhen`, снятие значений по умолчанию и
 * `extra` → FormData. Поля формы описывает приложение (`formParams`).
 */
import {
  defaultPolicy,
  type FormPolicy,
  type ValidatorRef,
  type DisableRule,
  type FieldCondition,
} from '#lib/form/index.js'
import { catalogFilterFieldNames, CATALOG_FILTER_OPTIONS_LIMIT, catalogFilterOptionsAreComplete, type CatalogFilterField, type CatalogFilterRule, type CatalogFilterSchema } from './schema'
import { parseCatalogFilterPath } from './url'

/**
 * Политика формы фильтров: единственное отличие от умолчательной — предел
 * числа вариантов поднят до предела СХЕМЫ (5000), потому что гигантские
 * справочники (студии) приходят из живого источника и уже деградированы
 * `capCatalogFilterOptions`; второй, более низкий предел отсекал бы их молча.
 */
export function catalogFilterPolicy(): FormPolicy {
  return {
    ...defaultPolicy,
    limits: { ...defaultPolicy.limits, options: CATALOG_FILTER_OPTIONS_LIMIT },
  }
}

/**
 * Правило-allowlist по опциям поля — та же семантика, что у канонной формы:
 * значение вне `options` не проходит, ПУСТОЕ значение и пустой список — не
 * ошибка (иначе незаполненный мультивыбор «валился» бы сам по себе).
 * Реализовано функцией, а не именем из реестра: реестровый `oneOf` — скалярный.
 */
export function optionsAllowlist(values: readonly string[]): ValidatorRef {
  const allowed = new Set(values)
  return (value: unknown) => {
    const list = Array.isArray(value) ? value : [value]
    const foreign = list.some(
      (item) => typeof item === 'string' && item !== '' && !allowed.has(item),
    )
    return foreign ? { code: 'oneOf' } : null
  }
}

/**
 * Связка схемы → условие формы. Идентификатор условия — КЛЮЧ поля схемы, а
 * форма видит пути (`filters.genres.and`, `filters.score.min`): поле заполнено,
 * если заполнен любой его путь; значение есть, если оно на любом пути.
 * `prefix` — адресный слой имён живой формы (`page.`); сервер и панель считают
 * по путям без префикса. Один перевод на форму, поиск и пояснения панели.
 */
export function ruleCondition(schema: CatalogFilterSchema, rule: CatalogFilterRule, prefix = ''): FieldCondition {
  const pathsOf = new Map(schema.fields.map((field) => [field.key, catalogFilterFieldNames(field)]))
  const all = rule.when.map((condition): FieldCondition => {
    const any = (pathsOf.get(condition.field) ?? []).map((path): FieldCondition =>
      condition.value === undefined
        ? { field: prefix + path, filled: true }
        : { field: prefix + path, includes: condition.value })
    return any.length === 1 ? any[0]! : { any }
  })
  return all.length === 1 ? all[0]! : { all }
}

/**
 * Правила выключения поля схемы — у КАЖДОГО его пути (режим/граница): гаснет
 * поле целиком, отказ касается поля, а не одного режима. `blockers` здесь —
 * КЛЮЧИ схемы: подписи им ставит `formParams().fields` из описания
 * приложения. Текст — словаря формы. `drop: 'q'` сюда не входит: поиск живёт
 * вне формы (`catalogRuleState`).
 */
export function disableRulesFor(schema: CatalogFilterSchema, descriptor: CatalogFilterField, prefix: string): DisableRule[] {
  return (schema.rules ?? [])
    .filter((rule) => rule.drop !== 'q' && rule.drop.field === descriptor.key)
    .map((rule) => ({
      when: ruleCondition(schema, rule, prefix),
      reason: rule.reason,
      blockers: rule.when.map((condition) => condition.field),
      label: descriptor.label,
      ...(rule.message !== undefined ? { message: rule.message } : {}),
    }))
}

/**
 * Значение числовой границы, равное границе БАЗЫ, ничего не сужает: это
 * дефолт предзаполненного инпута, в канонический адрес он не попадает.
 * Применяется к значениям формы ПЕРЕД расчётом адреса — и на клиенте
 * (onSuccess), и на сервере (redirect), чтобы адрес был один и тот же.
 */
export function stripDefaultCatalogFilterValues(
  schema: CatalogFilterSchema,
  values: Record<string, unknown>,
): Record<string, string[] | string | undefined> {
  const byKey = new Map(schema.fields.map((descriptor) => [descriptor.key, descriptor]))
  const out: Record<string, string[] | string | undefined> = {}
  for (const [path, raw] of Object.entries(values)) {
    const parsed = parseCatalogFilterPath(path)
    if (!parsed) continue
    const descriptor = byKey.get(parsed.key)
    if (descriptor?.type === 'number' && parsed.bound) {
      // Форма читает каждый нативный контрол через FormData.getAll(), поэтому
      // даже одиночная числовая граница приходит как string[]. Принимаем ровно
      // один элемент; несколько значений для одного number-поля неоднозначны.
      const candidate = Array.isArray(raw) ? (raw.length === 1 ? raw[0] : undefined) : raw
      const num =
        typeof candidate === 'number'
          ? candidate
          : typeof candidate === 'string' && candidate.trim() !== ''
            ? Number(candidate)
            : undefined
      if (num === undefined || !Number.isFinite(num)) continue
      const edge = parsed.bound === 'min' ? descriptor.min : descriptor.max
      if (edge !== undefined && num === edge) continue // дефолт — не фильтр
      out[path] = String(num)
      continue
    }
    out[path] = raw as string[] | string | undefined
  }
  return out
}

/**
 * `extra` пагинатора (или любой другой источник записей) → FormData формы
 * фильтров, deny-safe.
 *
 * Значения приходят из адреса (`?page.filters.genres.or=Драма,Комедия`), поэтому
 * здесь отбрасывается всё, чего нет в опциях схемы: неизвестное значение должно
 * игнорироваться, а не ронять разбор исключением «Invalid catalog filter values».
 */
export function catalogFilterFormData(
  schema: CatalogFilterSchema,
  source: Record<string, unknown>,
): FormData {
  const form = new FormData()
  const read = (key: string): string[] => {
    const value = source[key]
    // extra — типизированный контракт: адресный слой шлёт НАСТОЯЩИЕ числа для
    // number-границ, а не только строки. Принимать оба вида, иначе фильтр из
    // адреса молча не применяется.
    const list = Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? value.split(',')
        : typeof value === 'number' && Number.isFinite(value)
          ? [value]
          : []
    return list
      .map((item) => String(item).trim())
      .filter((item) => item.length > 0 && item.length <= 120)
  }

  for (const descriptor of schema.fields) {
    const allowed = catalogFilterOptionsAreComplete(descriptor)
      ? new Set((descriptor.options ?? []).map((option) => option.value))
      : null
    for (const name of catalogFilterFieldNames(descriptor)) {
      if (descriptor.type === 'number') {
        // Числовая граница из адреса: только конечное число в пределах
        // min/max схемы (границы значений базы); мусор отбрасывается молча.
        const raw = read(name)[0]
        const parsed = raw === undefined ? NaN : Number(raw)
        if (
          Number.isFinite(parsed) &&
          (descriptor.min === undefined || parsed >= descriptor.min) &&
          (descriptor.max === undefined || parsed <= descriptor.max)
        ) {
          form.set(name, String(parsed))
        }
        continue
      }
      const values = read(name).filter((item) => !allowed || allowed.has(item))
      if (descriptor.type === 'multiselect') {
        for (const item of values) form.append(name, item)
      } else if (values.length) {
        form.set(name, values[0])
      }
    }
  }
  return form
}
