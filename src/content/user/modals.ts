// Регистрация модалок пользователя в глобальной области. Импорт модуля —
// сайд-эффект: ES-модуль исполняется один раз на среду (SSR отдельно, браузер
// отдельно), поэтому повторного объявления реестр не увидит. Компоненты —
// ленивые (`lazy(() => import(...))`): deep-link `?modal=user.auth` разрешается
// сразу (определение статическое), а тяжёлое содержимое (виджет, bind+Form,
// конвейер аватара) приезжает отдельным чанком — раскладка ветки за него
// не платит. Готовность модалки ждёт и данные, и чанк (кит: ensureView),
// поэтому между скелетоном и содержимым пустого кадра нет. Связка с маршрутами идёт через штатный `route: *.href` без
// перекрёстных импортов между ядрами `#lib/modals` и `#lib/address`.
import { registerModal } from '#lib/modals/index.js'
import { lazy } from '#lib/modals/svelte/index.js'
import { userAuthRoute, userListFiltersRoute, userMenuRoute } from './routes.js'

registerModal({
  name: 'user.auth',
  component: lazy(() => import('./ui/AuthModal.svelte')),
  route: userAuthRoute.href,
  size: { width: 420, height: 480 },
})
registerModal({
  name: 'user.menu',
  component: lazy(() => import('./ui/MenuModal.svelte')),
  route: userMenuRoute.href,
  size: { width: 280, height: 200 },
})
// Профиль: маршрутной загрузки у модалки НЕТ намеренно. Данные показа
// профиля запрашивает сам компонент профиля у `load` роута `/user/[id]`
// при показе; модалка — только носитель с ACL-гейтом. С `route` между
// носителем и компонентом встал бы снимок загрузчика модалок, и показ
// через меню и через список мог разойтись со свежим ответом роута.
registerModal({
  name: 'user.profile',
  component: lazy(() => import('./ui/ProfileModal.svelte')),
  size: { width: 480, height: 560 },
})
// Список seed-юзеров: та же модель — компонент списка сам запрашивает
// данные у `load` роута `/users` при показе (страница отдаёт ему свой
// SSR-снапшот), модалка только ACL-гейт. No-JS адреса у ссылок на список
// и профиль — явные `href` на страницы `/users` и `/user/<id>`.
registerModal({
  name: 'user.list',
  component: lazy(() => import('./ui/SeedUsersModal.svelte')),
  size: { width: 640, height: 560 },
})
// Фильтры списка: открывается кнопкой над списком, результат пишет в
// состояние пагинатора. `route` — страница-fallback `/users/filters` для
// no-JS (кнопка без JS ведёт туда, форма возвращает GET-ом к списку).
registerModal({
  name: 'user.list.filters',
  component: lazy(() => import('./ui/SeedUsersFiltersModal.svelte')),
  route: userListFiltersRoute.href,
  size: { width: 420, height: 560 },
})
