/**
 * Прикладной реактивный хук проверки прав `useGrants` модуля пользователя.
 *
 * По умолчанию берёт текущего субъекта из `vault` (`vault.principal` + `vault.permissions`,
 * прозрачно работая и на SSR из `page.data.user`, и после гидратации в памяти вкладки).
 * Позволяет передать `ownerId` для проверки владения строкой и `actor` для расчёта
 * возможностей любого другого пользователя.
 */
import { createUseGrants, type ReactiveGrantFlag, type UseGrantsFn, type UseGrantsOptions } from '#hooks/db-grants.svelte.js'
import { vault } from './vault.svelte.js'

export type { ReactiveGrantFlag, UseGrantsFn, UseGrantsOptions }

export const useGrants: UseGrantsFn = createUseGrants(() =>
  vault.authorized
    ? { id: vault.principal, permissions: vault.permissions }
    : null,
)
