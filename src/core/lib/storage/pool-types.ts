/**
 * Типы пула серверов боевого хранилища.
 *
 * Нужны ядру (`#core/server/app-storage.server.ts` читает и пишет
 * `storage_server.meta`) и админке пула (`modules/storage-servers`), поэтому
 * живут в `core/lib/storage`, а не в модуле: иначе `core → modules`.
 */

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
