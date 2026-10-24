import type { Path } from '$app/types'
import type { NavItem } from '#components/shell/index.js'
import { kitRoute } from '#lib/address/sveltekit.js'

/**
 * Страницы без параметров, которым нужен только адрес. `kitRoute` резолвит
 * маршрут штатным `resolve()` из `$app/paths` и регистрирует его в таблице
 * адресов: опечатка в пути ломает `svelte-check`, а не превращается в мёртвую
 * ссылку в сайдбаре.
 */
const fieldsRoute = kitRoute('/fields')
const stepsRoute = kitRoute('/steps')

/**
 * Карточка — параметрический маршрут. В `$app/types` у него нет «красивого»
 * `Path`: массивный идентификатор `/(site)/(app)/cards/[id]` и есть имя
 * маршрута, группы SvelteKit из адреса выбрасывает сам `resolve()`.
 */
const cardRoute = kitRoute('/(site)/(app)/cards/[id]', { dynamic: true, id: '/cards/[id]' })

/**
 * Статические пункты каркаса.
 *
 * `satisfies readonly { to: Path }[]` — не украшение: `Path` из `$app/types`
 * знает все существующие маршруты, поэтому опечатка (`/paginatro`) ломается на
 * `svelte-check`.
 */
const STATIC_ITEMS = [
  { to: '/', label: 'Главная' },
  { to: '/modals', label: 'Модалки' },
  { to: '/paginator', label: 'Пагинатор' },
  { to: '/form', label: 'Формы' },
  { to: fieldsRoute.href(), label: 'Поля' },
  { to: stepsRoute.href(), label: 'Шаги' },
  { to: '/db-demo', label: 'База данных' },
  { to: '/cycle', label: 'Cycle' },
  { to: '/spike', label: 'Spike' },
] satisfies readonly (NavItem & { readonly to: Path })[]

/** Пункты навигации каркаса: статические страницы и карточка с параметром. */
export const NAV_ITEMS: readonly NavItem[] = [
  ...STATIC_ITEMS,
  { to: cardRoute.href({ id: '1' }), label: 'Карточка #1' },
]
