/**
 * Серверные типы модуля «Диска»: то, что получают маршрут и модалки.
 *
 * Доменные типы узла и среза — в `#core/lib/drive`; здесь только результат
 * сервиса (узел + права + срез) и проекции доступа, которых в чистом ядре нет.
 */
import type { AuthErrorCode } from '#modules/user/base/model/error.js'
import type {
  DriveBreadcrumb,
  DriveCapabilities,
  DriveEntry,
  DriveNodeView,
  DriveQuotaView,
  DriveShareRole,
  DriveSlice,
  DriveSort,
  DriveSortDirection,
} from '#core/lib/drive/index.js'
import type { DriveDavTokenView } from './service/tokens.js'

/** Аккаунт, от имени которого работает сервис. */
export interface DriveActor {
  readonly id: string
  readonly permissions: readonly string[]
}

/** Один выданный доступ в человеческом виде (без служебных полей строки). */
export interface DriveShareView {
  readonly id: string
  readonly nodeId: string
  readonly uid: string
  readonly role: DriveShareRole
  readonly createdAt: Date
}

/** Результат сервиса: данные или код доменного отказа. */
export type DriveResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string }

/** Узел и его эффективные права; `role` — роль из `drive_share`, если она есть. */
export interface DriveAccess {
  readonly node: DriveNodeView
  readonly caps: DriveCapabilities
  readonly role: DriveShareRole | null
}

/** Данные среза папки: всё, что нужно странице и модалке. */
/** Данные страницы и модалки: один срез плюс состояние гейта. */
export interface DrivePageData {
  readonly enabled: boolean
  readonly fact: AuthErrorCode | null
  readonly folder: DriveNodeView | null
  readonly caps: DriveCapabilities
  readonly items: readonly DriveEntry[]
  readonly breadcrumbs: readonly DriveBreadcrumb[]
  readonly quota: DriveQuotaView
  readonly trashed: boolean
  /** Узел для карточки `drive.node`; в листинге `null`. */
  readonly node: DriveNodeView | null
  /** Куда можно перенести/скопировать: корень, предки и папки текущего среза. */
  readonly folders: readonly { id: string | null; label: string }[]
  /** Выданные доступы — только тому, кто вправе делиться. */
  readonly shares: readonly DriveShareView[]
  /** Код прошлого действия из `?notice=`: показывается над списком. */
  readonly notice: string | null
  /** Выбор папки из пикера для строки `nodeId`. */
  readonly pick: DrivePick | null
  /** Активные фильтры и порция списка. */
  readonly sort: DriveSort
  readonly search: string | null
  readonly type: 'all' | 'file' | 'folder'
  readonly starred: boolean
  readonly pageSize: number
  /** Выбранные даты изменения, `YYYY-MM-DD`; пусто — без границы. */
  readonly from: string | null
  readonly to: string | null
  readonly nextCursor: string | null
  readonly total: number
  /** Список открыт не с первой порции (в адресе есть курсор). */
  readonly paged: boolean
}

/** Возврат из пикера: какую операцию и для какого узла заполнил выбор. */
export interface DrivePick {
  readonly nodeId: string
  readonly op: 'move' | 'copy'
  /** `null` — корень диска. */
  readonly targetId: string | null
}

/** Экран паролей WebDAV: список, флаг доступности и одноразовый секрет. */
export interface DriveDavTokensData {
  readonly enabled: boolean
  readonly tokens: readonly DriveDavTokenView[]
  /** Открытый пароль, показанный после выдачи ровно один раз. */
  readonly issued: string | null
  readonly fact: AuthErrorCode | null
  readonly notice: string | null
}

/** Данные пикера: срез папки плюс контракт адреса вызывающего экрана. */
export interface DrivePickerData {
  readonly browse: DrivePageData
  readonly from: string
  readonly param: string
  /** Что можно выбрать: любой узел или только папки (перенос/копия). */
  readonly kind: 'any' | 'folder'
  readonly folderId: string | null
}

export interface DriveRouteData {
  /** Текущая папка; `null` — корень диска. */
  readonly folder: DriveNodeView | null
  /** Права на саму папку (для корня — права владельца). */
  readonly caps: DriveCapabilities
  readonly slice: DriveSlice
  readonly sort: DriveSort
  readonly direction: DriveSortDirection
  readonly trashed: boolean
  readonly starred: boolean
  readonly search: string | null
}
