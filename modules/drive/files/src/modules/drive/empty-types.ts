/**
 * Контракт пустых состояний «Диска» (§7a.10).
 *
 * `DriveEmptySpec` — дискриминированный результат `driveEmptyOf`, а не набор
 * экранных `{#if}`. Новый `kind` нельзя добавить без расширения union и ветки
 * функции; при расхождении выигрывает `driveEmptyOf`.
 */
export type DriveEmptyKind =
  | 'directory'
  | 'filtered'
  | 'trash'
  | 'starred'
  | 'picker'
  | 'picker-filtered'
  | 'chosen'
  | 'chosen-hidden'
  | 'page'

export type DriveEmptyAction =
  | 'upload'
  | 'create-folder'
  | 'reset-filters'
  | 'clear-search'
  | 'to-pick'
  | 'clear-picked'
  | 'previous-level'
  | 'first-page'
  | 'to-drive'
  | 'retry'

export type DriveEmptySpec =
  | { readonly component: 'skeleton' }
  | { readonly component: 'acl' }
  | {
      readonly component: 'alert'
      readonly reason: 'load' | 'storage' | 'unknown' | 'inconsistent'
      readonly retry: boolean
    }
  | { readonly component: 'list'; readonly hidden?: number }
  | {
      readonly component: 'empty'
      readonly kind: DriveEmptyKind
      readonly title: string
      readonly description: string
      readonly variant: 'default' | 'picker' | 'chosen'
      readonly actions: readonly DriveEmptyAction[]
    }

export interface DriveEmptyInput {
  /** Шаг пикера; у обычного списка — `list`. */
  readonly step: 'list' | 'pick' | 'chosen'
  readonly mode: 'single' | 'multiple'
  readonly status: 'init' | 'loading' | 'idle' | 'error'
  readonly fact: string | null
  readonly canRead: boolean
  readonly canWrite: boolean
  readonly identity: 'root' | 'folder' | 'trash' | 'starred'
  readonly page: number
  /** Сколько строк реально загружено на текущей странице. */
  readonly itemCount: number
  /** `totalItems` среза: для `chosen` — visiblePicked, иначе общий total. */
  readonly totalItems: number | null
  readonly hasFilters: boolean
  readonly hasSearch: boolean
  readonly pickedCount: number
  readonly hiddenCount: number | null
  readonly isPicker: boolean
}
