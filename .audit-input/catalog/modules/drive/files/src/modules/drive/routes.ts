import { kitRoute } from '#core/lib/address/sveltekit.js'

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

/** Корзина. */
export const driveTrashRoute = kitRoute('/drive/trash')
export const drivePickerRoute = kitRoute('/drive/pick')
