/**
 * Инструкция для интерфейса: что схема разрешает показать, что запрещает связка
 * и во что превращается выбор пользователя.
 *
 * Зачем это отдельно от `catalog-filter.ts`: канон считал всё это ВНУТРИ
 * компонента (`FiltersPanel.tsx`), поэтому вторая реализация (React/SolidJS)
 * вынуждена была бы повторить и чтение значений, и патч `setExtra`, и связки —
 * то есть ту самую логику, ради общего вида которой схему и заводили. Здесь
 * этой логики нет ни в одном компоненте:
 *
 *   • `catalogFilterView` — готовая к отрисовке картина (контролы, чипы,
 *     счётчик, причины недоступности, адреса) из СХЕМЫ + `extra` пагинатора;
 *   • `catalogFilterControls` — что интерфейс должен показать: по контролу на
 *     КАЖДЫЙ объявленный путь (режимы и границы включены), с опциями, границами
 *     и краями базы — и всё это выводится из объявления, а не из кода панели;
 *   • `catalogFilterFieldStates` — какие поля гасит связка и ПОЧЕМУ;
 *   • `catalogFilterExtraPatch` / `catalogFilterRemoveValuePatch` — патч для
 *     канала состояния (`setExtra`): выбор пользователя пишется в хранилище, а
 *     не в адрес напрямую.
 *
 * Компонент остаётся только разметкой: он рисует то, что здесь посчитано, и
 * отправляет наружу значения — ключей фильтров он не знает вовсе.
 */
import {
  activeCatalogFilters,
  canonicalCatalogFilterUrl,
  catalogFilterUrlWithout,
  CATALOG_FILTER_BOUND_LABEL,
  CATALOG_FILTER_MODE_LABEL,
  catalogFilterFieldNames,
  parseCatalogFilterPath,
  readCatalogFilterValues,
  stripDefaultCatalogFilterValues,
  type ActiveCatalogFilter,
  type CatalogFilterField,
  type CatalogFilterSchema,
} from './catalog-filter'
import {
  catalogFilterSearchRule,
  catalogFilterSuppressedFields,
  catalogFilterValueMap,
  checkCatalogFilterRules,
  type CatalogFilterViolation,
} from './rules'

/** Патч канала состояния: ключ extra → значение (или снятие). */
export type CatalogFilterPatch = Record<string, string | number | undefined>

/**
 * Как фильтры связаны с адресом: путь страницы каталога, префикс ключей и ЧУЖИЕ
 * ключи, которые обязаны пережить смену набора. Передан — значит компонент
 * получает готовые адреса и ничего не считает сам.
 */
export type CatalogFilterUrlView = {
  /** Путь каталога: он же `action` нативной формы (`/paginator`). */
  page: string
  prefix?: string
  /** Чужие ключи адреса (соседний пагинатор, размер страницы, источник). */
  preserved?: Record<string, string>
}

/** Чип активного фильтра: значение плюс адрес, снимающий ТОЛЬКО его. */
export type CatalogFilterChip = ActiveCatalogFilter & { href: string }

/** Готовый к отрисовке контрол: путь в extra, имя в адресе, значение, опции. */
export type CatalogFilterControl =
  | {
      kind: 'select'
      /** Имя поля в extra: `filters.kind`. */
      path: string
      /** Имя в адресе: `page.filters.kind` (то, что читает URL-слой и no-JS форма). */
      name: string
      label: string
      value: string
      options: readonly { value: string; label: string }[]
      /** Поле гасит связка: показать выключенным и сказать почему. */
      disabled: boolean
      reason?: string
    }
  | {
      kind: 'multiselect'
      path: string
      name: string
      label: string
      value: readonly string[]
      options: readonly { value: string; label: string }[]
      /** Показ списка обрезан лимитом: часть значений есть у источника, но не здесь. */
      truncated?: number
      disabled: boolean
      reason?: string
    }
  | {
      kind: 'number'
      path: string
      name: string
      label: string
      value: string
      min?: number
      max?: number
      /**
       * Край базы — ПОДСКАЗКА, а не значение: заполненный «от: 1» ушёл бы в адрес
       * при нативной отправке формы (`1900`, `1`, `2028`) и остался бы там как
       * фильтр, которого пользователь не выбирал. С JS такой ключ снимает
       * `catalogFilterExtraPatch`, а путь без JS отправляет форму как есть —
       * поэтому значение не предзаполняется вовсе, а край виден подсказкой.
       */
      placeholder?: string
      disabled: boolean
      reason?: string
    }
  | {
      kind: 'text'
      path: string
      name: string
      label: string
      value: string
      placeholder?: string
      disabled: boolean
      reason?: string
    }

/** Состояние поля: доступно ли и что говорит связка. */
export type CatalogFilterFieldState = {
  key: string
  label: string
  disabled: boolean
  reason?: string
  /** Связка снимает это поле при текущих значениях. */
  suppressedBy?: string
}

/** Что пользователь видит в панели фильтров — целиком из схемы и extra. */
export type CatalogFilterView = {
  source: string
  builtAt?: string
  controls: readonly CatalogFilterControl[]
  chips: readonly CatalogFilterChip[]
  /**
   * `action` нативной формы (GET на страницу каталога) — без запроса: адрес
   * GET-формы браузер целиком заменяет своими полями, поэтому чужие ключи едут
   * скрытыми полями (`hidden`), а не в action.
   */
  formAction?: string
  /** Скрытые поля формы: чужие ключи адреса, которые обязаны пережить отправку. */
  hidden: readonly { name: string; value: string }[]
  /** Число применённых значений — для счётчика на кнопке. */
  count: number
  /** Поиск запрещён связкой: показать причину рядом с полем запроса. */
  searchBlocked?: { id: string; reason: string }
  /** Поля, снятые связками (deny-safe решение источника), с причинами. */
  suppressed: readonly { key: string; label: string; reason: string }[]
  /** Подсказки формы: сочетания, которые дадут пустую выдачу. */
  violations: readonly CatalogFilterViolation[]
}

const EMPTY: readonly string[] = []

/** Подпись опции: имя из схемы (для скрытых лимитом значений — сам id). */
function optionsOf(field: CatalogFilterField): { value: string; label: string }[] {
  return (field.options ?? []).map((option) => ({ value: option.value, label: option.label }))
}

/**
 * Состояние полей при текущих значениях: гасит ли поле связка.
 * Причина приходит из схемы — UI её только показывает.
 */
export function catalogFilterFieldStates(
  schema: CatalogFilterSchema | undefined,
  values: Record<string, unknown> | undefined,
): CatalogFilterFieldState[] {
  const map = catalogFilterValueMap(values)
  const suppressed = catalogFilterSuppressedFields(schema, map)
  const reasons = new Map<string, { id: string; reason: string }>()
  for (const rule of schema?.rules ?? []) {
    if (rule.drop === 'q') continue
    if (suppressed.has(rule.drop.field)) reasons.set(rule.drop.field, { id: rule.id, reason: rule.reason })
  }
  return (schema?.fields ?? []).map((field) => {
    const hit = reasons.get(field.key)
    return {
      key: field.key,
      label: field.label,
      disabled: !!hit,
      ...(hit ? { reason: hit.reason, suppressedBy: hit.id } : {}),
    }
  })
}

/**
 * Готовые к отрисовке контролы: по одному на КАЖДЫЙ объявленный путь
 * (`filters.genres.and`, `filters.genres.not`, `filters.score.min`, …). Именно
 * поэтому «какие связки поддерживает источник» видно в интерфейсе: чего нет в
 * схеме — того нет и в форме, а не «спрятано за флагом».
 */
export function catalogFilterControls(
  schema: CatalogFilterSchema,
  extra: Record<string, unknown> | undefined,
  opts: { prefix?: string } = {},
): CatalogFilterControl[] {
  const prefix = opts.prefix ?? 'page'
  const values = readCatalogFilterValues(extra)
  const states = new Map(catalogFilterFieldStates(schema, extra).map((state) => [state.key, state]))
  const out: CatalogFilterControl[] = []
  for (const field of schema.fields) {
    const state = states.get(field.key)
    const disabled = state?.disabled ?? false
    for (const path of catalogFilterFieldNames(field)) {
      const parsed = parseCatalogFilterPath(path)
      const name = `${prefix}.${path}`
      const current = values[path] ?? EMPTY
      const common = {
        path,
        name,
        label: field.label
          ? `${field.label}${parsed?.mode ? ` · ${CATALOG_FILTER_MODE_LABEL[parsed.mode]}` : parsed?.bound ? ` · ${CATALOG_FILTER_BOUND_LABEL[parsed.bound]}` : ''}`
          : path,
        disabled,
        ...(disabled && state?.reason ? { reason: state.reason } : {}),
      }
      if (field.type === 'multiselect' || field.type === 'select') {
        const options = optionsOf(field)
        if (field.type === 'multiselect') {
          out.push({
            ...common,
            kind: 'multiselect',
            value: current,
            options,
            ...(field.optionsTruncated ? { truncated: field.optionsTruncated } : {}),
          })
        } else {
          out.push({ ...common, kind: 'select', value: current[0] ?? '', options })
        }
        continue
      }
      if (field.type === 'number') {
        const edge = parsed?.bound === 'max' ? field.max : parsed?.bound === 'min' ? field.min : undefined
        out.push({
          ...common,
          kind: 'number',
          // Значение — только то, что реально стоит фильтром; край базы виден
          // подсказкой (см. `placeholder` в типе контрола).
          value: current[0] ?? '',
          ...(edge !== undefined ? { placeholder: String(edge) } : {}),
          ...(field.min !== undefined ? { min: field.min } : {}),
          ...(field.max !== undefined ? { max: field.max } : {}),
        })
        continue
      }
      if (field.type === 'text') {
        out.push({ ...common, kind: 'text', value: current[0] ?? '' })
        continue
      }
      out.push({ ...common, kind: 'select', value: current[0] ?? '', options: optionsOf(field) })
    }
  }
  return out
}

/**
 * Полная картина панели: контролы + чипы + причины. Значения берутся из `extra`
 * пагинатора (единственный источник истины), а не из адреса: пагинатор может
 * жить на любом хранилище.
 */
export function catalogFilterView(
  schema: CatalogFilterSchema,
  extra: Record<string, unknown> | undefined,
  opts: { prefix?: string; url?: CatalogFilterUrlView } = {},
): CatalogFilterView {
  const values = readCatalogFilterValues(extra)
  const map = catalogFilterValueMap(extra)
  const rule = catalogFilterSearchRule(schema, map)
  const states = catalogFilterFieldStates(schema, extra)
  const suppressed = states
    .filter((state) => state.disabled && state.reason)
    .map((state) => ({ key: state.key, label: state.label, reason: state.reason! }))
  const urlOpts = { prefix: opts.url?.prefix ?? opts.prefix ?? 'page', preserved: opts.url?.preserved ?? {} }
  const chips: CatalogFilterChip[] = activeCatalogFilters(schema, values).map((chip) => ({
    ...chip,
    href: opts.url ? catalogFilterUrlWithout(opts.url.page, values, chip.path, chip.value, urlOpts) : '',
  }))
  return {
    source: schema.source,
    ...(schema.builtAt ? { builtAt: schema.builtAt } : {}),
    controls: catalogFilterControls(schema, extra, opts),
    chips,
    ...(opts.url ? { formAction: canonicalCatalogFilterUrl(opts.url.page, {}, urlOpts) } : {}),
    // Скрытые поля формы — ЧУЖИЕ ключи адреса: свои фильтры форма заменяет
    // сама, а её указатель страницы (новый набор начинается с первой) не
    // сохраняется. Правило то же, что у `searchFromValues`, иначе форма и
    // адрес разошлись бы в том, какие ключи «свои».
    hidden: Object.entries(opts.url?.preserved ?? {})
      .filter(([name]) => name !== urlOpts.prefix && !name.startsWith(`${urlOpts.prefix}.filters.`))
      .map(([name, value]) => ({ name, value })),
    count: chips.length,
    ...(rule ? { searchBlocked: { id: rule.id, reason: rule.reason } } : {}),
    suppressed,
    // `checkCatalogFilterRules` уже включает противоречия режимов одного поля
    // (они следуют из смысла `and`/`not`, а не из объявления связки).
    violations: checkCatalogFilterRules(schema, map),
  }
}

/**
 * Значения формы → патч канала состояния. Все объявленные ключи едут одним
 * патчем: пустое значение — `undefined` (снятие ключа), список — строкой через
 * запятую (формат extra и адреса один), граница числа — числом (так её читает
 * адресный слой).
 */
export function catalogFilterExtraPatch(
  schema: CatalogFilterSchema,
  values: Record<string, unknown> | undefined,
): CatalogFilterPatch {
  const declared = new Set(schema.fields.flatMap((field) => catalogFilterFieldNames(field)))
  const input: Record<string, unknown> = {}
  for (const [path, value] of Object.entries(values ?? {})) {
    if (declared.has(path)) input[path] = value
  }
  const stripped = stripDefaultCatalogFilterValues(schema, input)
  const patch: CatalogFilterPatch = {}
  for (const path of declared) {
    const raw = stripped[path]
    const list = Array.isArray(raw)
      ? raw.map((item) => String(item).trim()).filter((item) => item.length > 0)
      : typeof raw === 'number'
        ? [String(raw)]
        : typeof raw === 'string' && raw.trim() !== ''
          ? [raw.trim()]
          : []
    if (!list.length) {
      patch[path] = undefined
      continue
    }
    // Границы числового поля живут в extra ЧИСЛОМ (`filters.score.min=7`):
    // строку адресный слой примет, но тогда схема сравнивает число со строкой.
    if (path.endsWith('.min') || path.endsWith('.max')) {
      const num = Number(list[0])
      patch[path] = Number.isFinite(num) ? num : undefined
      continue
    }
    patch[path] = list.join(',')
  }
  return patch
}

/** Патч снятия одного значения (клик по чипу): остальные значения поля живут. */
export function catalogFilterRemoveValuePatch(
  schema: CatalogFilterSchema,
  extra: Record<string, unknown> | undefined,
  path: string,
  value: string,
): CatalogFilterPatch {
  const values = readCatalogFilterValues(extra)
  const next: Record<string, unknown> = {}
  const declared = new Set(schema.fields.flatMap((field) => catalogFilterFieldNames(field)))
  for (const key of declared) {
    if (key === path) {
      const kept = (values[key] ?? []).filter((item) => item !== value)
      if (kept.length) next[key] = kept
      continue
    }
    const current = values[key]
    if (current?.length) next[key] = current
  }
  return catalogFilterExtraPatch(schema, next)
}
