/**
 * Доменные типы «Диска» (`plan-drive.md` §4.3).
 *
 * Пакет чистый: без `#core/lib/db`, без Svelte, без `node:*`. Типы описывают
 * только то, что уже решено моделью, и не знают ни о БД, ни о разметке.
 */

/** Вид узла: папка существует только в БД, у байтового хранилища пустых директорий нет. */
export type DriveNodeKind = 'file' | 'folder'

/** Роль в `drive_share`. Наследуется вниз по дереву, паролей на узлы нет. */
export type DriveShareRole = 'viewer' | 'editor'

/** Ключ сортировки среза. Совпадает с адресным `drive.ord`. */
export type DriveSort = 'name' | 'updated' | 'size'

/** Направление сортировки. По умолчанию — `asc` для имени и `desc` для времени. */
export type DriveSortDirection = 'asc' | 'desc'

/** Минимум узла, нужный дереву и инвариантам перемещения/восстановления. */
export interface DriveTreeNode {
  readonly id: string
  readonly ownerId: string
  readonly parentId: string | null
  readonly kind: DriveNodeKind
  readonly trashedAt: Date | null
  readonly trashedFrom: string | null
}

/**
 * Узел в том виде, в каком его отдаёт срез папки.
 *
 * `size` — логический размер файла: квота считается по нему, даже если
 * физические байты общие с другим узлом (дедупликация по `hash`).
 */
export interface DriveNodeView extends DriveTreeNode {
  readonly name: string
  /** Логический путь байтов в `#core/lib/storage`; у папки всегда `null`. */
  readonly fileId: string | null
  readonly size: number
  readonly contentType: string | null
  readonly hash: string | null
  readonly starred: boolean
  readonly createdAt: Date
  readonly updatedAt: Date
}

/**
 * Проекция прав на узел. Считает сервер (`service/access.ts`), UI только
 * рисует: прятать данные в разметке — не проверка доступа.
 */
export interface DriveCapabilities {
  readonly canRead: boolean
  readonly canWrite: boolean
  readonly canShare: boolean
}

/** Строка среза: узел + права актора. */
export interface DriveEntry {
  readonly node: DriveNodeView
  readonly caps: DriveCapabilities
}

/** Крошка пути: от корня к текущей папке. */
export interface DriveBreadcrumb {
  readonly id: string
  readonly name: string
}

/** Квота пользователя в байтах; `remaining` не бывает отрицательным. */
export interface DriveQuotaView {
  readonly used: number
  readonly limit: number
  readonly remaining: number
}

/**
 * Одна порция папки. `cursor` — ключ следующей порции (`listing.ts`),
 * `null` — порция последняя.
 */
export interface DriveSlice {
  readonly items: readonly DriveEntry[]
  readonly total: number
  readonly cursor: string | null
  readonly breadcrumbs: readonly DriveBreadcrumb[]
  readonly quota: DriveQuotaView
}
