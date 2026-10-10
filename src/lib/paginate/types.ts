// Контракты lib paginate — ЕДИНСТВЕННАЯ дефиниция; клиент и сервер импортируют отсюда.
// Порт одноимённых контрактов React-версии (SPEC §3.1): без jotai/zod.
//
// Источник данных — АДАПТИРОВАННЫЙ объект слоя (`$lib/paginate/source`), а не
// произвольная функция: пагинатор обязан знать возможности источника (поиск,
// фильтры, totals) и раздавать их UI. Тип адаптера это фиксирует.
import type { AdaptedSource, SourceCapabilities } from './source'

export type MaybePromise<T> = T | Promise<T>

export type PageRequest = { page: number; pageSize: number; signal?: AbortSignal; extra?: Extra }

/** Конверт ответа источника. meta: хотя бы одно поле; приоритет вывода — deriveMeta. */
export type PageResponse<T> = {
  items: T[]
  totalItems?: number
  totalPages?: number
  hasNext?: boolean
  /**
   * Ключи extra, которые источник просит записать ПОСЛЕ этой страницы: указатель
   * следующего шага (keyset-токен) и всё, что источник узнаёт вместе с выдачей.
   * Это не условие выборки, а её результат, поэтому ядро НЕ сбрасывает по этим
   * ключам на первую страницу (иначе «загрузили → сбросили → загрузили»).
   * Принимаются только объявленные ключи (`extraKeys`), остальные отбрасываются с
   * предупреждением; пустое значение ключ снимает.
   */
  extra?: Readonly<Partial<Extra>>
}

/**
 * Форма вызова данных на границе адаптера. Источник — АДАПТИРОВАННЫЙ объект
 * (`AdaptedSource`), поэтому «просто функция» эту границу не проходит.
 */

/** Что хранилище может вернуть при восстановлении (валидируется на read, deny-safe). */
export type RestorableState = {
  page: number
  pageSize: number
  totalItems: number | null
  totalPages: number | null
  /**
   * Произвольные ключи потребителя (роута): раскладка, фильтры, флаги UI.
   * Хранилища (URL/localStorage) сохраняют и восстанавливают их вместе с page/pageSize;
   * ядро их не трактует. Только скаляры (string/number/boolean/null).
   */
  extra: Extra
  /** Opaque source/adapter state, restored only by a cursor-aware adapter. */
  sourceState?: string
}

export type ExtraValue = string | number | boolean | null
export type Extra = Record<string, ExtraValue>

/** Страница в полёте: mode — куда встанут данные; count — число слотов-скелетонов. */
export type PendingPage = { page: number; mode: 'append' | 'prepend' | 'replace'; count: number }

/** Группа страницы для UI: данные ИЛИ слоты-скелетоны (data ? <Card/> : <Skeleton/>). */
export type PageGroup<T> =
  { page: number; pending: false; items: T[] } | { page: number; pending: true; slots: number }

export type PaginatorState<T> = RestorableState & {
  name: string
  /** Отсортировано по возрастанию. */
  loadedPages: number[]
  /** accumulate копит страницы; single хранит одну. */
  pages: Record<number, T[]>
  status: 'init' | 'idle' | 'loading' | 'error'
  error: string | null
  /** D17: страница в полёте (скелетоны-слоты как часть view-модели, а не оверлей). */
  pending: PendingPage | null
  /** Из meta источника; null = неизвестно → только стрелки (R12). */
  hasNext: boolean | null
  /** Симметрично hasNext для подгрузки вверх; false после пустого append(-1) (D5). */
  hasPrev: boolean | null
  /** Внутренний счётчик гонок. В state (per-store) — SSR-конкурентность безопасна (D4). */
  reqId: number
  /** Opaque source/adapter state; paginator stores it but never interprets it. */
  sourceState?: string
  /**
   * Возможности выбранного источника (см. `$lib/paginate/source`). Величина
   * ВЫЧИСЛЯЕМАЯ (не restorable): резолвится адаптером из текущего extra при
   * init и каждой смене extra. UI читает отсюда и гасит невозможные функции.
   */
  capabilities: SourceCapabilities
}

export type AdapterInit<T> = {
  page: number
  pageSize?: number
  totalItems?: number | null
  totalPages?: number | null
  hasNext?: boolean | null
  /** Восстановленные ключи потребителя (см. RestorableState.extra). */
  extra?: Extra
  /** Opaque source state restored by a cursor-aware adapter. */
  sourceState?: string
  /** SSR: loader уже принёс данные — не рефетчить. */
  preloaded?: Record<number, T[]>
}

/** Адаптер — фасад source+storage (R4, R11). D1: без onPage — внешняя страница приходит через Host.externalPage. */
/** Контекст инициализации: loader передаёт url запроса (D6 — lib не импортирует server-only модули). */
export type AdapterInitContext = { url?: string }

/**
 * Контекст построения href: поиск текущего рендера (SSR-гонко-безопасно) + extra
 * состояния. `extra` нужен для ключей, которые приходят ОТ ИСТОЧНИКА (курсор
 * следующего шага): на сервере адрес править нечем, и без дописки ссылка вела бы
 * в другой адрес, чем клик с JavaScript. Адрес сильнее: дописывается только то,
 * чего в срезе поиска нет.
 */
export type HrefContext = { search?: Record<string, unknown> | null; extra?: Extra | null }

export type PaginatorAdapter<T> = {
  /**
   * href страницы для рендера ссылок пагинатора (SSR без JS). null — URL-семантики нет.
   * ctx.search — распарсенный поиск текущего рендера/локации (race-free на SSR);
   * без него адаптер использует привязанный роутер, затем поиск последнего getInitial.
   */
  hrefFor?(page: number, ctx?: HrefContext): string | null
  /**
   * Как транспорт читает ВНЕШНЕЕ состояние (адрес, back/forward, ссылка, форма).
   * Разбор принадлежит транспорту, а не хосту: формат знает только он. Хост лишь
   * отдаёт реактивный `search`. Метода нет → у транспорта нет наблюдаемых внешних
   * изменений: хост НЕ читает адрес вовсе, и гибрид «страница из хранилища,
   * фильтры из адреса» не возникает (важно для переключателя хранилища).
   */
  observeExternal?(search: Record<string, unknown> | undefined): AdapterExternal | null
  getInitial(ctx?: AdapterInitContext): MaybePromise<AdapterInit<T>>
  loadPage(req: PageRequest): Promise<PageResponse<T>>
  /** Пагинатор отдаёт ПОЛНЫЙ snapshot; storage/адаптер берут своё (R10). */
  persist(state: PaginatorState<T>): MaybePromise<void>
  capabilities: { append: boolean }
  /**
   * Возможности источника для текущего extra (см. `$lib/paginate/source`).
   * Пагинатор кладёт их в состояние — UI гасит функции, которых нет.
   */
  capabilitiesFor(extra: Extra): SourceCapabilities
  /**
   * Все ключи extra, которые пагинатор считает объявленными: источник
   * (`source.extraKeys()` — `q` и фильтры) плюс поверхность потребителя
   * (спецификация адреса/дефолты). `undefined` — поверхность не объявлена,
   * строгая проверка записи невозможна.
   */
  extraKeys?(): readonly string[] | undefined
  /** URL-адаптер: базовый search-ключ (`?page`, `?page.size`, `?page.<key>`); нужен UI-компонентам форм без JS. */
  pageParam?: string
}

/** Результат `observeExternal`: как транспорт видит текущее внешнее состояние. */
export type AdapterExternal = {
  /** Внешняя страница (например `?page`) или null, если транспорт её не несёт. */
  page: number | null
  /**
   * Внешние pageSize/extra. ВСЕ объявленные ключи присутствуют явно: снятый
   * (исчезнувший из адреса) приезжает как `undefined`, иначе дифф «внешнее →
   * стор» не увидит снятие фильтра. null — транспорт ими не управляет.
   */
  restorable: { pageSize?: number; extra: Extra } | null
}

export type PaginatorStorage = {
  read(name: string): MaybePromise<Partial<RestorableState> | null>
  write(name: string, snapshot: PaginatorState<unknown>): MaybePromise<void>
}

/**
 * Конверт ошибки — нормализованный ВЫХОД lib (Q1). `fatal` здесь нет намеренно:
 * lib не знает, чем рисуется страница; решение 500/консоль принимает хост.
 * Тип структурно дублируется в каждой lib — общего импорта между lib нет.
 */
export interface LibError {
  readonly lib: 'paginate'
  readonly code: 'init-failed' | 'load-failed' | 'persist-failed' | (string & {})
  readonly cause: unknown
  /** Что случилось вокруг: страница/фаза/сторона — набор кода определяет lib. */
  readonly ctx?: Record<string, unknown>
}

/** Приёмник ошибок: прокидывается в `definePaginator({ onError })` и в провайдер. */
export type ErrorSink = (e: LibError) => void

/** Конфиг регистрации: либо готовый адаптер, либо «источник + опции» (нормализуется в local-адаптер). */
export type PaginatorConfig<T> =
  | {
      name: string
      adapter: PaginatorAdapter<T>
      /** Дефолтный размер страницы адаптера (для начального state до init). */
      pageSize?: number
      maxPages?: number
      reloadKeys?: readonly string[]
      /**
       * Позиционные ключи extra (например указатель следующего шага): они описывают
       * место В выдаче, а не её условие, поэтому сброс окна обязаны снимать их.
       * Смысл появляется только рядом с `reloadKeys` — там, где выдача пересобирается.
       */
      positionKeys?: readonly string[]
      /** Приёмник ошибок ядра (Q1): init/load/persist сбоку. */
      onError?: ErrorSink
    }
  | {
      name: string
      source: AdaptedSource<T>
      pageSize?: number
      append?: boolean
      storage?: PaginatorStorage
      /** Ключи extra, объявленные потребителем (строгая проверка записи `setExtra`). */
      extraKeys?: readonly string[]
      maxPages?: number
      /** Ключи extra, влияющие на данные источника (смена → сброс + загрузка стр. 1). */
      reloadKeys?: readonly string[]
      /** Позиционные ключи extra: сброс окна по `reloadKeys` снимает их (см. выше). */
      positionKeys?: readonly string[]
      /** Приёмник ошибок ядра (Q1): init/load/persist сбоку. */
      onError?: ErrorSink
    }

export type PaginatorEvent =
  | { type: 'loaded'; page: number; itemCount: number; via: 'init' | 'replace' | 'append' }
  | { type: 'empty-page'; page: number }
  | { type: 'append-empty'; page: number }
  | { type: 'error'; error: unknown; page: number | null; phase: 'init' | 'replace' | 'append' }
  | { type: 'page-changed'; page: number; via: 'anchor' | 'go' | 'url' | 'init' }

export type ViewState = 'notReady' | 'loading' | 'error' | 'empty' | 'ready'

/** Команды скролла: ядро их запрашивает, scrollDriver хоста исполняет (SPEC §3.7). */
export type ScrollIntent = { type: 'top' } | { type: 'page'; page: number; reason?: 'prepend' } // reason:prepend — раунд-5

export type ScrollDriver = (intent: ScrollIntent) => void

export type EdgeTrigger = 'off' | 'direction' | 'edge' | 'chat' | 'manual'
export type PrependBehavior = 'auto' | 'native' | 'js'
