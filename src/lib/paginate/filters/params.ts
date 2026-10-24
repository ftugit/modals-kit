/**
 * Схема источника → параметры полей формы `#lib/form`.
 *
 * Поля, их порядок и подписи описывает приложение — своим `defineForm` под
 * каждую схему. Схема (живая, от источника) добавляет то, что знает только она:
 * варианты выбора, границы значений, пределы, связки и межполевые правила.
 *
 * ```ts
 * export function shikimoriFilterForm(schema: CatalogFilterSchema, opts?: CatalogFilterFormOptions) {
 *   const filter = formParams(schema, opts)
 *   return defineForm({
 *     id: 'shikimori-filters',
 *     policy: filter.policy,
 *     fields: filter.fields({
 *       'genres.and': field.multiselect({ label: 'Жанры', ...filter.genres.and }),
 *       'year.min': field.number({ label: 'Год от', ...filter.year.min }),
 *       status: field.select({ label: 'Статус', ...filter.status }),
 *     }),
 *   })
 * }
 * ```
 *
 * Свои ключи поля пишутся ПОСЛЕ развёртки (иначе развёртка их перекроет), свой
 * валидатор — рядом с выданными: `validate: [...filter.year.min.validate, v.integer()]`.
 *
 * Слов здесь нет: подписи, плейсхолдеры выбора и тексты ошибок — в описании
 * приложения и в словаре формы. Плейсхолдер числа — край базы, это данные.
 */
import { DEV } from 'esm-env'
import { v, type DisableRule, type FieldDraft, type FormPolicy, type Option, type ValidatorRef } from '#lib/form/index.js'
import { FILTER_KEY_PREFIX } from '../source'
import {
  catalogFilterFieldNames,
  catalogFilterOptionsAreComplete,
  validateCatalogFilterSchema,
  type CatalogFilterBound,
  type CatalogFilterField,
  type CatalogFilterMode,
  type CatalogFilterSchema,
} from './schema'
import { catalogFilterPolicy, disableRulesFor, optionsAllowlist } from './form'
import { parseCatalogFilterPath } from './values'

/** Что схема даёт одному полю формы. `validate` есть всегда — его удобно дополнять. */
export interface FilterFieldParams {
  readonly validate: readonly ValidatorRef[]
  readonly options?: readonly Option[]
  readonly placeholder?: string
  readonly disabledWhen?: readonly DisableRule[]
}

/** Параметры ключа схемы: сам ключ (выбор, текст) и его режимы/границы. */
export type FilterKeyParams = FilterFieldParams & Readonly<Record<CatalogFilterMode | CatalogFilterBound, FilterFieldParams>>

/** Настройка построения формы фильтров: описание, политика и подписи. */
export interface CatalogFilterFormOptions {
  /**
   * Адресный слой имён: в браузере имя поля формы — ключ адреса
   * (`page.filters.year.min`), на сервере — путь без слоя (`filters.year.min`).
   */
  prefix?: string
}

/** Описание формы фильтров под схему: функция приложения, одна на браузер и сервер. */
export type CatalogFilterDescribe = (
  schema: CatalogFilterSchema,
  opts?: CatalogFilterFormOptions,
) => import('#lib/form/index.js').FormDescription

/** Разобранный адрес фильтров: значения и ключи, снятые при отказе. */
export type FilterParams = {
  /** Политика формы фильтров: предел вариантов поднят до предела схемы. */
  readonly policy: FormPolicy
  /**
   * Ключи описания (`'genres.and'`, `status`) → имена полей формы, плюс три вещи:
   * поле, которого нет у источника, убирается; в связках подписи полей берутся
   * из описания, а не из схемы; развёртка чужого ключа (`'genres.not':
   * ...filter.genres.and`) в разработке даёт предупреждение.
   */
  fields(drafts: Record<string, FieldDraft<any>>): Record<string, FieldDraft<any>>
} & { readonly [key: string]: FilterKeyParams }

const EMPTY: FilterFieldParams = Object.freeze({ validate: Object.freeze([]) as readonly ValidatorRef[] })

const warn = (message: string) => {
  if (DEV) console.warn(`[filters] ${message}`)
}

/** Строит определение формы фильтров из схемы и текущего адреса. */
export function formParams(input: CatalogFilterSchema, opts: CatalogFilterFormOptions = {}): FilterParams {
  const schema = validateCatalogFilterSchema(input)
  const prefix = opts.prefix ?? ''
  const byKey = new Map(schema.fields.map((descriptor) => [descriptor.key, descriptor]))
  const declared = new Set(schema.fields.flatMap(catalogFilterFieldNames))
  const full = (path: string) => prefix + path
  /** Кто выдал валидатор: ловит развёртку не того ключа (`'genres.not': ...filter.genres.and`). */
  const issuedBy = new Map<ValidatorRef, string>()
  const cache = new Map<string, FilterFieldParams>()

  function paramsOf(descriptor: CatalogFilterField, path: string): FilterFieldParams {
    const hit = cache.get(path)
    if (hit) return hit
    const parsed = parseCatalogFilterPath(path)
    const mode = parsed?.mode
    const bound = parsed?.bound
    const validate: ValidatorRef[] = []
    // Границы значений базы: валидатор и атрибуты min/max числового инпута.
    if (descriptor.min !== undefined) validate.push({ name: 'minValue', arg: descriptor.min })
    if (descriptor.max !== undefined) validate.push({ name: 'maxValue', arg: descriptor.max })
    if (descriptor.type === 'multiselect' && descriptor.maxSelections !== undefined)
      validate.push({ name: 'maxCount', arg: descriptor.maxSelections })
    // Список допустимых — только при полном показе вариантов: у обрезанного
    // настоящее значение источника могло не доехать (решает источник).
    if ((descriptor.type === 'multiselect' || descriptor.type === 'select') && catalogFilterOptionsAreComplete(descriptor))
      validate.push(optionsAllowlist((descriptor.options ?? []).map((option) => option.value)))
    // Диапазон: нижняя граница не больше верхней. Ошибка — у «от».
    const bounds = descriptor.bounds ?? ['min', 'max']
    if (descriptor.type === 'number' && bound === 'min' && bounds.includes('max'))
      validate.push(v.notAbove(full(`${FILTER_KEY_PREFIX}${descriptor.key}.max`)))
    // Одно значение в «все из» и в «кроме» даёт пустую выдачу. Ошибка — у «кроме».
    const modes = descriptor.modes ?? ['or']
    if (descriptor.type === 'multiselect' && mode === 'not' && modes.includes('and'))
      validate.push(v.noOverlap(full(`${FILTER_KEY_PREFIX}${descriptor.key}.and`)))
    for (const ref of validate) issuedBy.set(ref, path)

    const edge = bound === 'min' ? descriptor.min : bound === 'max' ? descriptor.max : undefined
    const disabledWhen = disableRulesFor(schema, descriptor, prefix)
    const params: FilterFieldParams = {
      validate,
      ...(descriptor.options ? { options: descriptor.options } : {}),
      ...(descriptor.type === 'number' && edge !== undefined ? { placeholder: String(edge) } : {}),
      ...(disabledWhen.length ? { disabledWhen } : {}),
    }
    cache.set(path, params)
    return params
  }

  function keyParams(key: string): FilterKeyParams {
    const descriptor = byKey.get(key)
    const self = descriptor && declared.has(`${FILTER_KEY_PREFIX}${key}`) ? paramsOf(descriptor, `${FILTER_KEY_PREFIX}${key}`) : EMPTY
    return new Proxy(self as FilterKeyParams, {
      get(target, part) {
        if (typeof part !== 'string') return undefined
        if (part === 'and' || part === 'or' || part === 'not' || part === 'min' || part === 'max') {
          const path = `${FILTER_KEY_PREFIX}${key}.${part}`
          return descriptor && declared.has(path) ? paramsOf(descriptor, path) : EMPTY
        }
        return (target as unknown as Record<string, unknown>)[part]
      },
    })
  }

  function fields(drafts: Record<string, FieldDraft<any>>): Record<string, FieldDraft<any>> {
    // Подпись ключа для связок — первое поле описания с этим ключом.
    const labelOfKey = new Map<string, string>()
    for (const [name, draft] of Object.entries(drafts)) {
      const parsed = parseCatalogFilterPath(`${FILTER_KEY_PREFIX}${name}`)
      if (parsed && draft.label && !labelOfKey.has(parsed.key)) labelOfKey.set(parsed.key, draft.label)
    }
    const out: Record<string, FieldDraft<any>> = Object.create(null)
    for (const [name, draft] of Object.entries(drafts)) {
      const path = `${FILTER_KEY_PREFIX}${name}`
      // Поля нет у этого источника (студии у GraphQL) — ожидаемо: описание одно
      // на все версии API, а рисуется и проверяется только существующее.
      if (!declared.has(path)) continue
      const foreign = (draft.validators ?? []).map((ref) => issuedBy.get(ref)).find((from) => from && from !== path)
      if (foreign) warn(`поле «${name}» получило параметры «${foreign.slice(FILTER_KEY_PREFIX.length)}»`)
      out[full(path)] = draft.disabledWhen?.length
        ? {
            ...draft,
            disabledWhen: draft.disabledWhen.map((rule) => ({
              ...rule,
              label: draft.label ?? rule.label,
              blockers: (rule.blockers ?? []).map((key) => labelOfKey.get(key) ?? byKey.get(key)?.label ?? key),
            })),
          }
        : draft
    }
    return out
  }

  const policy = catalogFilterPolicy()
  return new Proxy({} as FilterParams, {
    get(_target, key) {
      if (key === 'policy') return policy
      if (key === 'fields') return fields
      return typeof key === 'string' ? keyParams(key) : undefined
    },
  })
}
