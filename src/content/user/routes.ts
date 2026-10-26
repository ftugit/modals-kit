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
  return typeof raw === 'string' && AUTH_STAGES.has(raw) ? (raw as AuthStage) : 'entry'
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
 * сам `resolve()`; `id` задаёт имя в таблице адресов.
 *
 * Этим же адресом пользуется модалка `user.profile`
 * (`route: userProfileRoute.href`), поэтому адрес профиля описан один раз и
 * страница с модалкой не могут разойтись.
 */
export const userProfileRoute = kitRoute('/(site)/(app)/user/[id]', {
  dynamic: true,
  id: '/user/[id]',
})

/**
 * Список seed-юзеров — статический адрес `/users`. Этим же адресом пользуется
 * модалка `user.list` (`route: userListRoute.href`), поэтому адрес списка
 * описан один раз и страница с модалкой не могут разойтись.
 */
export const userListRoute = kitRoute('/users')
