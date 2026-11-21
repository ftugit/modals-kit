/**
 * Действия узла «Диска» — один доменный дескриптор для всех носителей.
 *
 * Компонент строит из него ссылки и пункты `OverflowMenu`, но сам набор,
 * порядок и признаки (`primary`, `destructive`) решает эта функция: второго
 * списка действий в разметке быть не должно.
 */
import type { DriveCapabilities, DriveNodeView } from '#core/lib/drive/index.js'
import type { DriveOperationName } from './operations.js'

export type DriveNodeActionId = DriveOperationName | 'download' | 'access'

export interface DriveNodeAction {
  readonly id: DriveNodeActionId
  readonly label: string
  /** Первые действия остаются кнопками и не уходят в «Ещё». */
  readonly primary: boolean
  readonly destructive: boolean
  /** Меняется от состояния узла («Важное»/«Снять важное»). */
  readonly toggle: boolean
}

export interface DriveNodeActionOptions {
  readonly trashed?: boolean
  readonly canDownload?: boolean
}

/**
 * Порядок: скачивание → важное → переименование → перенос → копия → удаление
 * → доступы. В корзине набор другой: восстановление и окончательное удаление.
 */
export function driveNodeActions(
  node: Pick<DriveNodeView, 'starred'>,
  caps: Pick<DriveCapabilities, 'canWrite' | 'canShare'>,
  options: DriveNodeActionOptions = {},
): readonly DriveNodeAction[] {
  if (options.trashed) {
    return [
      { id: 'restore', label: 'Восстановить', primary: true, destructive: false, toggle: false },
      { id: 'purge', label: 'Удалить навсегда', primary: false, destructive: true, toggle: false },
    ]
  }

  const actions: DriveNodeAction[] = []
  if (options.canDownload) {
    actions.push({ id: 'download', label: 'Скачать', primary: true, destructive: false, toggle: false })
  }
  if (caps.canWrite) {
    actions.push(
      {
        id: 'star',
        label: node.starred ? 'Снять важное' : 'Важное',
        primary: true,
        destructive: false,
        toggle: true,
      },
      { id: 'rename', label: 'Переименовать', primary: false, destructive: false, toggle: false },
      { id: 'move', label: 'Перенести', primary: false, destructive: false, toggle: false },
      { id: 'copy', label: 'Копия', primary: false, destructive: false, toggle: false },
      { id: 'trash-action', label: 'В корзину', primary: false, destructive: true, toggle: false },
    )
  }
  if (caps.canShare) {
    actions.push({ id: 'access', label: 'Доступы', primary: false, destructive: false, toggle: false })
  }
  return actions
}

/** Видимое число действий: 2 на мобильном, 5 на широком экране. */
export function driveNodeActionsVisible(width: number): number {
  return width > 0 && width < 640 ? 2 : 5
}
