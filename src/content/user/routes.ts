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

/**
 * Фильтры списка seed-юзеров: страница-fallback модалки `user.list.filters`
 * (канон «модалка + страница», как `user.menu`): с JS кнопка над списком
 * открывает модалку, без JS ведёт сюда; форма страницы — GET обратно к
 * списку (адрес носителя несёт параметр `from`, список может жить где угодно).
 */
export const userListFiltersRoute = kitRoute('/users/filters')

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

/** Фильтры списка блокировок — страница-fallback модалки `user.blocks.filters`. */
export const blocksFiltersRoute = kitRoute('/blocks/filters')

/** Создание блокировки из глобального списка (`/blocks/new`). */
export const blocksCreateRoute = kitRoute('/blocks/new')

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




