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
  blocksCreateRoute,
  blocksDeleteRoute,
  blocksEditRoute,
  blocksFiltersRoute,
  blocksListRoute,
  userAccountConfigRoute,
  userAuthRoute,
  userBlocksCreateRoute,
  userBlocksDeleteRoute,
  userBlocksEditRoute,
  userBlocksRoute,
  userConfigRoute,
  userListFiltersRoute,
  userListRoute,
  userLogoutRoute,
  sessionsJournalRoute,
  userMenuRoute,
  userSessionRoute,
  userSessionsFiltersRoute,
  userSessionsRoute,
  userPickerRoute,
  userProfileDeleteRoute,
  userProfileEditRoute,
  userProfileRoute,
  userAccountSessionRoute,
  userAccountSessionsRoute,
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
  size: { width: 320, height: 360 },
})
// Устройства аккаунта: один компонент на свои и чужие. `id` аккаунта задаёт
// и цель внутри списка, и страницу-fallback без JS (`/user/[id]/sessions`);
// без `id` — свои устройства и `/user/sessions`.
registerModal({
  name: 'user.sessions',
  component: lazy(() => import('./ui/SessionsModal.svelte')),
  route: (p: { id?: string }) =>
    p?.id ? userAccountSessionsRoute.href({ id: String(p.id) }) : userSessionsRoute.href(),
  size: { width: 560, height: 600 },
})
// Журнал сессий (`/sessions`) — самостоятельная единица: свой роут и свой
// ключ модалки, а не «список с флагом, до которого надо перейти». Параметра
// цели у пары нет: журнал и есть «все читаемые сессии», цель внутри задаёт
// флаг носителя, а не адрес.
registerModal({
  name: 'user.sessions.journal',
  component: lazy(() => import('./ui/SessionsJournalModal.svelte')),
  route: sessionsJournalRoute.href,
  size: { width: 560, height: 600 },
})
// Фильтры списка устройств: открываются кнопкой «Фильтры» в списке, результат
// пишут в состояние пагинатора-владельца. `route` — страница-fallback
// `/user/sessions/filters` для no-JS.
// `uid` — цель среза: без него `load` страницы разобрал бы адрес носителя
// (`from`) и в модалке чужого аккаунта взял бы страны и права **своих**
// сессий. Так же устроены фильтры блокировок (`user.blocks.filters`).
registerModal({
  name: 'user.sessions.filters',
  component: lazy(() => import('./ui/SessionsFiltersModal.svelte')),
  defaultParams: { uid: '' },
  route: (p: { uid?: string }) => userSessionsFiltersRoute.href({ uid: p?.uid ? String(p.uid) : null }),
  size: { width: 440, height: 600 },
})
// Карточка устройства (переименование и отзыв). Пара «модалка + роут»:
// без JS строка списка ведёт на `/user/sessions/<id>` с тем же компонентом.
// С `uid` — карточка устройства чужого аккаунта: тот же компонент, но адрес
// `/user/[id]/sessions/[sessionId]`, иначе строка чужого списка падала бы на
// свой путь и теряла цель.
registerModal({
  name: 'user.session',
  component: lazy(() => import('./ui/SessionModal.svelte')),
  route: (p: { id?: string; uid?: string }) => {
    const uid = p?.uid ? String(p.uid) : null
    const id = p?.id ? String(p.id) : null
    if (uid && id) return userAccountSessionRoute.href({ id: uid, sessionId: id })
    if (id) return userSessionRoute.href({ id })
    return uid ? userAccountSessionsRoute.href({ id: uid }) : userSessionsRoute.href()
  },
  size: { width: 480, height: 560 },
})
// Выход: та же пара — модалка и страница `/user/logout`. Данные приносит
// загрузчик записи (тот же `load`): номер своей сессии и сколько их всего,
// чтобы чекбокс знал, что он раздвигает.
registerModal({
  name: 'user.logout',
  component: lazy(() => import('./ui/LogoutModal.svelte')),
  route: userLogoutRoute.href,
  size: { width: 440, height: 480 },
})
// Профиль: пара «модалка + роут» одного компонента. `route` нужен
// ссылке (`asModalLink` строит из него `href` — без JS карточка ведёт
// на страницу `/user/<id>` с тем же компонентом). Данные показа приносит
// загрузчик записи — тот же `load` роута, его ответ уходит в компонент
// пропсом `route`; собственный запрос компонента остаётся резервом на
// случай носителя без загрузчика (страница со своим SSR-результатом).
// Модалка — только носитель с ACL.
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
// Список seed-юзеров: та же пара — данные приносит загрузчик записи (тот
// же `load` роута `/users`; страница отдаёт свой SSR-результат), его ответ
// уходит списку пропсом `initial`; модалка только ACL-гейт, `route` даёт
// ссылкам `href`.
registerModal({
  name: 'user.list',
  component: lazy(() => import('./ui/SeedUsersModal.svelte')),
  route: userListRoute.href,
  size: { width: 640, height: 560 },
})
// Фильтры списка: открывается кнопкой над списком, результат пишет в
// состояние пагинатора слота-владельца. `route` — страница-fallback `/users/filters`
// для no-JS (кнопка без JS ведёт туда, форма возвращает GET-ом к списку).
registerModal({
  name: 'user.list.filters',
  component: lazy(() => import('./ui/SeedUsersFiltersModal.svelte')),
  route: () => userListFiltersRoute.href(),
  size: { width: 420, height: 560 },
})
// Выбор одного или нескольких пользователей поверх `SeedUsersList`
// (живёт в памяти без записи в адресную строку; без JS — страница `/users/pick`
// с возвратом по `from`).
registerModal({
  name: 'user.picker',
  component: lazy(() => import('./ui/UserPickerModal.svelte')),
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
// Список блокировок: поддерживает и конкретного пользователя (`{ id }`),
// и глобальный список (`{}`).
registerModal({
  name: 'user.blocks',
  component: lazy(() => import('./ui/BlocksModal.svelte')),
  route: (p: { id?: string }) =>
    p?.id ? userBlocksRoute.href({ id: String(p.id) }) : blocksListRoute.href(),
  size: { width: 680, height: 560 },
})
// Фильтры списка блокировок (`{ uid?, uids? }` передаёт контекст
// фиксированного юзера и подтверждённый выбор субъектов в URL).
registerModal({
  name: 'user.blocks.filters',
  component: lazy(() => import('./ui/BlocksFiltersModal.svelte')),
  defaultParams: { uids: '' },
  route: (p: { uid?: string; uids?: string }) =>
    blocksFiltersRoute.href({ uid: p?.uid ?? null }),
  size: { width: 460, height: 580 },
})
// Создание блокировки (`{ uid?, uids? }`).
registerModal({
  name: 'user.blocks.create',
  component: lazy(() => import('./ui/BlockCreateModal.svelte')),
  defaultParams: { uids: '' },
  route: (p: { uid?: string; uids?: string }) => {
    if (p?.uid) return userBlocksCreateRoute.href({ id: String(p.uid) })
    const uids = p?.uids ? String(p.uids).trim() : ''
    return blocksCreateRoute.href({ uids: uids || null })
  },
  size: { width: 480, height: 560 },
})
// Редактирование или read-only просмотр блокировки (`{ blockId, uid? }`).
registerModal({
  name: 'user.blocks.edit',
  component: lazy(() => import('./ui/BlockEditModal.svelte')),
  route: (p: { blockId: string; uid?: string }) => {
    const blockId = String(p?.blockId ?? '').trim()
    if (!blockId) throw new Error('[modals] blockId is required')
    return p?.uid
      ? userBlocksEditRoute.href({ id: String(p.uid), blockId })
      : blocksEditRoute.href({ blockId })
  },
  size: { width: 480, height: 580 },
})
// Удаление блокировки (`{ blockId, uid? }`).
registerModal({
  name: 'user.blocks.delete',
  component: lazy(() => import('./ui/BlockDeleteModal.svelte')),
  route: (p: { blockId: string; uid?: string }) => {
    const blockId = String(p?.blockId ?? '').trim()
    if (!blockId) throw new Error('[modals] blockId is required')
    return p?.uid
      ? userBlocksDeleteRoute.href({ id: String(p.uid), blockId })
      : blocksDeleteRoute.href({ blockId })
  },
  size: { width: 460, height: 440 },
})
// Настройки пользователя (`{ id? }`): без `id` — свои настройки (`/user/config`),
// с `id` — настройки целевого аккаунта (`/user/[id]/config`).
registerModal({
  name: 'user.config.edit',
  component: lazy(() => import('./ui/UserConfigModal.svelte')),
  route: (p: { id?: string }) =>
    p?.id ? userAccountConfigRoute.href({ id: String(p.id) }) : userConfigRoute.href(),
  size: { width: 520, height: 560 },
})




