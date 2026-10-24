/**
 * Инструкция для интерфейса панели фильтров: что применено, что запрещает
 * связка и во что превращается выбор пользователя.
 *
 * Компонент остаётся разметкой — всё, что можно посчитать, считается здесь:
 *
 *   • `activeCatalogFilters` — данные чипов из применённых значений;
 *   • `catalogFilterView` — картина панели из СХЕМЫ + `extra` пагинатора
 *     (применённый набор): чипы, счётчик, адреса формы, запрет поиска и
 *     пояснения к связкам. Связки считает `catalogRuleState` — тем же
 *     условием формы, что гасит поля живой формы и защищает источник (R1);
 *   • `catalogFilterExtraPatch` / `catalogFilterRemoveValuePatch` — патч для
 *     канала состояния (`setExtra`): выбор пользователя пишется в хранилище, а
 *     не в адрес напрямую.
 *
 * Поля формы здесь не собираются: их описывает приложение (`formParams`),
 * а гасят связки правила `disabledWhen` в том же описании. Подписи чипов —
 * подписи полей этого описания: поля, которого в описании нет, нет и в чипах.
 */
import type { FormDescription, MessageDictionary } from '#lib/form/index.js'
import { catalogFilterFieldNames, type CatalogFilterBound, type CatalogFilterMode, type CatalogFilterSchema } from './schema'
import { parseCatalogFilterPath, readCatalogFilterValues } from './values'
import { stripDefaultCatalogFilterValues } from './form'
import { catalogFilterValueMap, catalogFilterViolations, catalogRuleState, type CatalogFilterViolation } from './rules'

/** Активный фильтр: ключ, подпись и человекочитаемое значение. */
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

/** Патч канала состояния: ключ extra → значение (или снятие). */
export type CatalogFilterPatch = Record<string, string | number | undefined>

/**
 * Ссылка на состояние после патча — ответ хранилища пагинатора (`linkFor`):
 * `null`, если у хранилища ссылок нет (local/cursor) — UI рисует кнопку.
 */
export type CatalogFilterHref = (patch: CatalogFilterPatch) => string | null

/**
 * Чип активного фильтра: значение, патч, снимающий ТОЛЬКО его, и ссылка на тот же
 * патч (`null` — у хранилища ссылок нет).
 */
export type CatalogFilterChip = ActiveCatalogFilter & { patch: CatalogFilterPatch; href: string | null }

/** Что пользователь видит в панели фильтров — целиком из схемы и extra. */
export type CatalogFilterView = {
  source: string
  builtAt?: string
  chips: readonly CatalogFilterChip[]
  /** «Сбросить»: патч, снимающий все фильтры, и ссылка на него (`null` — кнопка). */
  reset: { patch: CatalogFilterPatch; href: string | null }
  /** Число применённых значений — для счётчика на кнопке. */
  count: number
  /** Поиск запрещён связкой: показать причину рядом с полем запроса. */
  searchBlocked?: { id: string; reason: string }
  /** Ошибки формы над применённым набором: связки, перевёрнутый диапазон, «все из» ∩ «кроме». */
  violations: readonly CatalogFilterViolation[]
}

/**
 * Полная картина панели: чипы + адреса + причины. Значения берутся из `extra`
 * пагинатора (единственный источник истины), а не из адреса: пагинатор может
 * жить на любом хранилище. Это ПРИМЕНЁННЫЙ набор — живые блокировки полей
 * считает форма по своему зеркалу (`disabledWhen` её полей).
 */
export function catalogFilterView(
  schema: CatalogFilterSchema,
  extra: Record<string, unknown> | undefined,
  opts: {
    /** Описание формы фильтров (имена — с адресным слоем `prefix.`): подписи и проверка. */
    description: FormDescription
    /** Слой имён полей у хранилища (`page` → `page.filters.kind`); пусто — без слоя. */
    prefix?: string
    /** Ссылка на состояние после патча (`linkFor` пагинатора); нет — ссылок нет. */
    href?: CatalogFilterHref
    /** Словарь приложения для текстов нарушений. */
    messages?: MessageDictionary
  },
): CatalogFilterView {
  const values = readCatalogFilterValues(extra)
  const map = catalogFilterValueMap(extra)
  const search = catalogRuleState(schema, map).search
  const layer = opts.prefix ? `${opts.prefix}.` : ''
  const href = (patch: CatalogFilterPatch): string | null => opts.href?.(patch) ?? null
  const chips: CatalogFilterChip[] = []
  for (const chip of activeCatalogFilters(schema, values)) {
    const described = opts.description.byName[layer + chip.path]
    if (!described) continue
    const patch = catalogFilterRemoveValuePatch(schema, extra, chip.path, chip.value)
    chips.push({ ...chip, fieldLabel: described.label ?? chip.fieldLabel, patch, href: href(patch) })
  }
  const resetPatch = catalogFilterExtraPatch(schema, {})
  return {
    source: schema.source,
    ...(schema.builtAt ? { builtAt: schema.builtAt } : {}),
    chips,
    reset: { patch: resetPatch, href: href(resetPatch) },
    count: chips.length,
    ...(search ? { searchBlocked: { id: search.id, reason: search.reason } } : {}),
    violations: catalogFilterViolations(opts.description, schema, extra, { prefix: layer, messages: opts.messages }),
  }
}

/**
 * Значения формы → патч канала состояния. Все объявленные ключи едут одним
 * патчем: пустое значение — `undefined` (снятие ключа), список — строкой через
 * запятую (формат extra и адреса один), граница числа — числом (так её читает
 * адресный слой).
 *
 * Связки применяются НЕ здесь: патчер — сериализатор, он ничего о связках не
 * знает. Дроп подавленных значений живёт у СБОРЩИКА входа — там, где JS решает
 * ситуацию сам, ровно как без JavaScript её решает браузер, не отправляя
 * выключенный контрол: путь формы гасит их пропуском disabled-контролов
 * (`commitUrl`), путь чипа — фильтром переносимых значений в
 * `catalogFilterRemoveValuePatch`. В хранилище не попадает сочетание, которое
 * источник всё равно отбросил бы (`dropped`); адрес/ссылка, где запрещённое
 * значение лежит, ничего не теряет — панель называет причину, пока
 * пользователь не применит набор сам.
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
  // Дроп подавленных живёт здесь, у сборщика переносимых значений: extra может
  // хранить сочетание, которое «отправил» не набор формы, а рука или прошлое
  // состояние (URL со score при anons). Связка считается ПОСЛЕ снятия чипа —
  // иначе снятие триггера ошибочно похоронит ожившего соседа.
  // (Связка «поиск запрещён» ни при чём: она снимает поиск, а не поле.)
  const suppressed = catalogRuleState(
    schema,
    catalogFilterValueMap(stripDefaultCatalogFilterValues(schema, next)),
  ).fields
  for (const key of Object.keys(next)) {
    const parsed = parseCatalogFilterPath(key)
    if (parsed !== undefined && suppressed.has(parsed.key)) delete next[key]
  }
  return catalogFilterExtraPatch(schema, next)
}
