// Регистрация модалок профиля. Подхватывается glob'ом `modules/**/modals.ts`.
import { registerModal } from '#core/lib/modals/index.js'
import { lazy } from '#core/lib/modals/svelte/index.js'
import {
  profilesListRoute,
  userProfileDeleteRoute,
  userProfileEditRoute,
  userProfileRoute,
} from '#modules/user/base/routes.js'

registerModal({
  name: 'user.profile',
  component: lazy(() => import('#modules/user/profile/svelte/ProfileModal.svelte')),
  route: userProfileRoute.href,
  size: { width: 480, height: 560 },
})
registerModal({
  name: 'user.profile.edit',
  component: lazy(() => import('#modules/user/profile/svelte/ProfileEditModal.svelte')),
  route: userProfileEditRoute.href,
  size: { width: 480, height: 560 },
})
registerModal({
  name: 'user.profile.delete',
  component: lazy(() => import('#modules/user/profile/svelte/ProfileDeleteModal.svelte')),
  route: userProfileDeleteRoute.href,
  size: { width: 480, height: 480 },
})
registerModal({
  name: 'user.profiles',
  component: lazy(() => import('#modules/user/profile/svelte/ProfilesModal.svelte')),
  route: profilesListRoute.href,
  size: { width: 640, height: 560 },
})
