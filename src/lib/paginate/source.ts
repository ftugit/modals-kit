/**
 * Слой источника — общий api, через который пагинатор получает данные.
 *
 * Источник здесь не «функция, которая что-то возвращает», а адаптированный
 * объект: он ОБЪЯВЛЯЕТ свои возможности (родной поиск, разрешение сканирования
 * для lib/search, фильтры, полные totals), носит паспорт записи (id/title/texts)
 * и получает на вход только то, что понимает (`SourceInput`, без UI-ключей).
 *
 * Правила слоя (инварианты этапа):
 *  • пагинатор принимает ИСКЛЮЧИТЕЛЬНО адаптированный источник — бренд ставит
 *    только фабрика этого модуля, «эмуляция» общего api не пройдёт
 *    (`assertAdaptedSource` бросает);
 *  • возможности источника видит пагинатор и раздаёт UI: чего источник не
 *    умеет — то в интерфейсе выключено (а не «включено, но молча ничего не
 *    делает»);
 *  • неподдерживаемое молча не доезжает до данных (deny-safe): `q` у источника
 *    без поиска, фильтры у источника без фильтров — отсекаются на слое;
 *  • запись возможностей не «из-под полы»: всё живёт в extra хранилища
 *    (url/local/память), а слой отвечает за то, чтобы ключи были объявлены.
 */
import type { Extra, PageResponse } from './types'

/**
 * Бренд адаптированного источника. Символ модульный (не `Symbol.for`): объект с
 * брендом может создать только этот модуль, снаружи подделать нельзя.
 */
const SOURCE_BRAND: unique symbol = Symbol('modals-kit.adapted-source')

/** Как слой обращается к данным: страница и отменяемость. UI-ключей здесь нет. */
export type SourceLook = { page: number; pageSize: number; signal?: AbortSignal }

/** Паспорт записи: как читать ЛЮБУЮ запись источника (вьюхи, lib/search, словарь). */
export type SourceRecordSpec<T> = {
  /** Стабильный id записи (дедупликация в lib/search, ключи списков). */
  id: (record: T) => string
  /** Человекочитаемое название (заголовок строки/плитки). */
  title: (record: T) => string
  /** Тексты для сопоставления: название + алиасы (fuzzy и словарь коррекции). */
  texts: (record: T) => readonly string[]
}

/**
 * Вход данных источника — только объявленное самим источником:
 * разрешённый запрос и значения его фильтров. Никаких ключей раскладки/режима:
 * источник физически не может зависеть от UI.
 */
export type SourceInput = {
  /** Разрешённый запрос ('' — поиск к данным не применяется). */
  q: string
  /** Значения объявленных фильтров (`filters` в спеке). */
  filters: Readonly<Record<string, string>>
}

export type SourceData<T> = (look: SourceLook, input: SourceInput) => Promise<PageResponse<T>>

/**
 * Возможности источника — то, что пагинатор показывает UI и по чему UI гасит
 * функции. Набор собирается из спеки и декораторов, поэтому «наличие
 * возможности» — свойство самого источника, а не константа потребителя.
 */
export type SourceCapabilities = {
  /** Родной поиск: источник сам сужает выдачу по `q`. */
  search?: { minLength: number }
  /**
   * РАЗРЕШЕНИЕ сканирования (ставит `scan` в спеке): источник допускает, что
   * его просмотрят страницами целиком. Само по себе поиска не даёт — поиск
   * поверх появляется только с подключённым lib/search (`fuzzy`).
   */
  scan?: { batchSize?: number }
  /** lib/search подключён поверх источника (fuzzy-скан): ставит `withLibSearch`. */
  fuzzy?: { minLength: number; batchSize?: number }
  /** Фильтры источника: ключи extra, которые он понимает (этап 3 добавит схему). */
  filters?: { keys: readonly string[] }
  /** Ответы источника несут полные totals (номерная навигация у потребителя). */
  totals: boolean
}

/** Пустые возможности: источник — просто данные. */
export const EMPTY_CAPABILITIES: SourceCapabilities = { totals: false }

/** Декоратор источника: «обернуть — дополнить возможностью/поведением». */
export type SourceDecorator<T> = (base: AdaptedSource<T>) => AdaptedSource<T>

/** Адаптированный источник — единственная форма, которую принимает пагинатор. */
export type AdaptedSource<T> = {
  readonly [SOURCE_BRAND]: true
  readonly name: string
  /** Возможности ДЛЯ ТЕКУЩЕГО extra: композиция может менять источник по ключу. */
  capabilitiesFor(extra?: Extra): SourceCapabilities
  /** Паспорт записи текущего выбора. */
  recordFor(extra?: Extra): SourceRecordSpec<T>
  /** Ключи extra, которые понимает источник (`q` + объявленные фильтры). */
  extraKeys(): readonly string[]
  /** Артефакт словаря терминов — источник отдаёт его lib/search (если подключён). */
  dictionary?(): Promise<string>
  /** Единственный путь к данным: страница + extra (разрешение внутри слоя). */
  fetchPage(look: SourceLook, extra?: Extra): Promise<PageResponse<T>>
  /** Дополнить источник (иммутабельно): `defineSource(...).with(withLibSearch(...))`. */
  with(decorator: SourceDecorator<T>): AdaptedSource<T>
}

/** Спецификация источника — то, что объявляет автор источника. */
export type SourceSpec<T> = {
  /** Имя источника (в имени пагинатора/логах/тестах). */
  name: string
  /** Данные: «страница N размера M по такому входу». */
  data: SourceData<T>
  /** Паспорт записи. */
  record: SourceRecordSpec<T>
  /** Родной поиск: `data` получает `q` (короче `minLength` — как пустой). */
  search?: { minLength?: number }
  /** Разрешение сканирования (для `withLibSearch`); без него fuzzy не подключить. */
  scan?: { batchSize?: number }
  /** Ключи фильтров, которые источник понимает (этап 3: + схема полей). */
  filters?: readonly string[]
  /** Ответы несут полные totals. */
  totals?: boolean
  /** Артефакт словаря терминов для коррекции запроса. */
  dictionary?: () => Promise<string>
}

/** Внутренняя форма: адаптер бренда и метод `.with` добавляются в `adapt`. */
type SourceCore<T> = Omit<AdaptedSource<T>, typeof SOURCE_BRAND | 'with'>

function adapt<T>(core: SourceCore<T>): AdaptedSource<T> {
  const source: AdaptedSource<T> = {
    ...core,
    [SOURCE_BRAND]: true,
    with(decorator) {
      return decorator(source)
    },
  } as AdaptedSource<T>
  return source
}

/** Обёртка декоратора: поля не переопределены — делегируются базе. */
function wrap<T>(base: AdaptedSource<T>, over: Partial<SourceCore<T>>): AdaptedSource<T> {
  const dictionary = over.dictionary ?? base.dictionary?.bind(base)
  return adapt<T>({
    name: over.name ?? base.name,
    capabilitiesFor: over.capabilitiesFor ?? ((extra) => base.capabilitiesFor(extra)),
    recordFor: over.recordFor ?? ((extra) => base.recordFor(extra)),
    extraKeys: over.extraKeys ?? (() => base.extraKeys()),
    ...(dictionary ? { dictionary } : {}),
    fetchPage: over.fetchPage ?? ((look, extra) => base.fetchPage(look, extra)),
  })
}

/** Адаптированный ли источник (единственный пропуск в пагинатор). */
export function isAdaptedSource<T = unknown>(value: unknown): value is AdaptedSource<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[SOURCE_BRAND] === true &&
    typeof (value as AdaptedSource<T>).fetchPage === 'function' &&
    typeof (value as AdaptedSource<T>).capabilitiesFor === 'function'
  )
}

/**
 * Пропуск в пагинатор: неадаптированный источник — ошибка разработчика, а не
 * «тихо работающий» объект. Сообщение объясняет, чем чинить.
 */
export function assertAdaptedSource<T>(value: unknown, where: string): AdaptedSource<T> {
  if (!isAdaptedSource<T>(value)) {
    throw new Error(
      `${where}: источник не адаптирован. Пагинатор принимает только ` +
        `defineSource(...) с декораторами $lib/paginate — объект, эмулирующий api слоя, не принимается.`,
    )
  }
  return value
}

function devWarn(message: string): void {
  if (typeof process === 'undefined' || process.env?.NODE_ENV !== 'production') {
    console.warn(message)
  }
}

/** Разрешённый запрос: строка, trim, порог длины (короче — как пустой). */
export function resolveQuery(raw: unknown, minLength: number): string {
  if (raw == null) return ''
  const q = String(raw).replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  return q.length >= Math.max(1, minLength) ? q : ''
}

/** Значения объявленных фильтров: только известные ключи, пустые опускаются. */
export function resolveFilters(extra: Extra | undefined, keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of keys) {
    const value = extra?.[key]
    if (value === undefined || value === null || value === '') continue
    out[key] = String(value)
  }
  return out
}

/**
 * Источник из спецификации. Возможности — из объявленного: нет `search` —
 * запрос к данным не поедет; нет `filters` — фильтровые ключи источник не
 * увидит. Скрытых переключателей здесь нет.
 */
export function defineSource<T>(spec: SourceSpec<T>): AdaptedSource<T> {
  const minLength = Math.max(1, spec.search?.minLength ?? 1)
  const filterKeys = [...(spec.filters ?? [])]
  const capabilities: SourceCapabilities = {
    ...(spec.search ? { search: { minLength } } : {}),
    ...(spec.scan ? { scan: { ...spec.scan } } : {}),
    ...(filterKeys.length ? { filters: { keys: filterKeys } } : {}),
    totals: spec.totals ?? false,
  }
  return adapt<T>({
    name: spec.name,
    capabilitiesFor: () => capabilities,
    recordFor: () => spec.record,
    extraKeys: () => (spec.search ? ['q', ...filterKeys] : filterKeys),
    ...(spec.dictionary ? { dictionary: spec.dictionary } : {}),
    fetchPage: (look, extra) => {
      const rawQuery = extra?.q
      if (!spec.search && typeof rawQuery === 'string' && rawQuery.trim() !== '') {
        devWarn(
          `[source:${spec.name}] запрос «${rawQuery}» отброшен: источник не объявляет родной поиск ` +
            `(нужен \`search\` в спеке либо lib/search поверх \`scan\`).`,
        )
      }
      return spec.data(look, {
        q: spec.search ? resolveQuery(rawQuery, minLength) : '',
        filters: resolveFilters(extra, filterKeys),
      })
    },
  })
}

/**
 * Композиция источников с выбором по ключу extra (демо: `src`).
 *
 * Возможности резолвятся по ТЕКУЩЕМУ выбору: панель гасит функции того
 * источника, который выбран сейчас. `extraKeys()` — объединение по всем
 * вариантам: ключ, понятный хотя бы одному из них, слой не запрещает (после
 * переключения он снова осмыслен).
 */
export function composeSources<T>(
  variants: Readonly<Record<string, AdaptedSource<T>>>,
  opts: { select: (extra?: Extra) => string; name?: string },
): AdaptedSource<T> {
  const names = Object.keys(variants)
  if (!names.length) throw new Error('composeSources: пустой набор источников')
  for (const [key, source] of Object.entries(variants)) {
    assertAdaptedSource<T>(source, `composeSources("${key}")`)
  }
  const pick = (extra?: Extra): AdaptedSource<T> => {
    const key = opts.select(extra)
    const source = variants[key]
    if (!source) {
      throw new Error(`composeSources: неизвестный источник «${key}» (есть: ${names.join(', ')})`)
    }
    return source
  }
  const allKeys = [...new Set(names.flatMap((key) => [...variants[key].extraKeys()]))]
  return adapt<T>({
    name: opts.name ?? 'composed',
    capabilitiesFor: (extra) => pick(extra).capabilitiesFor(extra),
    recordFor: (extra) => pick(extra).recordFor(extra),
    extraKeys: () => allKeys,
    // async: неизвестный выбор — отказ промиса, а не синхронный throw из
    // середины кадра (у источника тот же контракт: только промис).
    async fetchPage(look, extra) {
      return pick(extra).fetchPage(look, extra)
    },
  })
}

/**
 * Декоратор «тумблер родного поиска»: при `extra[gate] === false` источник
 * получает ПУСТОЙ запрос, хотя `q` остаётся в extra — его читает lib/search,
 * и тогда работает сканирование без сужения источником. Это механизм слоя, а
 * не ветка внутри источника: и пагинатор, и lib/search видят одну картину.
 */
export function withSearchGate<T>(opts: { gate: string; key?: string }): SourceDecorator<T> {
  const key = opts.key ?? 'q'
  return (base) =>
    wrap<T>(base, {
      fetchPage: async (look, extra) => {
        if (extra?.[opts.gate] === false) {
          return base.fetchPage(look, { ...(extra ?? {}), [key]: '' })
        }
        return base.fetchPage(look, extra)
      },
    })
}

/**
 * Декоратор «полные totals по тумблеру потребителя»: при `extra[gate] === false`
 * ответ теряет totals, номера страниц гаснут (R12 — навигация только стрелками),
 * и возможности вслед за тумблером объявляют `totals: false`. Это механизм слоя,
 * а не ветка потребителя: и пагинатор, и UI видят одно состояние, источник —
 * по-прежнему ничего не знает про UI (его данные отдают totals всегда).
 */
export function withTotalsGate<T>(opts: { gate: string }): SourceDecorator<T> {
  const enabled = (base: AdaptedSource<T>, extra?: Extra): boolean =>
    base.capabilitiesFor(extra).totals && extra?.[opts.gate] !== false
  return (base) =>
    wrap<T>(base, {
      capabilitiesFor: (extra) => ({ ...base.capabilitiesFor(extra), totals: enabled(base, extra) }),
      fetchPage: async (look, extra) => {
        const res = await base.fetchPage(look, extra)
        if (enabled(base, extra)) return res
        return {
          items: res.items,
          hasNext:
            res.hasNext ??
            (res.totalItems != null ? look.page * look.pageSize < res.totalItems : res.items.length > 0),
        }
      },
    })
}

/**
 * Точечные переопределения оболочки: каждая функция получает БАЗУ, поэтому
 * обёртка может делегировать (например, дополнить возможности источника, а не
 * заменить их). Ставится через `defineSource(...).with(decorateSource({...}))`.
 */
export type SourceOverrides<T> = {
  name?: string
  capabilitiesFor?: (base: AdaptedSource<T>, extra?: Extra) => SourceCapabilities
  recordFor?: (base: AdaptedSource<T>, extra?: Extra) => SourceRecordSpec<T>
  extraKeys?: (base: AdaptedSource<T>) => readonly string[]
  dictionary?: () => Promise<string>
  fetchPage: (base: AdaptedSource<T>, look: SourceLook, extra?: Extra) => Promise<PageResponse<T>>
}

/** Публичный конструктор обёрток (lib/search, транспорт SSR и прочие слои). */
export function decorateSource<T>(over: SourceOverrides<T>): SourceDecorator<T> {
  return (base) =>
    wrap<T>(base, {
      ...(over.name !== undefined ? { name: over.name } : {}),
      capabilitiesFor: over.capabilitiesFor
        ? (extra) => over.capabilitiesFor!(base, extra)
        : undefined,
      recordFor: over.recordFor ? (extra) => over.recordFor!(base, extra) : undefined,
      extraKeys: over.extraKeys ? () => over.extraKeys!(base) : undefined,
      ...(over.dictionary ? { dictionary: over.dictionary } : {}),
      // async: у слоя один контракт — отказ приезжает отказом промиса, а не
      // синхронным throw из середины кадра вызывающего.
      fetchPage: async (look, extra) => over.fetchPage(base, look, extra),
    })
}

/**
 * Средовой признак «серверный рендер» без привязки к фреймворку: там, где нет
 * `window` (Node/SSR), клиентские контуры (fuzzy lib/search) не исполняются —
 * работает серверное сужение источника.
 */
export function isServerSide(): boolean {
  return typeof window === 'undefined'
}

/**
 * Ключи возможностей, по которым UI гасит функции: у панели настроек поле
 * помечается `requires: 'nativeSearch'`, у демо так же гаснут `srch`/`ls`/`total`.
 */
export type FeatureGate = 'nativeSearch' | 'libSearch' | 'filters' | 'totals'

/** Возможности выбранного источника глазами UI: то, что можно включать. */
export function featureGates(capabilities: SourceCapabilities): Record<FeatureGate, boolean> {
  return {
    nativeSearch: capabilities.search !== undefined,
    libSearch: capabilities.fuzzy !== undefined,
    filters: capabilities.filters !== undefined,
    totals: capabilities.totals,
  }
}
