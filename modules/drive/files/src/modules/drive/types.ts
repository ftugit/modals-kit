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
import type { PaginatorState } from '#core/lib/paginate/index.js'
import type { DriveDavTokenView } from './service/tokens.js'
import type { DriveFilterValues } from './filters-form.js'

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
  /** Имя получателя; при отсутствии права/строки совпадает с `uid`. */
  readonly label: string
  readonly role: DriveShareRole
  readonly createdAt: Date
}

/** Результат сервиса: данные или код доменного отказа. */
export type DriveResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string; readonly params?: Record<string, unknown> }

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
  /** Выданные доступы — только тому, кто вправе делиться. */
  readonly shares: readonly DriveShareView[]
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
}

/** Данные страницы узла (`/drive/node/[id]`) и модалки `drive.node`. */
export interface DriveNodePageData {
  readonly enabled: boolean
  readonly fact: AuthErrorCode | null
  readonly node: DriveNodeView | null
  readonly caps: DriveCapabilities
  readonly shares: readonly DriveShareView[]
  readonly quota: DriveQuotaView
  /** Ссылка на GET-раздачу байтов; `null` — у узла нет байтов. */
  readonly downloadHref: string | null
}

/** Данные пикера: срез папки плюс контракт адреса вызывающего экрана. */
export interface DrivePickerData {
  readonly list: DriveListRouteData
  readonly from: string
  readonly param: string
  /** Что можно выбрать: любой узел или только папки (перенос/копия). */
  readonly kind: 'any' | 'folder'
  readonly folderId: string | null
}

/**
 * Строка нативного `Listing`: `Listing` требует верхнеуровневый `id`, а чистый
 * доменный `DriveEntry` его не имеет. Копия полей не заводится — расширение.
 */
export interface DriveListItem extends DriveEntry {
  readonly id: string
}

/** Данные страницы-фильтров `/drive/filters` (fallback модалки `drive.filters`). */
export interface DriveFiltersPageData {
  readonly enabled: boolean
  readonly fact: AuthErrorCode | null
  /** Значения формы из адреса списка (`from`) и query страницы. */
  readonly values: DriveFilterValues
  /** Адрес списка как был — «К списку» и скрытое `from` формы. */
  readonly backHref: string
  /** Адрес списка без фильтров — «Сбросить» без JS. */
  readonly resetHref: string
  /** В корзине глобальная область недоступна. */
  readonly scopeLocked: boolean
}

/**
 * Данные списка (`/drive`, `/drive/<папка>`, `/drive/trash`) — единственный
 * источник показа: страница отдаёт снапшот, модалка и догрузка зовут тот же
 * `load` через `preloadData`.
 */
export interface DriveListRouteData {
  readonly snapshot: PaginatorState<DriveListItem> | null
  readonly fact: AuthErrorCode | null
  readonly enabled: boolean
  /** Внутренняя личность списка: `root`, `folder:<uuid>`, `trash`. */
  readonly identity: string
  readonly pathname: string
  readonly folder: DriveNodeView | null
  readonly caps: DriveCapabilities
  readonly quota: DriveQuotaView
  readonly breadcrumbs: readonly DriveBreadcrumb[]
  readonly trashed: boolean
  readonly pick: DrivePick | null
}

/** Операция «Диска»: одна единица — форма, маршрут и модалка. */
export interface DriveOperationData {
  readonly enabled: boolean
  readonly fact: AuthErrorCode | null
  readonly returnTo: string
  /** Явный адрес POST формы — выделенный route операции. */
  readonly action: string
  readonly parentId: string | null
  readonly parent: DriveNodeView | null
  readonly node: DriveNodeView | null
  readonly caps: DriveCapabilities
  readonly shares: readonly DriveShareView[]
  /** Варианты получателей для `subjects`; пусто без права чтения аккаунтов. */
  readonly subjectOptions: readonly { readonly value: string; readonly label: string }[]
  readonly tokens: readonly DriveDavTokenView[]
  /** upload: почему хранилище не готово; `null` — писать можно. */
  readonly storageError: 'drive.storage-unavailable' | 'drive.storage-readonly' | null
  /** WebDAV включён серверным ключом подписи. */
  readonly davEnabled: boolean
  readonly values: {
    readonly name: string
    readonly targetId: string | null
    readonly targetLabel: string
    readonly starred: boolean
    readonly subjects: readonly string[]
    readonly uid: string
    readonly role: string
    readonly tokenId: string
    readonly label: string
  }
  readonly quota: DriveQuotaView
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
