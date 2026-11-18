import { localPath } from '#core/lib/address/index.js'
import { kitRoute, querySchema } from '#core/lib/address/sveltekit.js'

/** Корень диска (`/drive`). */
export const driveRootRoute = kitRoute('/drive')

/** Папка — отдельный сегмент адреса, чтобы ссылка на глубокую папку жила без JS. */
export const driveFolderRoute = kitRoute('/(site)/(app)/drive/[folderId=uuid]', {
  dynamic: true,
  id: '/drive/[folderId]',
})

/** Карточка узла — страница-fallback модалки `drive.node`. */
export const driveNodeRoute = kitRoute('/(site)/(app)/drive/node/[id=uuid]', {
  dynamic: true,
  id: '/drive/node/[id]',
})

/** Доступы узла: список shares и ссылки share/unshare. */
export const driveAccessRoute = kitRoute('/(site)/(app)/drive/access', {
  owner: 'drive.access',
  keys: ['node_id'],
  search: querySchema<{ node_id: string | null }, { node_id: string | null }>((raw) => ({
    node_id: typeof raw.node_id === 'string' ? raw.node_id : null,
  })),
})

/** Корзина. */
export const driveTrashRoute = kitRoute('/drive/trash')
export const drivePickerRoute = kitRoute('/drive/pick')

/**
 * Фильтры списка: страница-fallback модалки `drive.filters` для no-JS.
 * `from` — адрес носителя (списка), его проверяет `localPath`.
 */
export const driveFiltersRoute = kitRoute('/drive/filters', {
  // `from` — общий ключ обеих страниц фильтров (`/drive/filters` и
  // `/users/filters`), поэтому владелец один: иначе вторая бронь падает, а
  // `href({ from })` не имеет прав на запись.
  owner: 'user.filters',
  keys: ['from'],
  search: querySchema<{ from: string | null }, { from: string | null }>((raw) => ({
    from: localPath(typeof raw.from === 'string' ? raw.from : null),
  })),
})
