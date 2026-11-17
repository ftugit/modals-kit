// Регистрация базовых модалок пользователя. Доменные модалки живут в своих
// субмодулях (`user/{profile,sessions,blocks,accounts}/modals.ts`) и
// подхватываются тем же glob'ом: нет субмодуля — нет и записи в реестре.
//
// Импорт модуля — сайд-эффект: ES-модуль исполняется один раз на среду (SSR
// отдельно, браузер отдельно), поэтому повторного объявления реестр не увидит.
// Компоненты — ленивые (`lazy(() => import(...))`): deep-link `?modal=user.auth`
// разрешается сразу (определение статическое), а тяжёлое содержимое приезжает
// отдельным чанком — раскладка ветки за него не платит.
import { registerModal } from '#core/lib/modals/index.js'
import { lazy } from '#core/lib/modals/svelte/index.js'
import { userAccountConfigRoute, userAuthRoute, userConfigRoute, userLogoutRoute, userMenuRoute } from './routes.js'

registerModal({
  name: 'user.auth',
  component: lazy(() => import('./svelte/AuthModal.svelte')),
  route: userAuthRoute.href,
  size: { width: 420, height: 480 },
})
registerModal({
  name: 'user.menu',
  component: lazy(() => import('./svelte/MenuModal.svelte')),
  route: userMenuRoute.href,
  size: { width: 320, height: 360 },
})
// Выход: пара «модалка + страница», данные приносит загрузчик записи.
registerModal({
  name: 'user.logout',
  component: lazy(() => import('./svelte/LogoutModal.svelte')),
  route: userLogoutRoute.href,
  size: { width: 440, height: 480 },
})
// Настройки пользователя (`{ id? }`): без `id` — свои, с `id` — целевого аккаунта.
registerModal({
  name: 'user.config.edit',
  component: lazy(() => import('./svelte/UserConfigModal.svelte')),
  route: (p: { id?: string }) =>
    p?.id ? userAccountConfigRoute.href({ id: String(p.id) }) : userConfigRoute.href(),
  size: { width: 520, height: 560 },
})
