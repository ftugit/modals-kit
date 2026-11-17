import type { AuthErrorCode } from '#core/auth/errors.js'
import type { StorageServersSlice } from '#core/lib/storage/pool-types.js'

// Типы пула принадлежат ядру (`app-storage` их читает), модуль только
// реэкспортирует их для своей админки — направление `modules → core`.
export type {
  StorageServerMeta,
  StorageServerView,
  StorageServersSlice,
} from '#core/lib/storage/pool-types.js'

/** Данные носителей `/storage-servers` и модалки `storage.servers`. */
export interface StorageServersRouteData {
  readonly enabled: boolean
  readonly slice: StorageServersSlice | null
  readonly fact: AuthErrorCode | null
  /** Идентификатор сервера, открытого на редактирование по `?edit=<id>` (SSR / no-JS). */
  readonly editId?: string | null
}
