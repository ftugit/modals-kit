/**
 * Схема → определение формы `lib/form` (одно и то же на сервере и в браузере):
 * `compileCatalogFilterSchema`, начальное состояние, FormData, снятие значений по умолчанию.
 *
 * Порт канона (`ftugit/SolidHono@shiki-final`, `src/lib/search/catalog-filter.ts`)
 * без упрощений: имена полей, правила валидатора и формат адреса сохранены
 * посимвольно; заменено только то, что относится к ЧУЖОЙ форме (канон собирал
 * определение на `@/lib/form/core`, здесь — на `#lib/form/index.js`), и добавлены связки
 * (`rules`) — они часть схемы, как и поля: компилятор переводит их в `disabledWhen`
 * полей формы, а связка с поиском и пояснения панели считаются тем же условием формы.
 */
import {
  defaultPolicy,
  defineForm,
  field,
  initialState,
  type FieldDraft,
  type FormDescription,
  type FormPolicy,
  type FormState,
  type ValidatorRef,
  type DisableRule,
  type FieldCondition,
} from '#lib/form/index.js'
import { catalogFilterFieldNames, validateCatalogFilterSchema, CATALOG_FILTER_OPTIONS_LIMIT, catalogFilterOptionsAreComplete, type CatalogFilterMode, type CatalogFilterField, type CatalogFilterRule, type CatalogFilterSchema, type CatalogFilterBound } from './schema'
import { parseCatalogFilterPath } from './url'

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

/**
 * Политика формы фильтров: единственное отличие от умолчательной — предел
 * числа вариантов поднят до предела СХЕМЫ (5000), потому что гигантские
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
/**
 * Связка схемы → условие формы. Идентификатор условия — КЛЮЧ поля схемы, а
 * форма видит пути (`filters.genres.and`, `filters.score.min`): поле заполнено,
 * если заполнен любой его путь; значение есть, если оно на любом пути.
 * `prefix` — адресный слой имён живой формы (`page.`); сервер и панель считают
 * по путям без префикса. Один перевод на форму, поиск и пояснения панели.
 */
/** Наружу пакета не выходит: `index.ts` реэкспортирует `form.ts` списком. */
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
 * поле целиком, отказ касается поля, а не одного режима. Называется поле
 * подписью схемы («Оценка», а не «Оценка · от»), текст — словаря формы.
 * `drop: 'q'` сюда не входит: поиск живёт вне формы (`catalogRuleState`).
 */
function disableRulesFor(schema: CatalogFilterSchema, descriptor: CatalogFilterField, prefix: string): DisableRule[] {
  const labelOf = new Map(schema.fields.map((field) => [field.key, field.label]))
  return (schema.rules ?? [])
    .filter((rule) => rule.drop !== 'q' && rule.drop.field === descriptor.key)
    .map((rule) => ({
      when: ruleCondition(schema, rule, prefix),
      reason: rule.reason,
      blockers: rule.when.map((condition) => labelOf.get(condition.field) ?? condition.field),
      label: descriptor.label,
      ...(rule.message !== undefined ? { message: rule.message } : {}),
    }))
}

/**
 * Край базы подсказкой у числового инпута диапазона (F45): «от» — min, «до» —
 * max. Значение не предзаполняется — фильтром стоит только то, что выбрал
 * пользователь, а край виден, пока поле пустое.
 */
function edgeHint(descriptor: CatalogFilterField, bound: CatalogFilterBound | undefined): { placeholder?: string } {
  const edge = bound === 'min' ? descriptor.min : bound === 'max' ? descriptor.max : undefined
  return edge !== undefined ? { placeholder: String(edge) } : {}
}

/**
 * `opts.namePrefix` — адресный слой имён: форма фильтров живёт на url-контуре
 * `bind`, где ИМЯ ПОЛЯ и есть ключ адреса (`page.filters.kind` — так же, как у
 * поиска S5). `paths` и `defaults` остаются каноническими относительными
 * путями: они кормят extra-слой хранилища, а не DOM.
 */
export function compileCatalogFilterSchema(
  input: unknown,
  id = 'catalog-filters',
  opts: { namePrefix?: string } = {},
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
  const namePrefix = opts.namePrefix ?? ''
  const fields: Record<string, FieldDraft<any>> = Object.create(null)
  const paths: string[] = []
  const defaults: Record<string, string> = {}

  for (const descriptor of schema.fields) {
    const disabledWhen = disableRulesFor(schema, descriptor, namePrefix)
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
        // Связки схемы: живое гашение у клиента и отказ `link.blocked` в
        // validateForm — набор с выбранным запрещённым значением отклоняется
        // целиком, «частичного применения» без JS нет.
        ...(disabledWhen.length ? { disabledWhen } : {}),
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
      fields[namePrefix + name] = descriptor.type === 'multiselect'
        ? field.multiselect({ ...common, options, validate: list })
        : descriptor.type === 'select'
          ? field.select({ ...common, options, validate: list })
          : descriptor.type === 'number'
            ? field.number({ ...common, ...edgeHint(descriptor, bound) })
            : field.text(common)
      paths.push(name)
      // value=min у инпута «от», value=max у инпута «до» (границы базы).
      if (bound === 'min' && descriptor.min !== undefined) defaults[name] = String(descriptor.min)
      if (bound === 'max' && descriptor.max !== undefined) defaults[name] = String(descriptor.max)
    }
  }

  return {
    schema,
    definition: defineForm({ id, fields, policy: catalogFilterPolicy() }),
    paths,
    defaults,
  }
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
