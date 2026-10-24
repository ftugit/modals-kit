import type { Path } from '$app/types'
import type { NavItem } from '#components/shell/index.js'

/**
 * Статические пункты каркаса.
 *
 * `satisfies readonly { to: Path }[]` — не украшение: `Path` из `$app/types`
 * знает все существующие маршруты, поэтому опечатка (`/paginatro`) ломается на
 * `svelte-check`, а не превращается в мёртвую ссылку в сайдбаре.
 */
const STATIC_ITEMS = [
  { to: '/', label: 'Главная' },
  { to: '/modals', label: 'Модалки' },
  { to: '/paginator', label: 'Пагинатор' },
  { to: '/form', label: 'Формы' },
  { to: '/fields', label: 'Поля' },
  { to: '/steps', label: 'Шаги' },
  { to: '/db-demo', label: 'База данных' },
  { to: '/cycle', label: 'Cycle' },
  { to: '/spike', label: 'Spike' },
] satisfies readonly (NavItem & { readonly to: Path })[]

/**
 * Пункты навигации каркаса.
 *
 * Карточка — параметрический маршрут: её адрес (`/cards/1`) не является `Path`
 * (в типах SvelteKit это шаблон `/cards/[id]`), поэтому строка стоит отдельно и
 * с комментарием, а не растворяется в общем списке как «просто строка».
 */
export const NAV_ITEMS: readonly NavItem[] = [
  ...STATIC_ITEMS,
  { to: '/cards/1', label: 'Карточка #1' }, // шаблон маршрута — `/cards/[id]`
]
