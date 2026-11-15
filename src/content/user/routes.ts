/**
 * Типизированные маршруты модуля пользователя (`#lib/address/sveltekit.js`).
 *
 * Единый источник правды о путях `/user/auth` и `/user/menu` и их query-ключах
 * (`stage`, `stage.*`, `next`) с проверкой существования роутов на этапе
 * компиляции (`RouteId` из `$app/types`), автоматической фильтрацией `next`
 * через `localPath` и общим владельцем `'auth'` с `useSteps` в `AuthWidget`.
 */
import { localPath } from '#lib/address/index.js'
import { kitRoute, querySchema } from '#lib/address/sveltekit.js'
import { parseSessionDeleteVariant, type SessionDeleteVariant } from './session-delete.js'

/**
 * Стадии экрана входа, выразимые адресом (`?stage=…`).
 *
 * Список закрытый: ключ `stage` — это не «что угодно из строки запроса», а
 * состояние экрана. Незнакомое значение откатывается к `entry` так же, как это
 * делал `parse`, но теперь ещё и проверяется типами на стороне вызова.
 */
export type AuthStage =
  | 'entry'
  | 'register'
  | 'restore'
  | 'confirm'
  | 'profile'
  | 'blocked'
  | 'restrictions'

const AUTH_STAGES: ReadonlySet<string> = new Set<AuthStage>([
  'entry',
  'register',
  'restore',
  'confirm',
  'profile',
  'blocked',
  'restrictions',
])

/**
 * Привести значение из адреса или результата экшена к стадии входа.
 * @param raw строка из `?stage=` либо `result.data.step`.
 * @returns известная стадия; всё остальное — `entry`.
 */
export function parseAuthStage(raw: unknown): AuthStage {
  if (typeof raw !== 'string') return 'entry'
  // Адрес шагов несёт ПОЛНЫЙ ключ цепочки (`auth.register` — хост + аддон
  // formSteps); плоское значение (`register`) — та же стадия короткой
  // записью. Принимаются обе формы, незнакомая стадия — `entry`.
  const flat = raw.startsWith('auth.') ? raw.slice('auth.'.length) : raw
  return AUTH_STAGES.has(flat) ? (flat as AuthStage) : 'entry'
}

export interface UserAuthSearchInput extends Record<string, unknown> {
  stage?: AuthStage
  next?: string | null
}

export interface UserAuthSearchOutput {
  stage: AuthStage
  next: string | null
}

export const userAuthRoute = kitRoute('/user/auth', {
  owner: 'auth',
  keys: ['stage', 'stage.*', 'next'],
  defaults: { stage: 'entry', next: null },
  search: querySchema<UserAuthSearchInput, UserAuthSearchOutput>((raw) => ({
    stage: parseAuthStage(raw.stage),
    next: localPath(typeof raw.next === 'string' ? raw.next : null),
  })),
})

export const userMenuRoute = kitRoute('/user/menu')

/** Свои устройства (`/user/sessions`) — страница-fallback модалки `user.sessions`. */
export const userSessionsRoute = kitRoute('/user/sessions')

/**
 * Устройства конкретного аккаунта (`/user/[id]/sessions`) — та же модалка
 * `user.sessions` с параметром `id`, только со своей страницей-fallback.
 * Один компонент на оба случая: иначе «свои» открывались модалкой, а чужие —
 * страницей, и один и тот же смысл имел два разных носителя.
 */
export const userAccountSessionsRoute = kitRoute('/(site)/(app)/user/[id=uuid]/sessions', {
  dynamic: true,
  id: '/user/[id]/sessions',
})

/**
 * Выход (`/user/logout`) — страница-fallback модалки `user.logout`. Здесь же
 * живут экшены набора: компонент один, POST уходит на этот адрес.
 */
export const userLogoutRoute = kitRoute('/user/logout')

/** Вход и выход адреса закрытия набора: `id`, `ids` и вариант. */
export interface SessionDeleteSearchInput extends Record<string, unknown> {
  id?: string | null
  ids?: string | null
  variant?: SessionDeleteVariant
  state?: string | null
  net?: string | null
  country?: string | null
  cfrom?: string | null
  cto?: string | null
  sfrom?: string | null
  sto?: string | null
}

export interface SessionDeleteSearchOutput {
  id: string | null
  ids: string | null
  variant: SessionDeleteVariant
  state: string | null
  net: string | null
  country: string | null
  cfrom: string | null
  cto: string | null
  sfrom: string | null
  sto: string | null
}

/**
 * Разбор адреса закрытия набора.
 *
 * Набор едет строкой `ids` (CSV) — её форму и предел разбирает
 * `parseSessionDeleteIds`, а здесь только «пусто → null»: предел проверяется в
 * загрузчике, чтобы отказ был кодом формы, а не тихой обрезкой адреса. Вариант
 * идёт закрытым списком (`delete` / `logout`).
 */
const sessionDeleteSearch = querySchema<SessionDeleteSearchInput, SessionDeleteSearchOutput>((raw) => ({
  id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : null,
  ids: typeof raw.ids === 'string' && raw.ids.trim() ? raw.ids.trim() : null,
  variant: parseSessionDeleteVariant(raw.variant),
  state: typeof raw.state === 'string' && raw.state.trim() ? raw.state.trim() : null,
  net: typeof raw.net === 'string' && raw.net.trim() ? raw.net.trim() : null,
  country: typeof raw.country === 'string' && raw.country.trim() ? raw.country.trim() : null,
  cfrom: typeof raw.cfrom === 'string' && raw.cfrom.trim() ? raw.cfrom.trim() : null,
  cto: typeof raw.cto === 'string' && raw.cto.trim() ? raw.cto.trim() : null,
  sfrom: typeof raw.sfrom === 'string' && raw.sfrom.trim() ? raw.sfrom.trim() : null,
  sto: typeof raw.sto === 'string' && raw.sto.trim() ? raw.sto.trim() : null,
}))

/**
 * Закрытие устройств своего аккаунта (`/user/sessions/delete`) — один из двух
 * адресов единицы `user.session.delete` (план сессий §8.1).
 *
 * Это **не** карточка устройства: набор приходит адресом (`id`/`ids`), цель —
 * своя. Переданная цель живёт на втором адресе, `/user/[id]/sessions/delete`.
 */
export const userSessionsDeleteRoute = kitRoute('/user/sessions/delete', {
  owner: 'sessions.delete',
  keys: ['id', 'ids', 'variant', 'state', 'net', 'country', 'cfrom', 'cto', 'sfrom', 'sto'],
  defaults: { id: null, ids: null, variant: 'delete', state: null, net: null, country: null, cfrom: null, cto: null, sfrom: null, sto: null },
  search: sessionDeleteSearch,
})

/**
 * Закрытие устройств переданного аккаунта (`/user/[id]/sessions/delete`) —
 * второй адрес той же единицы. Цель — `id` пути, набор — `ids` адресом.
 */
export const userAccountSessionsDeleteRoute = kitRoute(
  '/(site)/(app)/user/[id=uuid]/sessions/delete',
  {
    dynamic: true,
    id: '/user/[id]/sessions/delete',
    owner: 'sessions.delete',
    // Ключа `id` у этого адреса нет: `id` здесь — параметр пути (цель-аккаунт).
    // Набор едет `ids`, одиночный случай — набор из одного элемента; иначе имя
    // поискового ключа совпало бы с сегментом и `href` не смог бы различить их.
    keys: ['ids', 'variant', 'state', 'net', 'country', 'cfrom', 'cto', 'sfrom', 'sto'],
    defaults: { ids: null, variant: 'delete', state: null, net: null, country: null, cfrom: null, cto: null, sfrom: null, sto: null },
    search: sessionDeleteSearch,
  },
)

/** Общий журнал устройств (`/sessions`): все сессии, которые зритель вправе читать. */
export const sessionsJournalRoute = kitRoute('/sessions')

/**
 * Карточка одного устройства — адрес пары `user.session` (модалка/роут).
 * Сегмент ограничен матчером `[id=uuid]`: не-UUID отсекается 404 до `load`.
 */
export const userSessionRoute = kitRoute('/(site)/(app)/user/sessions/[id=uuid]', {
  dynamic: true,
  id: '/user/sessions/[id]',
})

/**
 * Карточка устройства чужого аккаунта (`/user/[id]/sessions/[id]`) — та же
 * пара `user.session`, что и у своих, но с целью в адресе: без JS строка
 * чужого списка ведёт сюда, а не на `/user/sessions/<id>`.
 */
export const userAccountSessionRoute = kitRoute('/(site)/(app)/user/[id=uuid]/sessions/[sessionId=uuid]', {
  dynamic: true,
  id: '/user/[id]/sessions/[sessionId]',
})

/**
 * Профиль аккаунта — путь с параметром сегмента. В `$app/types` у такого
 * маршрута нет «красивого» имени: идентификатор вместе с группами
 * (`/(site)/(app)/user/[id]`) — это и есть имя, группы из адреса выбрасывает
 * сам `resolve()`; `id` задаёт имя в таблице адресов. Сегмент ограничен
 * матчером `[id=uuid]` (`src/params.js`): не-UUID роутер отсекает
 * настоящим 404 до `load` — и на странице, и в данных модалки.
 *
 * Этим же адресом пользуется регистрация пары `user.profile`
 * (`route` в `modals.ts`): ссылки на профиль строят из него `href`
 * (модалка с JS, этот роут без JS), а данные показа компонент профиля
 * запрашивает у `load` этого же роута сам. Адрес описан один раз —
 * страница и модалка не могут разойтись.
 */
export const userProfileRoute = kitRoute('/(site)/(app)/user/[id=uuid]', {
  dynamic: true,
  id: '/user/[id]',
})

/** Редактирование профиля — адрес пары `user.profile.edit` (модалка/роут). */
export const userProfileEditRoute = kitRoute('/(site)/(app)/user/[id=uuid]/edit', {
  dynamic: true,
  id: '/user/[id]/edit',
})

/** Удаление профиля — адрес пары `user.profile.delete` (модалка/роут). */
export const userProfileDeleteRoute = kitRoute('/(site)/(app)/user/[id=uuid]/delete', {
  dynamic: true,
  id: '/user/[id]/delete',
})

/**
 * Список seed-юзеров — статический адрес `/users`. Этим же адресом
 * пользуется регистрация пары `user.list` (`route` в `modals.ts`):
 * ссылки строят из него `href`, данные компонент списка запрашивает
 * у `load` этого же роута сам. Адрес описан один раз — страница и
 * модалка не могут разойтись.
 */
export const userListRoute = kitRoute('/users')

/** Список профилей — статический адрес `/profiles`. */
export const profilesListRoute = kitRoute('/profiles')

export interface ListFiltersSearchInput extends Record<string, unknown> {
  from?: string | null
}

export interface ListFiltersSearchOutput {
  from: string | null
}

export interface BlocksFiltersSearchInput extends ListFiltersSearchInput {
  uid?: string | null
}

export interface BlocksFiltersSearchOutput extends ListFiltersSearchOutput {
  uid: string | null
}

export interface SessionsFiltersSearchInput extends ListFiltersSearchInput {
  uid?: string | null
  journal?: string | null
}

export interface SessionsFiltersSearchOutput extends ListFiltersSearchOutput {
  uid: string | null
  journal: boolean
}

/**
 * Фильтры списка seed-юзеров: страница-fallback модалки `user.list.filters`
 * (канон «модалка + страница», как `user.menu`): с JS кнопка над списком
 * открывает модалку, без JS ведёт сюда; форма страницы — GET обратно к
 * списку (адрес носителя несёт параметр `from`, список может жить где угодно).
 */
export const userListFiltersRoute = kitRoute('/users/filters', {
  owner: 'user.filters',
  keys: ['from'],
  search: querySchema<ListFiltersSearchInput, ListFiltersSearchOutput>((raw) => ({
    from: localPath(typeof raw.from === 'string' ? raw.from : null),
  })),
})

export interface UsersDeleteSearchInput extends Record<string, unknown> {
  /** Адрес списка-носителя: из него берутся условия среза (`users.*`). */
  'del.list'?: string | null
  'del.id'?: string | null
  'del.ids'?: string | null
}

export interface UsersDeleteSearchOutput {
  'del.list': string | null
  'del.id': string | null
  'del.ids': string | null
}

/**
 * Удаление аккаунтов набором (`/users/delete`) — адрес единицы
 * `user.accounts.delete`. Набор (`id`/`ids`) или адрес списка (`list`) передаёт
 * носитель; срез из `list` считает сервер; страница — fallback модалки.
 */
export const usersDeleteRoute = kitRoute('/users/delete', {
  owner: 'users.delete',
  keys: ['del.list', 'del.id', 'del.ids'],
  defaults: { 'del.list': null, 'del.id': null, 'del.ids': null },
  search: querySchema<UsersDeleteSearchInput, UsersDeleteSearchOutput>((raw) => ({
    'del.list': localPath(typeof raw['del.list'] === 'string' ? raw['del.list'] : null),
    'del.id': typeof raw['del.id'] === 'string' && raw['del.id'] ? raw['del.id'] : null,
    'del.ids': typeof raw['del.ids'] === 'string' && raw['del.ids'] ? raw['del.ids'] : null,
  })),
})

/**
 * Фильтры списка устройств: страница-fallback модалки `user.sessions.filters`.
 * Как у фильтров seed-списка — адрес носителя в параметре `from`.
 */
export const userSessionsFiltersRoute = kitRoute('/user/sessions/filters', {
  owner: 'user.filters',
  keys: ['from', 'uid', 'journal'],
  search: querySchema<SessionsFiltersSearchInput, SessionsFiltersSearchOutput>((raw) => ({
    from: localPath(typeof raw.from === 'string' ? raw.from : null),
    uid: typeof raw.uid === 'string' && raw.uid ? raw.uid : null,
    journal: raw.journal === '1' || raw.journal === 'true',
  })),
})

/**
 * Выбор пользователей поверх списка seed-юзеров (`single` / `multiple`):
 * страница-fallback модалки `user.picker` для no-JS и прямых переходов.
 */
export const userPickerRoute = kitRoute('/users/pick')

/** Глобальный список всех блокировок (`/blocks`). */
export const blocksListRoute = kitRoute('/blocks')

/** Список блокировок конкретного пользователя (`/user/[id]/blocks`). */
export const userBlocksRoute = kitRoute('/(site)/(app)/user/[id=uuid]/blocks', {
  dynamic: true,
  id: '/user/[id]/blocks',
})

/**
 * Фильтры списка блокировок — страница-fallback модалки `user.blocks.filters`.
 * Бронь как у фильтров списка плюс `uid`: у этой модалки список может
 * принадлежать конкретному пользователю (`uid` — чей список).
 */
export const blocksFiltersRoute = kitRoute('/blocks/filters', {
  owner: 'user.filters',
  keys: ['from', 'uid'],
  search: querySchema<BlocksFiltersSearchInput, BlocksFiltersSearchOutput>((raw) => ({
    from: localPath(typeof raw.from === 'string' ? raw.from : null),
    uid: typeof raw.uid === 'string' && raw.uid ? raw.uid : null,
  })),
})

export interface BlocksCreateSearchInput extends Record<string, unknown> {
  uids?: string | null
  subjects?: string | null
  subject?: string | null
  'blk.list'?: string | null
}

export interface BlocksCreateSearchOutput {
  uids: string | null
  subjects: string | null
  subject: string | null
  /** Адрес списка-носителя: из него берётся срез, когда целей списком нет. */
  'blk.list': string | null
}

/** Создание блокировки из глобального списка (`/blocks/new`). */
export const blocksCreateRoute = kitRoute('/blocks/new', {
  owner: 'blocks.create',
  keys: ['uids', 'subjects', 'subject', 'blk.list'],
  defaults: { uids: null, subjects: null, subject: null, 'blk.list': null },
  search: querySchema<BlocksCreateSearchInput, BlocksCreateSearchOutput>((raw) => ({
    uids: typeof raw.uids === 'string' && raw.uids ? raw.uids : null,
    subjects: typeof raw.subjects === 'string' && raw.subjects ? raw.subjects : null,
    subject: typeof raw.subject === 'string' && raw.subject ? raw.subject : null,
    'blk.list': localPath(typeof raw['blk.list'] === 'string' ? raw['blk.list'] : null),
  })),
})

/**
 * Наборные действия над блокировками (`user.blocks.bulk`): снять или мягко
 * удалить записи набора. Срез едет адресом списка (`bb.list`) — ключи списка
 * (`blocks.*`) не пересказываются здесь по одному; явный набор — `bb.ids`.
 * Префиксы `bb.*` нужны, потому что `list` и `ids` забронированы другими адресами.
 */
export interface BlocksBulkSearchInput extends Record<string, unknown> {
  'bb.list'?: string | null
  'bb.ids'?: string | null
}

export interface BlocksBulkSearchOutput {
  'bb.list': string | null
  'bb.ids': string | null
}

export const blocksBulkRoute = kitRoute('/blocks/bulk', {
  owner: 'blocks.bulk',
  keys: ['bb.list', 'bb.ids'],
  defaults: { 'bb.list': null, 'bb.ids': null },
  search: querySchema<BlocksBulkSearchInput, BlocksBulkSearchOutput>((raw) => ({
    'bb.list': localPath(typeof raw['bb.list'] === 'string' ? raw['bb.list'] : null),
    'bb.ids': typeof raw['bb.ids'] === 'string' && raw['bb.ids'] ? raw['bb.ids'] : null,
  })),
})

/** Создание блокировки конкретного пользователя (`/user/[id]/blocks/new`). */
export const userBlocksCreateRoute = kitRoute('/(site)/(app)/user/[id=uuid]/blocks/new', {
  dynamic: true,
  id: '/user/[id]/blocks/new',
})

/** Карточка редактирования / просмотра блокировки из глобального списка (`/blocks/[blockId]`). */
export const blocksEditRoute = kitRoute('/(site)/(app)/blocks/[blockId=uuid]', {
  dynamic: true,
  id: '/blocks/[blockId]',
})

/** Карточка редактирования / просмотра блокировки пользователя (`/user/[id]/blocks/[blockId]`). */
export const userBlocksEditRoute = kitRoute('/(site)/(app)/user/[id=uuid]/blocks/[blockId=uuid]', {
  dynamic: true,
  id: '/user/[id]/blocks/[blockId]',
})

/** Удаление блокировки из глобального списка (`/blocks/[blockId]/delete`). */
export const blocksDeleteRoute = kitRoute('/(site)/(app)/blocks/[blockId=uuid]/delete', {
  dynamic: true,
  id: '/blocks/[blockId]/delete',
})

/** Удаление блокировки конкретного пользователя (`/user/[id]/blocks/[blockId]/delete`). */
export const userBlocksDeleteRoute = kitRoute(
  '/(site)/(app)/user/[id=uuid]/blocks/[blockId=uuid]/delete',
  {
    dynamic: true,
    id: '/user/[id]/blocks/[blockId]/delete',
  },
)

/** Настройки текущего пользователя (`/user/config`). */
export const userConfigRoute = kitRoute('/user/config')

/** Настройки конкретного пользователя по UUID (`/user/[id]/config`). */
export const userAccountConfigRoute = kitRoute('/(site)/(app)/user/[id=uuid]/config', {
  dynamic: true,
  id: '/user/[id]/config',
})




