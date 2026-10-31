import type { Path } from '$app/types'
import type { NavItem } from '#components/shell/index.js'
import type { ModuleHomeCard, NavModuleExtension } from '#hooks/module-ext.js'

const CORE_ITEMS = [{ to: '/', label: 'Главная' }] satisfies readonly (NavItem & {
  readonly to: Path
})[]

const navModules = import.meta.glob<{ navExtension?: NavModuleExtension }>(
  '../../content/*/nav.ext.ts',
  { eager: true },
)

const sortedExtensions = Object.keys(navModules)
  .sort()
  .map((key) => navModules[key]?.navExtension)
  .filter((ext): ext is NavModuleExtension => Boolean(ext))
  .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))

/** Пункты навигации каркаса: базовый маршрут и пункты установленных модулей. */
export const NAV_ITEMS: readonly NavItem[] = [
  ...CORE_ITEMS,
  ...sortedExtensions.flatMap((ext) => ext.navItems ?? []),
]

/** Карточки разделов установленных модулей для стартовой страницы (`/`). */
export const HOME_CARDS: readonly ModuleHomeCard[] = sortedExtensions.flatMap(
  (ext) => ext.homeCards ?? [],
)
