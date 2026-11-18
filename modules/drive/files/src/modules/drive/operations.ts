/**
 * Матрица операций «Диска» (`plan-drive-repair.md` §1.2) — одна точка правды.
 *
 * Каждая строка описывает одну единицу работы: form ID, fallback route, modal
 * name, подпись и поля формы. Компонент, маршрут и регистрация не перечисляют
 * это заново, поэтому расхождение имён ловится одним взглядом (и guard-тестом).
 */
import { localPath } from '#core/lib/address/index.js'
import { driveRootRoute } from './routes.js'

export interface DriveOperationField {
  /** Имя поля в описании формы (`defineForm`). */
  readonly name: string
  /** Видимое поле рисуется открыто, скрытое — в закрытом блоке. */
  readonly visible: boolean
}

export type DriveOperationName =
  | 'mkdir'
  | 'upload'
  | 'rename'
  | 'move'
  | 'copy'
  | 'star'
  | 'trash-action'
  | 'restore'
  | 'purge'
  | 'share'
  | 'unshare'
  | 'filters'
  | 'dav-issue'
  | 'dav-revoke'

export interface DriveOperationSpec {
  readonly id: DriveOperationName
  readonly formId: string
  /** Адрес fallback-страницы и явный `action` формы. */
  readonly path: string
  readonly modal: string
  readonly title: string
  readonly description: string
  readonly submit: string
  readonly destructive?: boolean
  readonly fields: readonly DriveOperationField[]
}

const DRIVE_ROOT = driveRootRoute.href()

const hidden = (name: string): DriveOperationField => ({ name, visible: false })
const shown = (name: string): DriveOperationField => ({ name, visible: true })

const RETURN_TO = hidden('return_to')
const NODE_ID = hidden('node_id')

export const DRIVE_OPERATIONS: Record<DriveOperationName, DriveOperationSpec> = {
  mkdir: {
    id: 'mkdir',
    formId: 'drive-mkdir',
    path: `${DRIVE_ROOT}/mkdir`,
    modal: 'drive.mkdir',
    title: 'Новая папка',
    description: 'Папка создаётся в текущей папке списка.',
    submit: 'Создать папку',
    fields: [hidden('parent_id'), RETURN_TO, shown('name')],
  },
  upload: {
    id: 'upload',
    formId: 'drive-upload',
    path: `${DRIVE_ROOT}/upload`,
    modal: 'drive.upload',
    title: 'Загрузить файл',
    description: 'Файл загружается в текущую папку списка.',
    submit: 'Загрузить',
    fields: [hidden('parent_id'), RETURN_TO, shown('file')],
  },
  rename: {
    id: 'rename',
    formId: 'drive-rename',
    path: `${DRIVE_ROOT}/rename`,
    modal: 'drive.rename',
    title: 'Переименовать',
    description: 'Новое имя должно быть свободно в этой папке.',
    submit: 'Переименовать',
    fields: [NODE_ID, RETURN_TO, shown('name')],
  },
  move: {
    id: 'move',
    formId: 'drive-move',
    path: `${DRIVE_ROOT}/move`,
    modal: 'drive.move',
    title: 'Перенести',
    description: 'Перенос доступен только в живую папку своего диска.',
    submit: 'Перенести',
    fields: [NODE_ID, RETURN_TO, shown('target_id')],
  },
  copy: {
    id: 'copy',
    formId: 'drive-copy',
    path: `${DRIVE_ROOT}/copy`,
    modal: 'drive.copy',
    title: 'Скопировать',
    description: 'Копия занимает место в квоте, даже если байты общие.',
    submit: 'Скопировать',
    fields: [NODE_ID, RETURN_TO, shown('target_id'), shown('name')],
  },
  star: {
    id: 'star',
    formId: 'drive-star',
    path: `${DRIVE_ROOT}/star`,
    modal: 'drive.star',
    title: 'Важное',
    description: 'Звёздочка меняет только отметку, файл остаётся на месте.',
    submit: 'Сохранить',
    fields: [NODE_ID, RETURN_TO, hidden('starred')],
  },
  'trash-action': {
    id: 'trash-action',
    formId: 'drive-trash',
    path: `${DRIVE_ROOT}/trash-action`,
    modal: 'drive.trash-action',
    title: 'В корзину',
    description: 'Узел и его поддерево можно вернуть из корзины.',
    submit: 'В корзину',
    destructive: true,
    fields: [NODE_ID, RETURN_TO],
  },
  restore: {
    id: 'restore',
    formId: 'drive-restore',
    path: `${DRIVE_ROOT}/restore`,
    modal: 'drive.restore',
    title: 'Восстановить',
    description: 'Узел вернётся в прежнюю папку, если она жива.',
    submit: 'Восстановить',
    fields: [NODE_ID, RETURN_TO],
  },
  purge: {
    id: 'purge',
    formId: 'drive-purge',
    path: `${DRIVE_ROOT}/purge`,
    modal: 'drive.purge',
    title: 'Удалить навсегда',
    description: 'Байты удаляются, когда на них больше не ссылается ни один узел.',
    submit: 'Удалить навсегда',
    destructive: true,
    fields: [NODE_ID, RETURN_TO],
  },
  share: {
    id: 'share',
    formId: 'drive-share',
    path: `${DRIVE_ROOT}/share`,
    modal: 'drive.share',
    title: 'Выдать доступ',
    description: 'Доступ наследуется всем поддеревом узла.',
    submit: 'Выдать доступ',
    fields: [NODE_ID, RETURN_TO, shown('uid'), shown('role')],
  },
  unshare: {
    id: 'unshare',
    formId: 'drive-unshare',
    path: `${DRIVE_ROOT}/unshare`,
    modal: 'drive.unshare',
    title: 'Отозвать доступ',
    description: 'Строка доступа удаляется; наследование с папки выше остаётся.',
    submit: 'Отозвать',
    destructive: true,
    fields: [NODE_ID, hidden('uid'), RETURN_TO],
  },
  filters: {
    id: 'filters',
    formId: 'drive-filters',
    path: `${DRIVE_ROOT}/filters`,
    modal: 'drive.filters',
    title: 'Фильтры списка',
    description: 'Срез применяется к списку «Диска» целиком.',
    submit: 'Применить',
    fields: [
      hidden('from'),
      hidden('paginator'),
      hidden('page_param'),
      shown('ord'),
      shown('type'),
      shown('size'),
      shown('from_date'),
      shown('to_date'),
      shown('starred'),
    ],
  },
  'dav-issue': {
    id: 'dav-issue',
    formId: 'drive-dav-issue',
    path: '/user/config/dav/issue',
    modal: 'drive.dav-issue',
    title: 'Новый пароль WebDAV',
    description: 'Пароль показывается один раз сразу после создания.',
    submit: 'Создать пароль',
    fields: [RETURN_TO, shown('label')],
  },
  'dav-revoke': {
    id: 'dav-revoke',
    formId: 'drive-dav-revoke',
    path: '/user/config/dav/revoke',
    modal: 'drive.dav-revoke',
    title: 'Отозвать пароль',
    description: 'Вход по этому паролю перестанет работать сразу.',
    submit: 'Отозвать пароль',
    destructive: true,
    fields: [RETURN_TO, hidden('token_id')],
  },
}

/** Список операций в порядке матрицы. */
export const DRIVE_OPERATION_NAMES = Object.keys(DRIVE_OPERATIONS) as DriveOperationName[]

/** Описание строки матрицы. */
export function driveOperation(op: DriveOperationName): DriveOperationSpec {
  return DRIVE_OPERATIONS[op]
}

export interface DriveOperationParams {
  readonly nodeId?: string | null
  readonly parentId?: string | null
  readonly uid?: string | null
  readonly tokenId?: string | null
  readonly returnTo?: string | null
}

/**
 * Адрес операции: fallback-страница (она же `action` формы и `route` модалки).
 * `return_to` всегда проверяется `localPath` — внешний адрес не проходит.
 */
export function driveOperationHref(
  op: DriveOperationName,
  params: DriveOperationParams = {},
): string {
  const spec = driveOperation(op)
  const query = new URLSearchParams()
  if (params.nodeId) query.set('node_id', params.nodeId)
  if (params.parentId) query.set('parent_id', params.parentId)
  if (params.uid) query.set('uid', params.uid)
  if (params.tokenId) query.set('token_id', params.tokenId)
  const back = localPath(params.returnTo ?? null)
  if (back) query.set('return_to', back)
  const text = query.toString()
  return text ? `${spec.path}?${text}` : spec.path
}

/** `action` формы — адрес операции без `return_to` (он едет полем формы). */
export function driveOperationAction(op: DriveOperationName): string {
  return driveOperation(op).path
}
