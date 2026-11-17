// Регистрация модалок аккаунтов. Подхватывается glob'ом `modules/**/modals.ts`.
import { registerModal } from '#core/lib/modals/index.js'
import { lazy } from '#core/lib/modals/svelte/index.js'
import {
  userListFiltersRoute,
  userListRoute,
  userPickerRoute,
  usersDeleteRoute,
} from '#modules/user/base/routes.js'

registerModal({
  name: 'user.list',
  component: lazy(() => import('#modules/user/accounts/svelte/SeedUsersModal.svelte')),
  route: userListRoute.href,
  size: { width: 640, height: 560 },
})
registerModal({
  name: 'user.list.filters',
  component: lazy(() => import('#modules/user/accounts/svelte/SeedUsersFiltersModal.svelte')),
  route: () => userListFiltersRoute.href(),
  size: { width: 420, height: 560 },
})
registerModal({
  name: 'user.accounts.delete',
  component: lazy(() => import('#modules/user/accounts/svelte/UsersDeleteModal.svelte')),
  defaultParams: { ids: '', list: '' },
  route: (p: { ids?: string; list?: string }) =>
    usersDeleteRoute.href({
      'del.ids': p?.ids ? String(p.ids) : null,
      'del.list': p?.list ? String(p.list) : null,
    }),
  size: { width: 480, height: 480 },
})
registerModal({
  name: 'user.picker',
  component: lazy(() => import('#modules/user/accounts/svelte/UserPickerModal.svelte')),
  source: 'memory',
  defaultParams: { mode: 'multi', picked: '' },
  route: (p: { mode?: string; channel?: string; picked?: string }) => {
    const q = new URLSearchParams()
    if (p?.mode) q.set('mode', String(p.mode))
    if (p?.channel) q.set('channel', String(p.channel))
    if (p?.picked) q.set('picked', String(p.picked))
    const qs = q.toString()
    return qs ? `${userPickerRoute.href()}?${qs}` : userPickerRoute.href()
  },
  size: { width: 640, height: 580 },
})
