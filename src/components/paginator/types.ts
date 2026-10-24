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
  renderItem: Snippet<[T, { page: number; index: number }]>
  renderSkeleton?: Snippet<[{ page: number; index: number }]>
  renderPending?: Snippet<[{ page: number }]>
  renderDivider?: Snippet<[{ page: number; count: number | null }]> | null
}
