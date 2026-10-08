/**
 * Схема фильтров каталога → определение формы (валидатор) → адрес.
 *
 * Модуль изоморфный намеренно: и сервер, и браузер обязаны строить ОДНО и то же
 * `defineForm`-определение из схемы источника. Раньше компиляция жила только в
 * `server/search/catalog-filter.ts`, поэтому клиент рисовал инпуты «на глаз» по
 * JSON-схеме и не знал ни про `field.*`, ни про правила валидатора: левые опции
 * отсекались лишь на сервере, а разметка расходилась с описанием поля.
 *
 * Здесь же — единственный формат адреса каталога (`?page.filters.<поле>[.<режим>]`),
 * чтобы форма, чипы активных фильтров и серверный redirect не расходились.
 *
 * Порт канона (`ftugit/SolidHono@shiki-final`, `src/lib/search/catalog-filter.ts`)
 * без упрощений: имена полей, правила валидатора и формат адреса сохранены
 * посимвольно; заменено только то, что относится к ЧУЖОЙ форме (канон собирал
 * определение на `@/lib/form/core`, здесь — на `$lib/form`), и добавлены связки
 * (`rules`, см. `./rules.ts`) — они часть схемы, как и поля.
 */
import {
  decode,
  defaultPolicy,
  defineForm,
  field,
  initialState,
  validateForm,
  type EntrySource,
  type FieldDraft,
  type FormDescription,
  type FormPolicy,
  type FormState,
  type ValidatorRef,
} from '$lib/form'

/** `and` — все значения, `or` — любое, `not` — исключение (красные чипы). */
export type CatalogFilterMode = 'and' | 'or' | 'not'

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
   * Сколько опций скрыто деградацией (см. `capCatalogFilterOptions`): поле
   * показывает top-N по частоте, остальные доступны только через фильтрацию
   * по значению, если клиент знает его извне. Выставляется сборщиком схемы.
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
}

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

const modes: readonly CatalogFilterMode[] = ['and', 'or', 'not']
const types = new Set<CatalogFilterField['type']>(['multiselect', 'select', 'text', 'number'])

/** Границы числового фильтра: `filters.<key>.min` / `filters.<key>.max`. */
export type CatalogFilterBound = 'min' | 'max'
const bounds: readonly CatalogFilterBound[] = ['min', 'max']

/** Человекочитаемое имя режима для подписи поля и чипа. */
export const CATALOG_FILTER_MODE_LABEL: Record<CatalogFilterMode, string> = {
  and: 'все из',
  or: 'любое из',
  not: 'кроме',
}

/** Подпись границы числового фильтра («Оценка · от»). */
export const CATALOG_FILTER_BOUND_LABEL: Record<CatalogFilterBound, string> = {
  min: 'от',
  max: 'до',
}

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

/** Разбор имени поля обратно в ключ и режим/границу. */
export function parseCatalogFilterPath(
  path: string,
): { key: string; mode?: CatalogFilterMode; bound?: CatalogFilterBound } | undefined {
  if (!path.startsWith('filters.')) return undefined
  const rest = path.slice('filters.'.length)
  const dot = rest.lastIndexOf('.')
  if (dot > 0) {
    const suffix = rest.slice(dot + 1)
    if (modes.includes(suffix as CatalogFilterMode))
      return { key: rest.slice(0, dot), mode: suffix as CatalogFilterMode }
    if (bounds.includes(suffix as CatalogFilterBound))
      return { key: rest.slice(0, dot), bound: suffix as CatalogFilterBound }
  }
  return { key: rest }
}

/**
 * Имя схемы/поля: правило канона (до 96 символов, сегменты через `.:`), а не
 * правило имён формы b1: здесь проверяются КЛЮЧИ СХЕМЫ (данные источника), а
 * не имена полей разметки. Их совместимость с политикой формы проверяет
 * `compileCatalogFilterSchema` (там же, где строится определение).
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
    return { id: rule.id, when, drop: normalizedDrop, reason: rule.reason.trim() }
  })
}

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
      if (!Array.isArray(fieldValue.options) || fieldValue.options.length === 0 || fieldValue.options.length > 1000)
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
 * Предел числа опций одного поля схемы. Сверх него схему строить/валидировать
 * нельзя (защита от гигантских форм), но транспорт данных падать НЕ должен —
 * вместо throw сборщик деградирует поле через `capCatalogFilterOptions`.
 */
export const CATALOG_FILTER_OPTIONS_LIMIT = 1000

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

/**
 * Деградация oversized-полей: select/multiselect с числом опций > limit
 * обрезается до top-`limit` по частоте (`count`, без count — по алфавиту),
 * число скрытых опций пишется в `optionsTruncated`. Принцип (план улучшения
 * §3.12): размер схемы фильтров не умеет ронять транспорт данных никогда;
 * throw-путь валидатора остаётся только для не-размерных нарушений схемы.
 */
export function capCatalogFilterOptions(
  schema: CatalogFilterSchema,
  limit = CATALOG_FILTER_OPTIONS_LIMIT,
): CatalogFilterSchema {
  let truncated = 0
  const fields = schema.fields.map((descriptor) => {
    if (
      (descriptor.type !== 'select' && descriptor.type !== 'multiselect') ||
      !descriptor.options ||
      descriptor.options.length <= limit
    )
      return descriptor
    const ranked = [...descriptor.options].sort((a, b) => {
      const byCount = (b.count ?? 0) - (a.count ?? 0)
      return byCount !== 0 ? byCount : a.value.localeCompare(b.value)
    })
    truncated += descriptor.options.length - limit
    return { ...descriptor, options: ranked.slice(0, limit), optionsTruncated: descriptor.options.length - limit }
  })
  if (truncated > 0 && typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
    console.warn(`[catalog-filter] ${schema.source}: скрыто ${truncated} опций сверх лимита ${limit} (деградация схемы)`)
  }
  return { ...schema, fields }
}

/**
 * Политика формы фильтров: единственное отличие от умолчательной — предел
 * числа вариантов поднят до предела СХЕМЫ (1000), потому что гигантские
 * справочники (студии) приходят из живого источника и уже деградированы
 * `capCatalogFilterOptions`; второй, более низкий предел отсекал бы их молча.
 */
function catalogFilterPolicy(): FormPolicy {
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
function optionsAllowlist(values: readonly string[]): ValidatorRef {
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
 * Схема источника → определение формы. Опции поля становятся allowlist'ом
 * валидатора (как в каноне: `select`/`multiselect` отбраковывают значение,
 * которого нет в `options`), лимиты — правилами min/max. Одно определение
 * используют серверная форма, клиентская форма и `validateCatalogFilterValues`.
 */
export function compileCatalogFilterSchema(
  input: unknown,
  id = 'catalog-filters',
): {
  schema: CatalogFilterSchema
  definition: FormDescription
  paths: string[]
  /**
   * Дефолты числовых инпутов: инпут «от» предзаполняется минимальным, инпут
   * «до» — максимальным значением В БАЗЕ (value=min / value=max). Значение,
   * равное дефолту, ничего не сужает и в адрес не пишется.
   */
  defaults: Record<string, string>
} {
  const schema = validateCatalogFilterSchema(input)
  const fields: Record<string, FieldDraft<any>> = Object.create(null)
  const paths: string[] = []
  const defaults: Record<string, string> = {}

  for (const descriptor of schema.fields) {
    for (const name of catalogFilterFieldNames(descriptor)) {
      const parsed = parseCatalogFilterPath(name)
      const mode = parsed?.mode
      const bound = parsed?.bound
      const common = {
        // Режим/граница видны в подписи: «Жанры · кроме», «Оценка · от» —
        // читается и без JS.
        label: mode
          ? `${descriptor.label} · ${CATALOG_FILTER_MODE_LABEL[mode]}`
          : bound
            ? `${descriptor.label} · ${CATALOG_FILTER_BOUND_LABEL[bound]}`
            : descriptor.label,
        validate: [
          // У числового поля min/max схемы — границы значений БАЗЫ: валидатор
          // и HTML-атрибуты числового инпута получают их одинаково.
          ...(descriptor.min !== undefined ? [{ name: 'minValue', arg: descriptor.min }] : []),
          ...(descriptor.max !== undefined ? [{ name: 'maxValue', arg: descriptor.max }] : []),
          ...(descriptor.type === 'multiselect' && descriptor.maxSelections !== undefined
            ? [{ name: 'maxCount', arg: descriptor.maxSelections }]
            : []),
        ] as ValidatorRef[],
      }
      // Поля формы получают ПОЛНЫЕ подписи опций (label + disabled): их видит
      // FieldView, а allowlist строится только из значений.
      const options = descriptor.options ?? []
      // Allowlist — только при ПОЛНОМ показе опций: у обрезанного лимитом поля
      // настоящие значения источника могли не доехать, и «нет в списке» ещё не
      // значит «чужое значение» (решает источник, см. `catalogFilterOptionsAreComplete`).
      const list = catalogFilterOptionsAreComplete(descriptor)
        ? [...common.validate, optionsAllowlist(options.map((option) => option.value))]
        : common.validate
      fields[name] = descriptor.type === 'multiselect'
        ? field.multiselect({ ...common, options, validate: list })
        : descriptor.type === 'select'
          ? field.select({ ...common, options, validate: list })
          : descriptor.type === 'number'
            ? field.number(common)
            : field.text(common)
      paths.push(name)
      // value=min у инпута «от», value=max у инпута «до» (границы базы).
      if (bound === 'min' && descriptor.min !== undefined) defaults[name] = String(descriptor.min)
      if (bound === 'max' && descriptor.max !== undefined) defaults[name] = String(descriptor.max)
    }
  }

  return { schema, definition: defineForm({ id, fields, policy: catalogFilterPolicy() }), paths, defaults }
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
 * Значения фильтров из состояния пагинатора/адреса.
 * В `extra` они лежат строкой через запятую: `filters.genres.or=Драма,Комедия`.
 */
export function readCatalogFilterValues(source: Record<string, unknown> | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [key, raw] of Object.entries(source ?? {})) {
    if (!key.startsWith('filters.')) continue
    // extra — типизированный контракт (§ 3.1): числовая граница из адреса
    // приходит НАСТОЯЩИМ числом; оно такое же значение фильтра, как строка
    // (раньше число отбрасывалось — чип и счётчик теряли фильтр).
    const list = (
      Array.isArray(raw)
        ? raw
        : typeof raw === 'string'
          ? raw.split(',')
          : typeof raw === 'number' && Number.isFinite(raw)
            ? [raw]
            : []
    )
      .map((item) => String(item).trim())
      .filter((item) => item.length > 0 && item.length <= 120)
    if (list.length) out[key] = list
  }
  return out
}

/**
 * Значения фильтров из `search` роута: `paginatorSearch` отдаёт плоские ключи
 * с префиксом пагинатора (`page.filters.genres.or`), а форме и чипам нужны
 * имена полей (`filters.genres.or`).
 */
export function catalogFilterValuesFromSearch(
  search: Record<string, unknown> | undefined,
  prefix = 'page',
): Record<string, string[]> {
  const head = `${prefix}.`
  const stripped: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(search ?? {})) {
    if (key.startsWith(head)) stripped[key.slice(head.length)] = value
  }
  return readCatalogFilterValues(stripped)
}

export type ActiveCatalogFilter = {
  /** Имя поля формы: `filters.genres.not`. */
  path: string
  key: string
  mode?: CatalogFilterMode
  /** Граница числового фильтра («Оценка · от: 7»). */
  bound?: CatalogFilterBound
  value: string
  /** Подпись значения из схемы (если опция известна) или само значение. */
  label: string
  fieldLabel: string
  /** Режим `not`: значение исключено — чип красный. */
  excluded: boolean
  /** Значение отсутствует в опциях схемы (мусор из адреса). */
  unknown: boolean
  /**
   * Значение отсутствует В ПОКАЗАННЫХ опциях, но поле объявило `optionsTruncated`:
   * оно может быть настоящим (скрыто лимитом показа), поэтому и причина другая,
   * чем у мусора, — источник такое значение принимает.
   */
  hiddenByLimit?: boolean
}

/** Активные фильтры списком: по одному элементу на значение. */
export function activeCatalogFilters(
  schema: CatalogFilterSchema | undefined,
  values: Record<string, string[]>,
): ActiveCatalogFilter[] {
  const byKey = new Map((schema?.fields ?? []).map((descriptor) => [descriptor.key, descriptor]))
  const out: ActiveCatalogFilter[] = []
  for (const [path, list] of Object.entries(values)) {
    const parsed = parseCatalogFilterPath(path)
    if (!parsed) continue
    const descriptor = byKey.get(parsed.key)
    for (const value of list) {
      const option = descriptor?.options?.find((item) => item.value === value)
      const missing = !!descriptor?.options && !option
      const hiddenByLimit = missing && !!descriptor?.optionsTruncated
      out.push({
        path,
        key: parsed.key,
        mode: parsed.mode,
        bound: parsed.bound,
        value,
        label: option?.label ?? value,
        fieldLabel: descriptor?.label ?? parsed.key,
        excluded: parsed.mode === 'not',
        unknown: missing && !hiddenByLimit,
        ...(hiddenByLimit ? { hiddenByLimit: true } : {}),
      })
    }
  }
  return out
}

/**
 * Опции адреса: `prefix` — чей пагинатор фильтруется (`page` или `search`),
 * `preserved` — ЧУЖИЕ ключи текущего адреса, которые обязаны пережить смену
 * фильтров (фильтры/страница/запрос соседнего пагинатора, свой `q`).
 * Указатель страницы СВОЕГО префикса в preserved не входит: новый набор
 * фильтров начинается с первой страницы.
 */
export type CatalogFilterUrlOptions = {
  prefix?: string
  preserved?: Record<string, string | string[] | undefined>
}

function searchFromValues(
  values: Record<string, string[] | string | undefined>,
  opts: CatalogFilterUrlOptions = {},
): string {
  const prefix = opts.prefix ?? 'page'
  const params = new URLSearchParams()
  for (const [path, value] of Object.entries(values)) {
    if (!path.startsWith('filters.')) continue
    const list = Array.isArray(value)
      ? value
          .map((item) => (typeof item === 'number' ? String(item) : item))
          .filter((item): item is string => typeof item === 'string' && item.length > 0)
      : typeof value === 'number'
        ? [String(value)]
        : typeof value === 'string' && value
          ? [value]
          : []
    if (list.length) params.set(`${prefix}.${path}`, list.join(','))
  }
  // Чужие ключи адреса сохраняются как есть: фильтры одного пагинатора не
  // имеют права стирать состояние соседнего.
  for (const [key, value] of Object.entries(opts.preserved ?? {})) {
    if (value === undefined) continue
    if (key === prefix || key.startsWith(`${prefix}.filters.`)) continue
    params.set(key, Array.isArray(value) ? value.join(',') : value)
  }
  // Ключи сортируем: адрес одного набора фильтров всегда один и тот же —
  // это важно и для кэша, и для сравнения в тестах.
  const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
  return new URLSearchParams(sorted).toString()
}

/**
 * Канонический адрес каталога для набора значений.
 * Формат `?<prefix>.<поле>` — тот же, что читают `validateSearch` роута и адаптер;
 * указатель страницы своего префикса намеренно сбрасывается: новый набор
 * фильтров начинается с первой страницы.
 */
export function canonicalCatalogFilterUrl(
  page: string,
  values: Record<string, unknown> | Record<string, string[] | string | undefined>,
  opts: CatalogFilterUrlOptions = {},
): string {
  const query = searchFromValues(values as Record<string, string[] | string | undefined>, opts)
  return query ? `${page}?${query}` : page
}

/** Адрес без одного значения: клик по чипу снимает только его. */
export function catalogFilterUrlWithout(
  page: string,
  values: Record<string, string[]>,
  path: string,
  value: string,
  opts: CatalogFilterUrlOptions = {},
): string {
  const next: Record<string, string[]> = {}
  for (const [key, list] of Object.entries(values)) {
    const kept = key === path ? list.filter((item) => item !== value) : list
    if (kept.length) next[key] = kept
  }
  return canonicalCatalogFilterUrl(page, next, opts)
}

/**
 * Состояние формы «как открыть»: поля предзаполняются текущими значениями из
 * адреса, поэтому повторное открытие модалки (или переход на страницу фильтров)
 * показывает уже подключённые фильтры. Канон возвращал здесь свой `Result` с
 * `submission: 'initial'`; в b1 у формы другое состояние (`FormState`) — берём
 * его, суть та же: значения + ревизия описания.
 */
export function catalogFilterInitialState(
  definition: FormDescription,
  values: Record<string, string[]> = {},
  defaults: Record<string, string> = {},
): FormState {
  const prepared: Record<string, unknown> = {}
  for (const descriptor of definition.fields) {
    const list = values[descriptor.name] ?? []
    // Числовые инпуты диапазона предзаполняются границей базы (value=min /
    // value=max), если адрес не переопределил значение.
    prepared[descriptor.name] =
      descriptor.kind === 'multiselect' ? list : (list[0] ?? defaults[descriptor.name] ?? '')
  }
  return initialState(definition.revision, prepared)
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
 * `$lib/form` b1; состав проверок тот же: allowlist опций, границы числа.
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
