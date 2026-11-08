import type { Snippet } from 'svelte'
import type { SidebarPlace } from '#components/shell/index.js'
import type { SurfaceVariant } from '#components/ui/index.js'
import type { LinkAttrs } from '#hooks/links/index.js'
import type { PaginatorState } from '#lib/paginate/index.js'

/** Первая порция `load`. Домен может нести рядом свои флаги (`canCreate`). */
export interface ListingInitial<Item extends { id: string }> {
  snapshot: PaginatorState<Item> | null
  fact: string | null
}

export interface ListingFilters {
  /** Имя модалки фильтров. */
  modal: string
  /** Параметры модалки. Функция видит живой `extra` пагинатора. */
  params?: Record<string, unknown> | ((extra: Record<string, unknown>) => Record<string, unknown>)
  /** Страница фильтров без query: `/users/filters`. */
  path: string
  /** Чужие query страницы фильтров (`uid`). Пустые значения не пишутся. */
  query?: Record<string, string>
  /** Ключи extra, которые входят в счётчик кнопки. Поиск и срез id сюда не кладут. */
  keys: readonly string[]
  defaults: Readonly<Record<string, string>>
  /** Размер порции по умолчанию. Отличие тоже считается. */
  pageSize: number
  /** Ключи, которые в этом срезе счётчик пропускает. */
  ignore?: readonly string[]
  testId?: string
}

export interface ListingFrame<Item extends { id: string }> {
  extra: Record<string, unknown>
  payload: ListingInitial<Item>
}

export interface ListingProps<Item extends { id: string }> {
  /** Имя зарегистрированного пагинатора. Регистрацию делает доменный список до монтирования. */
  name: string
  /** Адресный ключ порции (`users`, `blocks`). */
  pageParam: string
  /** Путь `load` без query. */
  route: string
  /**
   * Когда переспрашивать первую порцию, если `initial` нет.
   * `href` — при смене собранного адреса. Иначе имя ключа extra (`ids`):
   * переспрос только при его смене, а в запрос уходят все ключи адреса.
   */
  watch?: 'href' | string
  /** Ключи адреса, которые self-fetch не копирует. */
  omitKeys?: readonly string[]
  /** Код отказа, если `preloadData` не вернул `loaded`. */
  loadError?: string
  ariaLabel: string
  title: string
  variant?: SurfaceVariant
  class?: string
  scope?: string | null
  url?: boolean
  initial?: ListingInitial<Item> | null
  onAcl?: (fact: string) => void
  rowAttrs: (item: Item) => LinkAttrs
  isSelected?: (id: string) => boolean
  rowTestId?: string
  listTestId?: string
  pendingTestId?: string
  filters?: ListingFilters
  /**
   * Зона sidebar для формы фильтров. Страница передаёт, модалка — нет.
   * `Listing` не угадывает носитель: нет зоны — всегда кнопка.
   */
  sidebar?: SidebarPlace
  /** Форма фильтров этой схемы. Оболочка поля не знает, только регистрирует сниппет. */
  filtersForm?: Snippet
  search?: {
    label: (extra: Record<string, unknown>) => string
    placeholder: (extra: Record<string, unknown>) => string
  }
  /** Смена этого ключа в `extra` снапшота заменяет окно целиком. */
  identityKey?: string
  /** Смена актора сбрасывает ленту. Домен передаёт id, оболочка хранилище не знает. */
  actor?: string | null
  item: Snippet<[Item, boolean]>
  skeleton?: Snippet<[Record<string, unknown>]>
  controls?: Snippet<[ListingFrame<Item>]>
}
