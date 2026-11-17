/**
 * Единое описание extra-ключей списка (P2-2).
 *
 * До этого каждый хост перечислял внутренние ключи (`_uid`, `_journal`) дважды —
 * в `filters` источника и в `reloadKeys` пагинатора, — и обе копии обязаны были
 * совпадать с адресной спекой. Расхождение тихо ломало либо догрузку (ключ не
 * доехал до источника), либо сброс окна (смена цели не пересобирала выдачу).
 *
 * `defineListExtras` — одно описание на хост: адресные ключи (`searchable`) и
 * внутренние (`internal`). Из него выводятся `filterKeys` (что понимает
 * источник) и `reloadKeys` (смена чего пересобирает выдачу). Внутренние ключи
 * объявляются один раз и в адрес не попадают by construction: `extraSearch`
 * содержит только `searchable`.
 */
import type { Extra } from './types'
import type { ExtraSearchSpec } from './adapter-url'

/** Описание extra-ключей одного списка. */
export interface ListExtrasSpec {
  /**
   * Адресные ключи: живут в URL (`extraSearch` URL-адаптера) и влияют на
   * выдачу. Сюда же входит `q` родного поиска и срезы вроде `ids`, если они
   * адресные. Умолчания передаются отдельно (`defaults`).
   */
  searchable: ExtraSearchSpec
  /**
   * Внутренние ключи `extra`: влияют на выдачу (входят в `filterKeys` и
   * `reloadKeys`), но в адрес НЕ пишутся — цель списка (`_uid`) или признак
   * журнала (`_journal`), которые задаёт путь/проп, а не адресная строка.
   */
  internal?: readonly string[]
  /** Умолчания адресных ключей (в адрес не пишутся — чистый URL). */
  defaults?: Extra
}

/** Выведенное описание: один источник правды для источника и пагинатора. */
export interface ListExtras {
  /** Адресные ключи (порядок объявления в `searchable`). */
  readonly searchableKeys: readonly string[]
  /** Внутренние ключи (порядок объявления). */
  readonly internalKeys: readonly string[]
  /** Ключи, которые понимает источник: адресные + внутренние (`defineSource.filters`). */
  readonly filterKeys: readonly string[]
  /** Ключи, смена которых пересобирает выдачу (`definePaginator.reloadKeys`). */
  readonly reloadKeys: readonly string[]
  /** Спека адресного слоя: только адресные ключи (та же ссылка, что передана). */
  readonly extraSearch: ExtraSearchSpec
  /** Умолчания адресных ключей (та же ссылка, что передана). */
  readonly extraDefaults: Extra
}

/**
 * Собирает описание extra-ключей списка. Чистая функция: не регистрирует
 * пагинатор и не читает адрес — только выводит ключи из одного описания.
 *
 * ```ts
 * const extras = defineListExtras({
 *   searchable: SESSIONS_EXTRA_SEARCH,
 *   internal: [SESSIONS_INTERNAL_UID_KEY, SESSIONS_INTERNAL_JOURNAL_KEY],
 *   defaults: SESSIONS_EXTRA_DEFAULTS,
 * })
 * defineSource({ filters: [...extras.filterKeys], ... })
 * definePaginator({ reloadKeys: [...extras.reloadKeys], adapter: createUrlAdapter({ extraSearch: extras.extraSearch, ... }) })
 * ```
 */
export function defineListExtras(spec: ListExtrasSpec): ListExtras {
  const searchableKeys = Object.keys(spec.searchable)
  const internalKeys = [...(spec.internal ?? [])]
  const searchableSet = new Set(searchableKeys)
  // Внутренний ключ не должен быть адресным: иначе он утёк бы в URL через
  // extraSearch. Конструкция это исключает, но явное пересечение — ошибка
  // описания, о которой стоит сказать в разработке.
  for (const key of internalKeys) {
    if (searchableSet.has(key)) {
      throw new Error(`[defineListExtras] ключ "${key}" объявлен и адресным, и внутренним`)
    }
  }
  // `q` — зарезервированный ключ родного поиска: `defineSource` сам добавляет
  // его в `extraKeys` при объявленном `search`, поэтому в `filters` источника он
  // не входит (иначе ключ задвоился бы и поиск поехал бы как фильтр). В
  // `reloadKeys` при этом входит: смена запроса пересобирает выдачу.
  const filterKeys = [...searchableKeys.filter((key) => key !== 'q'), ...internalKeys]
  return Object.freeze({
    searchableKeys,
    internalKeys,
    filterKeys,
    // Каждая смена extra-ключа (адресного или внутреннего, включая `q`) —
    // новая выдача с первой порции.
    reloadKeys: [...searchableKeys, ...internalKeys],
    extraSearch: spec.searchable,
    extraDefaults: spec.defaults ?? {},
  })
}
