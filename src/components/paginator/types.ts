// Типы папочного UI-модуля пагинатора (`Paginator`, панель настроек, слоты).
import type { Snippet } from 'svelte'
import type {
  EdgeTrigger,
  Extra,
  ExtraValue,
  FeatureGate,
  LibError,
  PaginatorState,
  PrependBehavior,
  Stretch,
  TriggerZone,
} from '#lib/paginate/index.js'
import type { LoadMoreSlotRender } from '#lib/paginate/svelte/index.js'
import type { PaginatorHostVariants } from './variants.js'

/** Одна связка «поле доступно при значении другого». */
export interface PanelEnabledBy {
  /** Ключ поля этой же панели (без префикса адреса). */
  readonly field: string
  /** Доступно, когда поле равно этому значению. */
  readonly equals?: string | boolean
  /** Доступно, когда значение поля — из этого списка. */
  readonly in?: readonly (string | boolean)[]
  /** Причина для helper/ошибки, если автогенерации из условия недостаточно. */
  readonly reason?: string
}

export type SettingsField<V extends Record<string, ExtraValue> = Record<string, ExtraValue>> =
  | {
      key: keyof V & string
      label: string
      type: 'select'
      options: readonly (readonly [string, string])[]
      /** Маппер «значение формы → extra»: селект отдаёт строку, extra — тип. */
      parse?: (raw: string) => ExtraValue
      jsOnly?: boolean
      /** Возможность(и) источника, без которых параметр гасится с пояснением причины. */
      requires?: FeatureGate | readonly FeatureGate[]
      enabledBy?: readonly PanelEnabledBy[]
    }
  | {
      key: keyof V & string
      label: string
      type: 'toggle'
      jsOnly?: boolean
      requires?: FeatureGate | readonly FeatureGate[]
      enabledBy?: readonly PanelEnabledBy[]
    }
  | {
      type: 'divider'
      label?: string
    }

export type PageSliceFloating = 'top' | 'bottom' | false

export interface PageSliceOptions {
  /** Принудительное управление видимостью снаружи: `true` обходит `firstPageOnly`, `false` отключает показ. */
  enable?: boolean
  /** Показывать только на 1-й странице. */
  firstPageOnly?: boolean
  /** Плавающий блок облаком сверху/снизу (допустим только внутри `PaginatorHost` без явного `name`). */
  floating?: PageSliceFloating
  /** Постепенно скрывать при скролле по направлению потока (в режиме чата — вверх, в остальных — вниз). */
  hideOnScroll?: boolean
  /** Не показывать при отсутствии JavaScript (на SSR / до гидрации). */
  jsOnly?: boolean
  /** Дополнительные CSS-классы плашки. */
  class?: string
}

export interface PageSliceProps extends PageSliceOptions {
  /** Идентификатор пагинатора (необязателен внутри `PaginatorHost`). */
  name?: string
  /** Номер страницы при рендере внутри `PageDivider` (по умолчанию текущая страница пагинатора). */
  page?: number
  /** Рисовать тонкие боковые линии по краям текста (для встраивания в `PageDivider`). */
  dividerLines?: boolean
  /** Опорный момент времени (мс) для детерминированного расчёта `TimeAgo` в тестах/SSR. */
  now?: number
}

export interface PaginatorProps<T> {
  name: string
  ariaLabel: string
  snapshot?: PaginatorState<T> | null
  externalPage?: number | null
  externalRestorable?: { pageSize?: number; extra: Extra } | null
  currentSearch?: () => Record<string, unknown> | null
  layout?: 'list' | 'columns'
  mode?: 'accumulate' | 'single'
  columns?: number | 'auto'
  columnWidth?: number
  stretch?: Stretch
  minColumns?: number
  maxColumns?: number
  gap?: number
  topTrigger?: EdgeTrigger
  bottomTrigger?: EdgeTrigger
  topZone?: TriggerZone
  bottomZone?: TriggerZone
  prependBehavior?: PrependBehavior
  hashAnchor?: string | null
  /** `true` — индикатор с дефолтным текстом; строка — со своим. */
  showIndicator?: boolean | string
  sentinel?: boolean
  /** `false` — не рендерить строку замены вообще; `boolean` — передать во `when` у `ReplaceLoadingRow`. */
  replaceLoading?: boolean | 'off'
  bottomNav?: boolean
  /** Управление плашкой активного среза (`false` — отключить, объект — опции `PageSlice`). */
  slice?: boolean | PageSliceOptions
  eventLog?: boolean
  variant?: PaginatorHostVariants['variant']
  class?: string
  onError?: (err: LibError) => void
  onColumns?: (n: number) => void
  toolbar?: Snippet
  /**
   * Раскладка списка. Оболочка (`PaginatorHost`, статусы, пустое состояние,
   * подгрузка) — у компонента; потребитель добавляет СВОИ блоки там, где их
   * место по смыслу. Две пары мест, и разница между ними существенна:
   *   `header`/`footer` — внутри хоста, но ВНЕ контейнера строк (состояния
   *   опроса, счётчики, легенды);
   *   `beforeItems`/`afterItems` — внутри контейнера строк (шапка таблицы,
   *   оптимистичные строки, которых ещё нет в источнике).
   */
  header?: Snippet
  footer?: Snippet
  beforeItems?: Snippet
  afterItems?: Snippet
  /** Замена текста пустого состояния (рисуется на месте EmptyState). */
  empty?: Snippet
  /** Подпись ссылки «показать ещё»; по умолчанию — текст хоста. */
  loadMoreLabel?: Snippet<[LoadMoreSlotRender]>
  /** Нижняя навигация потребителя — вместо `PageNav` с кнопкой сброса. */
  nav?: Snippet
  /** Класс и атрибуты контейнера со строками (рамка, `data-testid` потребителя). */
  itemsClass?: string
  itemsAttrs?: Record<string, string | undefined>
  /** Класс каждой группы строк (обёртки одного прохода загрузки, как `class` у `Acl`). */
  itemClass?: string
  renderItem: Snippet<[T, { page: number; index: number }]>
  renderSkeleton?: Snippet<[{ page: number; index: number }]>
  renderPending?: Snippet<[{ page: number }]>
  renderDivider?: Snippet<[{ page: number; count: number | null }]> | null
}
