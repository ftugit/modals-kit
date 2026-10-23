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

export interface UserAuthSearchInput extends Record<string, unknown> {
  stage?: string
  next?: string | null
}

export interface UserAuthSearchOutput {
  stage: string
  next: string | null
}

export const userAuthRoute = kitRoute('/user/auth', {
  owner: 'auth',
  keys: ['stage', 'stage.*', 'next'],
  defaults: { stage: 'entry', next: null },
  search: querySchema<UserAuthSearchInput, UserAuthSearchOutput>((raw) => ({
    stage: typeof raw.stage === 'string' && raw.stage ? raw.stage : 'entry',
    next: localPath(typeof raw.next === 'string' ? raw.next : null),
  })),
})

export const userMenuRoute = kitRoute('/user/menu')
