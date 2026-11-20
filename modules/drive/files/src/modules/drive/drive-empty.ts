/**
 * Таксономия пустых состояний «Диска» (§7a.10).
 *
 * Одна точка выбора: компоненты не пишут `{#if}` на каждый экран, а рисуют
 * готовый `DriveEmptySpec`. Причина пустоты важнее текста: загрузка, отказ,
 * пустой выбор, страница вне диапазона и обычная пустая папка — разные вещи.
 */
import type {
  DriveEmptyAction,
  DriveEmptyInput,
  DriveEmptyKind,
  DriveEmptySpec,
} from './empty-types.js'

export type {
  DriveEmptyAction,
  DriveEmptyInput,
  DriveEmptyKind,
  DriveEmptySpec,
} from './empty-types.js'

const known = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

const integer = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isInteger(value)

const EMPTY_TEXT: Record<
  DriveEmptyKind,
  { readonly title: string; readonly description: string; readonly variant: 'default' | 'picker' | 'chosen' }
> = {
  directory: {
    title: 'Папка пуста',
    description: 'Загрузите файл или создайте папку — они появятся здесь.',
    variant: 'default',
  },
  filtered: {
    title: 'Ничего не найдено',
    description: 'Под текущий поиск и фильтры не подходит ни один объект.',
    variant: 'default',
  },
  trash: {
    title: 'Корзина пуста',
    description: 'Удалённые файлы и папки будут появляться здесь.',
    variant: 'default',
  },
  starred: {
    title: 'Здесь пока пусто',
    description: 'Отметьте важное в списке — оно появится в этом разделе.',
    variant: 'default',
  },
  picker: {
    title: 'Нечего выбрать',
    description: 'В этой папке нет объектов, подходящих под ограничение выбора.',
    variant: 'picker',
  },
  'picker-filtered': {
    title: 'Ничего не найдено',
    description: 'Сбросьте поиск или фильтры, чтобы увидеть остальные объекты.',
    variant: 'picker',
  },
  chosen: {
    title: 'Ничего не выбрано',
    description: 'Отметьте файлы или папки на шаге выбора.',
    variant: 'chosen',
  },
  'chosen-hidden': {
    title: 'Выбранное не видно',
    description: 'Все выбранные объекты скрыты текущей папкой или фильтром.',
    variant: 'chosen',
  },
  page: {
    title: 'На этой странице пусто',
    description: 'Вернитесь к первой странице — там есть объекты.',
    variant: 'default',
  },
}

function emptyOf(
  kind: DriveEmptyKind,
  actions: readonly DriveEmptyAction[],
): DriveEmptySpec {
  const text = EMPTY_TEXT[kind]
  return { component: 'empty', kind, ...text, actions }
}

const alertOf = (reason: 'load' | 'storage' | 'unknown' | 'inconsistent'): DriveEmptySpec => ({
  component: 'alert',
  reason,
  retry: true,
})

export function driveEmptyOf(input: DriveEmptyInput): DriveEmptySpec {
  const { step, mode } = input
  const items = input.itemCount
  const total = input.totalItems

  if (input.status === 'init' || input.status === 'loading') return { component: 'skeleton' }
  if (input.fact || !input.canRead) return { component: 'acl' }

  if (step === 'chosen' && mode === 'multiple') {
    const picked = input.pickedCount
    const hidden = input.hiddenCount
    if (picked === 0) return emptyOf('chosen', ['to-pick'])
    if (!known(total) || hidden === null) return alertOf('unknown')
    if (!integer(hidden) || hidden < 0 || hidden > picked) return alertOf('inconsistent')
    if (total === 0 && hidden !== picked) return alertOf('inconsistent')
    if (total === 0 && items > 0) return alertOf('inconsistent')
    if (hidden > 0 && total === 0) {
      return items === 0
        ? emptyOf('chosen-hidden', input.hasFilters ? ['reset-filters'] : ['to-pick'])
        : alertOf('inconsistent')
    }
    if (hidden > 0 && total > 0) {
      if (items > 0) return { component: 'list', hidden }
      return input.page > 1 ? emptyOf('page', ['first-page']) : alertOf('inconsistent')
    }
    if (hidden === 0 && items > 0) {
      return total > 0 ? { component: 'list' } : alertOf('inconsistent')
    }
    if (hidden === 0 && items === 0 && total > 0) {
      return input.page > 1 ? emptyOf('page', ['first-page']) : alertOf('unknown')
    }
    return alertOf('inconsistent')
  }

  if (items > 0) return total === 0 ? alertOf('unknown') : { component: 'list' }
  if (!known(total)) return alertOf('unknown')
  if (input.page > 1 && total > 0) return emptyOf('page', ['first-page'])
  if (input.page <= 1 && total > 0) return alertOf('inconsistent')

  if (input.isPicker) {
    return input.hasFilters || input.hasSearch
      ? emptyOf('picker-filtered', ['reset-filters'])
      : emptyOf('picker', ['to-drive'])
  }
  if (input.hasFilters || input.hasSearch) return emptyOf('filtered', ['reset-filters'])
  if (input.identity === 'trash') return emptyOf('trash', ['to-drive'])
  if (input.identity === 'starred') return emptyOf('starred', ['to-drive'])
  if (total === 0) {
    return emptyOf('directory', input.canWrite ? ['upload', 'create-folder'] : ['to-drive'])
  }
  return alertOf('unknown')
}
