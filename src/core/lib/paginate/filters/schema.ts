/**
 * Схема фильтров источника: типы, проверка схемы (`validateCatalogFilterSchema`),
 * имена полей формы и предел опций (полный список / обрезка для пути без JS).
 */
import { DEV } from 'esm-env'
import { modes, bounds } from './internal'

/** `and` — все значения, `or` — любое, `not` — исключение (красные чипы). */
export type CatalogFilterMode = 'and' | 'or' | 'not'

/** Вариант значения фильтра: значение, подпись и признак «только с JS». */
export type CatalogFilterOption = {
  value: string
  label: string
  count?: number
  /**
   * Значение недоступно: гасится в списке и не может быть выбрано заново
   * (выборка при этом не чистится — см. модель панели).
   */
  disabled?: boolean
}

/** Поле фильтра в схеме: ключ, подпись, вид контрола и варианты. */
export type CatalogFilterField = {
  key: string
  label: string
  type: 'multiselect' | 'select' | 'text' | 'number'
  options?: readonly CatalogFilterOption[]
  modes?: readonly CatalogFilterMode[]
  min?: number
  max?: number
  maxSelections?: number
  /**
   * Сколько опций скрыто аварийной деградацией (см. `capCatalogFilterOptions`):
   * справочник длиннее `CATALOG_FILTER_OPTIONS_LIMIT`, поле несёт top-N по
   * частоте, остальные доступны только через фильтрацию по значению, если
   * клиент знает его извне. Выставляется сборщиком схемы. Обычный длинный
   * справочник (студии, ~2000) сюда не попадает: он едет целиком, а короче
   * становится только список без JS (`CATALOG_FILTER_NOJS_OPTIONS`).
   */
  optionsTruncated?: number
  /**
   * Какие границы диапазона показывает числовое поле. По умолчанию обе
   * (`['min','max']` — два инпута «от/до»); поле вроде «Эпизоды» может
   * объявить только `['max']` — единственный инпут «до».
   */
  bounds?: readonly ('min' | 'max')[]
}

/**
 * Условие связки: поле схемы (и, необязательно, конкретное значение его опции).
 * Без `value` условие означает «поле заполнено любым непустым значением».
 */
export type CatalogFilterCondition = {
  field: string
  value?: string
}

/**
 * Связка схемы — то, что в каталоге НЕЛЬЗЯ сочетать. Схема отвечает не только
 * за поля, но и за совместимость: «поиск здесь не работает», «эти фильтры
 * вместе не дают выдачи». Форма связки одна и та же для всех случаев:
 *
 *   когда выполнены ВСЕ условия `when` — `drop` НЕ ПРИМЕНЯЕТСЯ.
 *
 * `drop: 'q'` — это поиск (поле запроса), `drop: { field }` — фильтр схемы.
 * Так связка описывает и запрет поиска под фильтром, и несовместимость двух
 * фильтров (для API, который на такую пару честно отдаёт пустую выдачу),
 * и UI получает из неё не «магический флаг», а причину (`reason`).
 */
export type CatalogFilterRule = {
  /** Имя связки для UI/логов: `search-with-latest`. */
  id: string
  when: readonly CatalogFilterCondition[]
  drop: 'q' | { field: string }
  /** Человекочитаемая причина: её показывает интерфейс. */
  reason: string
  /**
   * Свой текст под выключенным полем вместо словарного: шаблон с
   * подстановками `{field}`, `{blockers}`, `{reason}` (см. `DisableRule.message`).
   */
  message?: string
}

/** Схема фильтров источника: поля, связки, версия и время сборки. */
export type CatalogFilterSchema = {
  source: string
  version: number
  fields: readonly CatalogFilterField[]
  /**
   * Связки (этап 3): совместимость фильтров между собой и с поиском.
   * Необязательны — схема без связок честна и работает как раньше.
   */
  rules?: readonly CatalogFilterRule[]
  /**
   * Метка сборки значений: когда справочники источника прочитаны живьём.
   * Ставит сборщик схемы (зона источника); клиент по ней видит «свежесть».
   */
  builtAt?: string
}

const types = new Set<CatalogFilterField['type']>(['multiselect', 'select', 'text', 'number'])

/** Границы числового фильтра: `filters.<key>.min` / `filters.<key>.max`. */
export type CatalogFilterBound = 'min' | 'max'

/** Имена полей формы для одного описания схемы: `filters.<key>[.<mode>|.<bound>]`. */
export function catalogFilterFieldNames(descriptor: CatalogFilterField): string[] {
  if (descriptor.type === 'multiselect')
    return (descriptor.modes ?? ['or']).map((mode) => `filters.${descriptor.key}.${mode}`)
  // Числовой параметр — диапазон: числовые инпуты «от» и/или «до»
  // (поле может объявить только одну границу, например «Эпизоды · до»).
  if (descriptor.type === 'number')
    return (descriptor.bounds ?? bounds).map((bound) => `filters.${descriptor.key}.${bound}`)
  return [`filters.${descriptor.key}`]
}

/**
 * Имя схемы/поля: правило канона (до 96 символов, сегменты через `.:`), а не
 * правило имён формы b1: здесь проверяются КЛЮЧИ СХЕМЫ (данные источника), а
 * не имена полей разметки. Их совместимость с политикой формы проверяет
 * `defineForm` описания приложения (`formParams().fields` даёт имена).
 */
export function catalogFilterSafeName(name: string): boolean {
  return (
    /^[a-zA-Z][a-zA-Z0-9_.:-]{0,95}$/.test(name) &&
    name.split(/[.:]/).every((part) => !!part && !['__proto__', 'prototype', 'constructor'].includes(part))
  )
}

function assertLimit(value: unknown, name: string): asserts value is number | undefined {
  if (value !== undefined && (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 10000)) {
    throw new Error(`${name} must be an integer from 0 to 10000`)
  }
}

/**
 * Граница числового фильтра — фактический min/max значения В БАЗЕ источника:
 * может быть дробной (оценка 5.24) и большой (год 1989), поэтому правило
 * мягче, чем у лимитов выборки, — конечное число в разумных пределах.
 */
function assertBound(value: unknown, name: string): asserts value is number | undefined {
  if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e9)) {
    throw new Error(`${name} must be a finite number`)
  }
}

/**
 * Связки схемы, deny-safe: каждая проверяется целиком, наружу уходит только
 * осмысленное. Условия ссылаются на ПОЛЯ схемы — ссылка на несуществующее поле
 * это ошибка схемы, а не «правило, которое иногда не срабатывает».
 */
function validateCatalogFilterRules(
  input: unknown,
  keys: ReadonlySet<string>,
): CatalogFilterRule[] | undefined {
  if (input === undefined) return undefined
  if (!Array.isArray(input)) throw new Error('Invalid catalog filter rules')
  const ids = new Set<string>()
  return input.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid catalog filter rule')
    const rule = raw as CatalogFilterRule
    if (typeof rule.id !== 'string' || !catalogFilterSafeName(rule.id) || ids.has(rule.id))
      throw new Error('Invalid or duplicate catalog filter rule id')
    if (typeof rule.reason !== 'string' || !rule.reason.trim() || rule.reason.length > 200)
      throw new Error('Invalid catalog filter rule reason')
    if (rule.message !== undefined && (typeof rule.message !== 'string' || !rule.message.trim() || rule.message.length > 200))
      throw new Error('Invalid catalog filter rule message')
    if (!Array.isArray(rule.when) || rule.when.length === 0 || rule.when.length > 8)
      throw new Error('Invalid catalog filter rule conditions')
    const when = rule.when.map((condition) => {
      if (!condition || typeof condition !== 'object') throw new Error('Invalid catalog filter rule condition')
      const field = condition.field
      if (typeof field !== 'string' || !keys.has(field))
        throw new Error('Catalog filter rule condition references an unknown field')
      if (condition.value !== undefined && (typeof condition.value !== 'string' || !condition.value))
        throw new Error('Invalid catalog filter rule condition value')
      return { field, ...(condition.value !== undefined ? { value: condition.value } : {}) }
    })
    const drop = rule.drop
    const normalizedDrop: CatalogFilterRule['drop'] =
      drop === 'q'
        ? 'q'
        : drop && typeof drop === 'object' && typeof (drop as { field?: unknown }).field === 'string' &&
            keys.has((drop as { field: string }).field)
          ? { field: (drop as { field: string }).field }
          : (() => {
              throw new Error('Catalog filter rule drops an unknown field')
            })()
    ids.add(rule.id)
    return {
      id: rule.id, when, drop: normalizedDrop, reason: rule.reason.trim(),
      ...(rule.message !== undefined ? { message: rule.message.trim() } : {}),
    }
  })
}

/** Проверяет схему фильтров с сервера и бросает на мусоре. */
export function validateCatalogFilterSchema(input: unknown): CatalogFilterSchema {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid catalog filter schema')
  const value = input as Partial<CatalogFilterSchema>
  if (typeof value.source !== 'string' || !catalogFilterSafeName(value.source)) throw new Error('Invalid catalog filter source')
  if (typeof value.version !== 'number' || !Number.isInteger(value.version) || value.version < 1) throw new Error('Invalid catalog filter version')
  if (!Array.isArray(value.fields) || value.fields.length > 64) throw new Error('Invalid catalog filter fields')

  const keys = new Set<string>()
  const fields = value.fields.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid catalog filter field')
    const fieldValue = raw as CatalogFilterField
    if (!catalogFilterSafeName(fieldValue.key) || keys.has(fieldValue.key)) throw new Error('Invalid or duplicate catalog filter key')
    if (typeof fieldValue.label !== 'string' || !fieldValue.label.trim() || fieldValue.label.length > 80)
      throw new Error('Invalid catalog filter label')
    if (!types.has(fieldValue.type)) throw new Error('Invalid catalog filter type')
    keys.add(fieldValue.key)

    const selectedModes: CatalogFilterMode[] = fieldValue.modes ? [...fieldValue.modes] : ['or']
    if (selectedModes.some((mode) => !modes.includes(mode)) || new Set(selectedModes).size !== selectedModes.length)
      throw new Error('Invalid catalog filter modes')
    // Числовое поле несёт границы значений базы (могут быть дробными),
    // у остальных min/max — целочисленные лимиты длины/выбора.
    if (fieldValue.type === 'number') {
      assertBound(fieldValue.min, 'min')
      assertBound(fieldValue.max, 'max')
    } else {
      assertLimit(fieldValue.min, 'min')
      assertLimit(fieldValue.max, 'max')
    }
    assertLimit(fieldValue.maxSelections, 'maxSelections')
    if (fieldValue.min !== undefined && fieldValue.max !== undefined && fieldValue.min > fieldValue.max)
      throw new Error('Catalog filter min exceeds max')

    // Какие границы рисует числовое поле: по умолчанию обе («от» и «до»).
    let selectedBounds: CatalogFilterBound[] | undefined
    if (fieldValue.type === 'number') {
      selectedBounds = fieldValue.bounds ? [...fieldValue.bounds] : [...bounds]
      if (
        !selectedBounds.length ||
        selectedBounds.some((b) => !bounds.includes(b)) ||
        new Set(selectedBounds).size !== selectedBounds.length
      )
        throw new Error('Invalid catalog filter bounds')
    }

    let options: CatalogFilterOption[] | undefined
    if (fieldValue.type === 'select' || fieldValue.type === 'multiselect') {
      if (
        !Array.isArray(fieldValue.options) ||
        fieldValue.options.length === 0 ||
        fieldValue.options.length > CATALOG_FILTER_OPTIONS_LIMIT
      )
        throw new Error('Invalid catalog filter options')
      const optionValues = new Set<string>()
      options = fieldValue.options.map((option) => {
        if (!option || typeof option.value !== 'string' || !option.value || option.value.length > 120)
          throw new Error('Invalid catalog filter option value')
        if (optionValues.has(option.value)) throw new Error('Duplicate catalog filter option')
        if (typeof option.label !== 'string' || !option.label.trim() || option.label.length > 160)
          throw new Error('Invalid catalog filter option label')
        if (option.count !== undefined && (!Number.isInteger(option.count) || option.count < 0))
          throw new Error('Invalid catalog filter option count')
        if (option.disabled !== undefined && typeof option.disabled !== 'boolean')
          throw new Error('Invalid catalog filter option disabled')
        optionValues.add(option.value)
        // disabled пишем только при true: разряженный объект, без false-шума.
        return option.disabled
          ? { value: option.value, label: option.label, count: option.count, disabled: true }
          : { value: option.value, label: option.label, count: option.count }
      })
    }

    if (
      fieldValue.optionsTruncated !== undefined &&
      (!Number.isInteger(fieldValue.optionsTruncated) || fieldValue.optionsTruncated < 0)
    )
      throw new Error('Invalid catalog filter optionsTruncated')

    return {
      key: fieldValue.key,
      label: fieldValue.label,
      type: fieldValue.type,
      options,
      modes: selectedModes,
      min: typeof fieldValue.min === 'number' ? fieldValue.min : undefined,
      max: typeof fieldValue.max === 'number' ? fieldValue.max : undefined,
      maxSelections: typeof fieldValue.maxSelections === 'number' ? fieldValue.maxSelections : undefined,
      optionsTruncated:
        typeof fieldValue.optionsTruncated === 'number' ? fieldValue.optionsTruncated : undefined,
      bounds: selectedBounds,
    }
  })
  if (value.builtAt !== undefined && (typeof value.builtAt !== 'string' || Number.isNaN(Date.parse(value.builtAt))))
    throw new Error('Invalid catalog filter builtAt')
  const fieldKeys = new Set(fields.map((descriptor) => descriptor.key))
  const rules = validateCatalogFilterRules(value.rules, fieldKeys)
  return {
    source: value.source!,
    version: value.version!,
    fields,
    ...(rules ? { rules } : {}),
    ...(value.builtAt !== undefined ? { builtAt: value.builtAt } : {}),
  }
}

/**
 * Предел числа опций одного поля схемы — защита от гигантских форм, а не
 * размер показа. Сверх него схему строить/валидировать нельзя, но транспорт
 * данных падать НЕ должен — вместо throw сборщик деградирует поле через
 * `capCatalogFilterOptions`. Справочник студий (~2000) в предел помещается
 * и едет целиком: с JS список ищет по всем значениям.
 */
export const CATALOG_FILTER_OPTIONS_LIMIT = 5000

/**
 * Сколько опций показывает список БЕЗ JavaScript (решение владельца: «с JS —
 * все, без JS — ограниченный список»). Без JS список — нативный `<select>` из
 * серверной разметки: 2000 строк в нём не найти перебором, и каждая весит в
 * HTML. Показываются первые N по порядку схемы (самые частые — см.
 * `capCatalogFilterOptions`) плюс всё уже выбранное. Значения сверх показа
 * при этом законны: сервер проверяет выбор по полному списку.
 */
export const CATALOG_FILTER_NOJS_OPTIONS = 200

/**
 * Опции поля — ДОВЕРЕННЫЙ allowlist, только пока показ не обрезан лимитом
 * (2026-10-07, замечание сверки): у поля с `optionsTruncated` часть настоящих
 * значений источника в схему не попала, поэтому «нет в показанных опциях» ещё
 * не значит «чужое значение». Такому полю синтаксис проверяем, а не состав, и
 * решает источник — он один знает свой справочник и честно отвечает (`dropped`).
 * Молчаливой фильтрации нет ни на одной стороне: значение либо применяется, либо
 * названо в отчёте источника.
 */
export function catalogFilterOptionsAreComplete(descriptor: CatalogFilterField): boolean {
  return !!descriptor.options && !descriptor.optionsTruncated
}

/** Частые — первыми; при равной частоте (и без неё) — по подписи. */
function byPopularity(a: CatalogFilterOption, b: CatalogFilterOption): number {
  const byCount = (b.count ?? 0) - (a.count ?? 0)
  return byCount !== 0 ? byCount : a.label.localeCompare(b.label, 'ru') || a.value.localeCompare(b.value)
}

/**
 * Длинные справочники схемы — к показу:
 *  • поле длиннее `rankFrom` (по умолчанию — показ без JS) упорядочивается по
 *    частоте (`count`), при равной — по подписи: первые N и есть список без JS,
 *    и в нём оказываются самые нужные значения, а не первые по алфавиту или id;
 *  • поле длиннее `limit` ещё и обрезается до top-`limit` (аварийная
 *    деградация), число скрытых опций пишется в `optionsTruncated`. Принцип
 *    (план улучшения §3.12): размер схемы не умеет ронять транспорт данных
 *    никогда; throw-путь валидатора остаётся для не-размерных нарушений.
 * Короткие поля не трогаются: их порядок задаёт источник.
 */
export function capCatalogFilterOptions(
  schema: CatalogFilterSchema,
  limit = CATALOG_FILTER_OPTIONS_LIMIT,
  rankFrom = CATALOG_FILTER_NOJS_OPTIONS,
): CatalogFilterSchema {
  let truncated = 0
  const fields = schema.fields.map((descriptor) => {
    if (
      (descriptor.type !== 'select' && descriptor.type !== 'multiselect') ||
      !descriptor.options ||
      descriptor.options.length <= Math.min(limit, rankFrom)
    )
      return descriptor
    const ranked = [...descriptor.options].sort(byPopularity)
    if (ranked.length <= limit) return { ...descriptor, options: ranked }
    truncated += ranked.length - limit
    return { ...descriptor, options: ranked.slice(0, limit), optionsTruncated: ranked.length - limit }
  })
  if (truncated > 0 && DEV) {
    console.warn(`[catalog-filter] ${schema.source}: скрыто ${truncated} опций сверх лимита ${limit} (деградация схемы)`)
  }
  return { ...schema, fields }
}
