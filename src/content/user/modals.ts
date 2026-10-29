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
import {
  userAuthRoute,
  userListFiltersRoute,
  userListRoute,
  userMenuRoute,
  userPickerRoute,
  userProfileDeleteRoute,
  userProfileEditRoute,
  userProfileRoute,
} from './routes.js'

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
// Профиль: пара «модалка + роут» одного компонента. `route` нужен
// ссылке (`asModalLink` строит из него `href` — без JS карточка ведёт
// на страницу `/user/<id>` с тем же компонентом); данные показа
// компонент профиля всё равно запрашивает сам у `load` этого роута
// при показе — ответ загрузчика при открытии и его ответ совпадают,
// отдельного снимка в показе нет. Модалка — только носитель с ACL.
registerModal({
  name: 'user.profile',
  component: lazy(() => import('./ui/ProfileModal.svelte')),
  route: userProfileRoute.href,
  size: { width: 480, height: 560 },
})
// Редактирование профиля: та же пара на форму `ProfileForm` по id —
// кнопка в компоненте профиля ведёт сюда (без JS — на роут).
registerModal({
  name: 'user.profile.edit',
  component: lazy(() => import('./ui/ProfileEditModal.svelte')),
  route: userProfileEditRoute.href,
  size: { width: 480, height: 560 },
})
// Удаление профиля: та же пара — гейт по флагу `canDeleteProfile` чтения
// `/user/[id]`, внутри только `ProfileDelete`; без JS — роут
// `/user/[id]/delete` с тем же гейтом и тем же компонентом.
registerModal({
  name: 'user.profile.delete',
  component: lazy(() => import('./ui/ProfileDeleteModal.svelte')),
  route: userProfileDeleteRoute.href,
  size: { width: 480, height: 480 },
})
// Список seed-юзеров: та же пара — компонент списка сам запрашивает
// данные у `load` роута `/users` при показе (страница отдаёт ему свой
// SSR-снапшот), модалка только ACL-гейт; `route` даёт ссылкам `href`.
registerModal({
  name: 'user.list',
  component: lazy(() => import('./ui/SeedUsersModal.svelte')),
  route: userListRoute.href,
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
// Выбор одного или нескольких пользователей поверх `SeedUsersList`
// (используется фильтрами блокировок и глобальным созданием блокировки;
// без JS — страница `/users/pick` с возвратом по `from`).
registerModal({
  name: 'user.picker',
  component: lazy(() => import('./ui/UserPickerModal.svelte')),
  route: userPickerRoute.href,
  size: { width: 640, height: 580 },
})

