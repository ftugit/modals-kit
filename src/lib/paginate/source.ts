/**
 * Общий слой источника пагинатора: единственная форма, которую пагинатор
 * принимает от приложения.
 *
 * Зачем бренд: раньше источником была просто функция `Source<T>`, и пагинатор не
 * знал о ней НИЧЕГО — поддерживает ли она поиск, фильтры, знает ли число страниц.
 * Объект с той же формой можно было «скормить» вместо настоящего источника, и UI
 * молча показывал кнопки, которых источник не умеет. Теперь пагинатор принимает
 * только то, что создано `defineSource()`: у адаптированного источника есть
 * возможности (`capabilitiesFor`), спецификации поиска/фильтров (`searchFor`/
 * `filtersFor`) и сам контракт страницы (`page`). Всё остальное — отказ с
 * внятной ошибкой (`assertAdaptedSource`).
 *
 * Границы слоя:
 *   • ядро (`lib/paginate`) не знает ни про libSearch, ни про фреймворк —
 *     спецификация поиска описана структурно (`SourceFuzzySpec`), поэтому
 *     libSearch подключается декоратором (`withSearch`) без импортов в обратную
 *     сторону;
 *   • «выключенный поиск» — часть контракта: спецификация объявляет `enabled`,
 *     и оболочка НЕ передаёт запрос источнику, когда он выключен (демо-тумблер
 *     не лезет внутрь источников);
 *   • возможности считаются на текущий выбор (`capabilitiesFor(extra)`), поэтому
 *     переключатель источников отдаёт возможности ВЫБРАННОГО источника.
 */
import type { Extra, ExtraValue, PageRequest, PageResponse } from './types'

/** Бренд адаптированного источника: `Symbol.for` — один на все копии модуля. */
const SOURCE_BRAND = Symbol.for('modals-kit.paginate.adapted-source')

/** Возможности источника, о которых пагинатор обязан знать. */
export type SourceCapability = 'search' | 'filters' | 'fuzzy' | 'totals'

export type SourceCapabilities = Readonly<Record<SourceCapability, boolean>>

/**
 * Минимум, который нужен для чистки ключей: возможности на текущий extra и
 * объявленные ключи по возможностям. Структурно — срез `AdaptedSource`, чтобы
 * ядро не зависело от дженерика источника.
 */
export type CapabilitySource = {
  readonly capabilityKeys: CapabilityKeys
  capabilitiesFor(extra: Extra): SourceCapabilities
}

/** Спецификации ключей, «принадлежащих» возможности: ими распоряжается приложение. */
export type CapabilityKeys = Partial<Record<SourceCapability, readonly string[]>>

/** Минимальные возможности: источник — «просто данные». */
export const NO_CAPABILITIES: SourceCapabilities = Object.freeze({
  search: false,
  filters: false,
  fuzzy: false,
  totals: false,
})

/** Подпись коррекции запроса (структурно — `SearchCorrectionInfo` из lib search). */
export type SourceCorrectionInfo = { query: string; corrected: string; changed: boolean }

/**
 * Клиентское fuzzy-усиление (lib search): что индексировать, чем править опечатки
 * и каков бюджет добора у ЖИВОГО источника. Типы нарочно структурные — lib/search
 * принимает эти же поля, но ядро о нём не знает.
 */
export type SourceFuzzySpec<T> = {
  /** Стабильный id записи (дедупликация между батчами). */
  id: (record: T) => string
  /** Тексты записи для ранжирования (название, синонимы, …). */
  texts: (record: T) => readonly string[]
  /** Клиентская коррекция запроса; `null` — словарь недоступен (запасной контур). */
  correct?: (query: string) => Promise<SourceCorrectionInfo | null>
  /** Размер батча источника при поиске (у живого API — его потолок). */
  batchSize?: number
  /** Бюджет батчей на один вызов страницы. */
  maxBatchesPerCall?: number
  /** Потолок бюджета при прыжке на далёкую страницу (deep-link). */
  maxBatchesDeepLink?: number
  /** Сколько батчей летит параллельно. */
  parallelBatches?: number
}

/** Родной поиск источника: как он объявлен. Нет спецификации — источник без поиска. */
export type SourceSearchSpec<T> = {
  /** Ключ extra с запросом. @default 'q' */
  param?: string
  /**
   * Активен ли родной поиск при таком extra. Демо «отключить поиск» живёт здесь:
   * выключено — оболочка убирает запрос ДО источника, а не источник его игнорирует.
   */
  enabled?: (extra: Extra) => boolean
  /** Санитайз запроса из недоверенного адреса (deny-safe). @default — общая нормализация. */
  sanitize?: (raw: unknown) => string | undefined
  /** Минимальная длина запроса для fuzzy-контура (короткий — сквозной каталог). @default 2 */
  minLength?: number
  /** lib search поверх родного поиска. Нет — fuzzy подключить нельзя (возможность `fuzzy`). */
  fuzzy?: SourceFuzzySpec<T>
}

/** Значения фильтров: ключ поля → выбранные значения (в порядке интерфейса). */
export type SourceFilterValues = Readonly<Record<string, readonly string[]>>

/** Опция фильтра: значение + подпись (счётчики появятся, только если источник их даёт). */
export type SourceFilterOption = { value: string; label: string; count?: number }

/** Поле схемы фильтров. */
export type SourceFilterField = {
  key: string
  label: string
  type: 'select' | 'multiselect' | 'threshold'
  options?: readonly SourceFilterOption[]
  /** Режимы множественного поля: «совпадение» и/или «исключение». */
  modes?: readonly ('is' | 'not')[]
  min?: number
  max?: number
}

/** Условие связки: поле присутствует и/или несёт значения. */
export type SourceFilterCondition = { field: string; values?: readonly string[]; present?: boolean }

/** Связка: что с чем совместимо у ЭТОГО источника (уточняется на этапе схемы). */
export type SourceFilterRule =
  /** При таких фильтрах родной поиск запрещён. */
  | { kind: 'search-off'; when: SourceFilterCondition; reason?: string }
  /** Два условия несовместимы: второе поле скрыть или выключить. */
  | { kind: 'incompatible'; a: SourceFilterCondition; b: SourceFilterCondition; mode?: 'hide' | 'disable'; reason?: string }
  /** Поле доступно только при выполнении условия (иначе скрыто/выключено). */
  | { kind: 'requires'; field: string; when: SourceFilterCondition; mode?: 'hide' | 'disable'; reason?: string }

/** Схема фильтров источника: значения и связки в его зоне ответственности. */
export type SourceFilterSchema = {
  /** Идентификатор источника/схемы (кэш и адрес). */
  id: string
  /** Версия контракта схемы. */
  version: number
  /** Метка, когда схема собрана (ISO) — клиент показывает/пересобирает по ней. */
  builtAt: string
  /** Через сколько миллисекунд схему стоит обновить (нет — бессрочно/по запросу). */
  refreshMs?: number
  fields: readonly SourceFilterField[]
  rules?: readonly SourceFilterRule[]
}

/** Фильтры источника: провайдер схемы и перевод значений в параметры запроса. */
export type SourceFiltersSpec<T> = {
  /** Схема (поля, значения, связки). Считается в зоне ответственности источника. */
  schema(): Promise<SourceFilterSchema>
  /** Значения фильтров → параметры запроса источника (единственное место знания транспорта). */
  params?(values: SourceFilterValues, extra: Extra): Record<string, unknown>
}

/** Определение источника: данные, которые пишет приложение. */
export type SourceDefinition<T> = {
  id: string
  label: string
  /** Источник отдаёт число страниц (totalItems/totalPages) — возможны номера страниц. */
  totals?: boolean
  /** Ключи extra, от которых зависят ДАННЫЕ источника (смена → сброс на стр. 1). */
  dataKeys?: readonly string[]
  /** Родной поиск: спецификация или функция от extra (у переключателя — от выбора). */
  search?: SourceSearchSpec<T> | ((extra: Extra) => SourceSearchSpec<T> | undefined)
  /** Фильтры: спецификация или функция от extra. */
  filters?: SourceFiltersSpec<T> | ((extra: Extra) => SourceFiltersSpec<T> | undefined)
  /** Возможности состава (переключатель источников); нет — считаются по спецификациям. */
  capabilities?: (extra: Extra) => SourceCapabilities
  /**
   * Какие ключи extra «принадлежат» какой возможности. Объявив их, источник
   * разрешает оболочке ЧИСТИТЬ ключи, которых у текущего выбора нет: переключение
   * на источник без поиска уносит его ключи из хранилища (адрес/localStorage),
   * а не оставляет их молча висеть. Нет объявления — оболочка ничего не трогает.
   */
  capabilityKeys?: CapabilityKeys
  /**
   * Транспорт: страница источника. `q` уже нормализован оболочкой, отмена едет
   * в `req.signal`. Дополнительного окружения нет: каким клиентом ходить в сеть,
   * решает сам источник (SSR/браузер — его знание, а не канала доставки).
   */
  page(req: PageRequest): Promise<PageResponse<T>>
}

/**
 * Адаптированный источник — то, что принимает пагинатор. Объект заморожен:
 * подмена `page`/возможностей после регистрации — это уже другой источник.
 */
export type AdaptedSource<T> = {
  readonly [SOURCE_BRAND]: true
  readonly id: string
  readonly label: string
  readonly definition: SourceDefinition<T>
  /** Ключи extra, влияющие на данные (для `reloadKeys` пагинатора). */
  readonly dataKeys: readonly string[]
  /** Ключи по возможностям (объявлены источником; пусто — оболочка не чистит). */
  readonly capabilityKeys: CapabilityKeys
  /** Возможности на текущий выбор (у переключателя зависят от `extra`). */
  capabilitiesFor(extra: Extra): SourceCapabilities
  /** Активная спецификация родного поиска (undefined — источник без поиска). */
  searchFor(extra: Extra): SourceSearchSpec<T> | undefined
  /** Активная спецификация фильтров (undefined — фильтров нет). */
  filtersFor(extra: Extra): SourceFiltersSpec<T> | undefined
  /** Страница источника: запрос уже нормализован (пустой/выключенный не доходит). */
  page(req: PageRequest): Promise<PageResponse<T>>
}

/** Общая нормализация запроса: управляющие символы, обрезка, пустое → undefined. */
export function sanitizeQueryValue(raw: unknown, maxLength = 120): string | undefined {
  if (raw == null) return undefined
  const value = String(raw)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, maxLength)
  return value.length > 0 ? value : undefined
}

function resolveSearch<T>(
  definition: SourceDefinition<T>,
  extra: Extra,
): SourceSearchSpec<T> | undefined {
  const spec = definition.search
  if (!spec) return undefined
  return typeof spec === 'function' ? spec(extra) : spec
}

function resolveFilters<T>(
  definition: SourceDefinition<T>,
  extra: Extra,
): SourceFiltersSpec<T> | undefined {
  const spec = definition.filters
  if (!spec) return undefined
  return typeof spec === 'function' ? spec(extra) : spec
}

/** Источник, созданный этим слоем (а не объект, лишь повторяющий его форму). */
export function isAdaptedSource<T = unknown>(value: unknown): value is AdaptedSource<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[SOURCE_BRAND] === true
  )
}

/** Deny by default: пагинатор принимает только адаптированные источники. */
export function assertAdaptedSource<T = unknown>(
  value: unknown,
  where: string,
): asserts value is AdaptedSource<T> {
  if (isAdaptedSource(value)) return
  throw new Error(
    `[paginate] ${where}: источник должен быть создан через defineSource() из lib/paginate/source; ` +
      `обычная функция или объект с той же формой пагинатором не принимается`,
  )
}

/**
 * Создать адаптированный источник: бренд, возможности, спецификации и гейт
 * запроса. Это единственный способ получить объект, который примет пагинатор.
 */
export function defineSource<T>(definition: SourceDefinition<T>): AdaptedSource<T> {
  const dataKeys = Object.freeze([...new Set(definition.dataKeys ?? [])])
  const capabilityKeys: CapabilityKeys = Object.freeze(
    Object.fromEntries(
      Object.entries(definition.capabilityKeys ?? {}).map(([capability, list]) => [
        capability,
        Object.freeze([...(list ?? [])]),
      ]),
    ),
  )
  const queryKey = (extra: Extra): string =>
    resolveSearch(definition, extra)?.param ?? 'q'

  const capabilitiesFor = (extra: Extra): SourceCapabilities => {
    if (definition.capabilities) return definition.capabilities(extra)
    const search = resolveSearch(definition, extra)
    const filters = resolveFilters(definition, extra)
    return Object.freeze({
      search: Boolean(search),
      filters: Boolean(filters),
      fuzzy: Boolean(search?.fuzzy),
      totals: definition.totals === true,
    })
  }

  /**
   * Запрос до источника доходит уже нормализованным: недоверенная строка из
   * адреса санитазится, выключенный поиск (`spec.enabled === false`) и источник
   * без поиска запрос вообще не получают — оболочка знает возможности и не
   * перекладывает это на источник.
   */
  const page = async (req: PageRequest): Promise<PageResponse<T>> => {
    const extra: Extra = { ...(req.extra ?? {}) }
    const param = queryKey(extra)
    const spec = resolveSearch(definition, extra)
    if (!spec) {
      delete extra[param]
    } else {
      const enabled = spec.enabled ? spec.enabled(extra) : true
      const value = enabled ? (spec.sanitize ?? sanitizeQueryValue)(extra[param]) : undefined
      if (value === undefined) delete extra[param]
      else extra[param] = value
    }
    return definition.page({ ...req, extra })
  }

  const source: AdaptedSource<T> = {
    [SOURCE_BRAND]: true,
    id: definition.id,
    label: definition.label,
    definition,
    dataKeys,
    capabilityKeys,
    capabilitiesFor,
    searchFor: (extra) => resolveSearch(definition, extra),
    filtersFor: (extra) => resolveFilters(definition, extra),
    page,
  }
  return Object.freeze(source)
}

/**
 * Возможности источника для текущего extra (сокращение для UI и панелей).
 * Неизвестный/чужой объект → минимальные возможности: врать про умения нельзя.
 */
export function sourceCapabilities<T>(source: AdaptedSource<T> | undefined, extra?: Extra): SourceCapabilities {
  if (!isAdaptedSource(source)) return NO_CAPABILITIES
  return source.capabilitiesFor(extra ?? {})
}

/**
 * Ключи, которых у выбранного источника нет: `undefined` в патче `setExtra`
 * означает УДАЛЕНИЕ ключа (запись идёт через хранилище, «из-под полы» ничего
 * не чистится). Применяется при переключении источника: у нового нет поиска —
 * его ключи уезжают из адреса/localStorage вместе с переключением.
 */
export function clearedKeys(
  source: CapabilitySource,
  extra: Extra,
  keys: CapabilityKeys,
): Record<string, ExtraValue | undefined> {
  const caps = source.capabilitiesFor(extra)
  const patch: Record<string, ExtraValue | undefined> = {}
  for (const [capability, list] of Object.entries(keys) as [SourceCapability, readonly string[]][]) {
    if (caps[capability]) continue
    for (const key of list) patch[key] = undefined
  }
  return patch
}

/**
 * Согласовать патч extra с возможностями источника: ключи возможностей, которых
 * у ТЕКУЩЕГО выбора нет, снимаются в ТОМ ЖЕ патче. Так одна запись в хранилище
 * (адрес/localStorage) и один перезаход на страницу 1 закрывают переключение —
 * «мёртвый» параметр не остаётся висеть молча и не требует второй записи.
 * Ключи объявляет сам источник (`capabilityKeys`); нет объявления — патч как есть.
 */
export function clearUnsupportedKeys(
  source: CapabilitySource | null | undefined,
  extra: Extra,
  patch: Record<string, ExtraValue | undefined>,
): Record<string, ExtraValue | undefined> {
  if (!isAdaptedSource(source)) return patch
  const keys = source.capabilityKeys
  if (!keys || Object.keys(keys).length === 0) return patch
  const next: Extra = { ...extra }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete next[k]
    else next[k] = v
  }
  const cleared = clearedKeys(source, next, keys)
  let touched = false
  const out: Record<string, ExtraValue | undefined> = { ...patch }
  for (const k of Object.keys(cleared)) {
    // Снимаем только то, что реально где-то есть: в патче или в самом extra.
    if (patch[k] !== undefined || k in next) out[k] = undefined
    if (out[k] === undefined && (patch[k] !== undefined || k in next)) touched = true
  }
  return touched ? out : patch
}

/**
 * Источник-переключатель: один пагинатор обслуживает несколько источников,
 * выбор — ключом extra (`kind`). Возможности, спецификации поиска/фильтров и
 * страницы делегируются ВЫБРАННОМУ источнику, поэтому UI всегда видит правду о
 * текущем выборе, а не пересечение умений всех сразу.
 */
export function defineSourceSwitch<T>(config: {
  id: string
  label: string
  /** Ключ extra, выбирающий источник. */
  key: string
  sources: Record<string, AdaptedSource<T>>
  /** Источник по умолчанию (ключ пуст или неизвестен). */
  fallback: string
  /** Собственные ключи данных переключателя (в дополнение к ключам источников). */
  dataKeys?: readonly string[]
  /** Ключи по возможностям (свои у переключателя: `q`, `fuzzy`, …). */
  capabilityKeys?: CapabilityKeys
}): AdaptedSource<T> {
  const { key, sources, fallback } = config
  const fallbackSource = sources[fallback]
  if (!fallbackSource) {
    throw new Error(`[paginate] defineSourceSwitch("${config.id}"): нет источника по умолчанию "${fallback}"`)
  }
  const pick = (extra: Extra): AdaptedSource<T> => {
    const raw = extra[key]
    const name = typeof raw === 'string' ? raw : ''
    return sources[name] ?? fallbackSource
  }
  const dataKeys = [
    ...new Set([key, ...(config.dataKeys ?? []), ...Object.values(sources).flatMap((source) => [...source.dataKeys])]),
  ]
  return defineSource<T>({
    id: config.id,
    label: config.label,
    dataKeys,
    capabilityKeys: config.capabilityKeys,
    capabilities: (extra) => pick(extra).capabilitiesFor(extra),
    search: (extra) => pick(extra).searchFor(extra),
    filters: (extra) => pick(extra).filtersFor(extra),
    page: (req) => pick(req.extra ?? {}).page(req),
  })
}
