import type { AuthErrorCode } from '#content/user/error.js'

/** Публичные замаскированные метаданные одного сервера в `storage_server.meta`. */
export interface StorageServerMeta {
  readonly summary: string
  readonly protocol: 's3' | 'webdav'
  readonly storageMb: number
  readonly fileMb: number
  readonly readOnly: boolean
  readonly allowSplit: boolean
  readonly encrypted: boolean
}

/** Видимая строка сервера боевого хранилища для экрана администрирования. */
export interface StorageServerView {
  readonly id: string
  readonly slot: string
  readonly priority: number
  readonly meta: StorageServerMeta
  readonly createdAt: number
  readonly updatedAt: number
}

/** Срез серверов боевого хранилища приложения (`STORAGE_ACL`). */
export interface StorageServersSlice {
  readonly items: readonly StorageServerView[]
  readonly activeMode: 'pool' | 'dev_local' | 'empty'
  readonly hasDevFallback: boolean
  readonly canEdit: boolean
}

/** Данные носителей `/storage-servers` и модалки `storage.servers`. */
export interface StorageServersRouteData {
  readonly enabled: boolean
  readonly slice: StorageServersSlice | null
  readonly fact: AuthErrorCode | null
}
