/**
 * Инструкция для интерфейса панели фильтров: что применено, что запрещает
 * связка и во что превращается выбор пользователя.
 *
 * Компонент остаётся разметкой — всё, что можно посчитать, считается здесь:
 *
 *   • `catalogFilterView` — картина панели из СХЕМЫ + `extra` пагинатора
 *     (применённый набор): чипы, счётчик, адреса формы, запрет поиска и
 *     пояснения к связкам. Связки считает `catalogRuleState` — тем же
 *     условием формы, что гасит поля живой формы и защищает источник (R1);
 *   • `catalogFilterExtraPatch` / `catalogFilterRemoveValuePatch` — патч для
 *     канала состояния (`setExtra`): выбор пользователя пишется в хранилище, а
 *     не в адрес напрямую.
 *
 * Контролы формы здесь не собираются: их компилирует `compileCatalogFilterSchema`,
 * а гасят связки правила `disabledWhen` в том же определении формы.
 */
import {
  activeCatalogFilters,
  canonicalCatalogFilterUrl,
  catalogFilterUrlWithout,
  catalogFilterFieldNames,
  catalogFilterValueMap,
  catalogFilterViolations,
  catalogRuleState,
  parseCatalogFilterPath,
  readCatalogFilterValues,
  stripDefaultCatalogFilterValues,
  type ActiveCatalogFilter,
  type CatalogFilterSchema,
  type CatalogFilterViolation,
} from './catalog-filter'

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

/** Что пользователь видит в панели фильтров — целиком из схемы и extra. */
export type CatalogFilterView = {
  source: string
  builtAt?: string
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
  /** Пояснения к активным связкам и смысловым противоречиям. */
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
  opts: { prefix?: string; url?: CatalogFilterUrlView } = {},
): CatalogFilterView {
  const values = readCatalogFilterValues(extra)
  const map = catalogFilterValueMap(extra)
  const search = catalogRuleState(schema, map).search
  const urlOpts = { prefix: opts.url?.prefix ?? opts.prefix ?? 'page', preserved: opts.url?.preserved ?? {} }
  const chips: CatalogFilterChip[] = activeCatalogFilters(schema, values).map((chip) => ({
    ...chip,
    href: opts.url ? catalogFilterUrlWithout(opts.url.page, values, chip.path, chip.value, urlOpts) : '',
  }))
  return {
    source: schema.source,
    ...(schema.builtAt ? { builtAt: schema.builtAt } : {}),
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
    ...(search ? { searchBlocked: { id: search.id, reason: search.reason } } : {}),
    // Поиск объясняется выше; остальное — предупреждения у фильтров.
    violations: catalogFilterViolations(schema, map).filter((violation) => violation.drop !== 'q'),
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
