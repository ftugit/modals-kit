import type { Path } from '$app/types'
import type { NavItem } from '#core/ui/shell/index.js'
import type { ModuleHomeCard, NavModuleExtension } from '#core/hooks/module-ext.js'

const CORE_ITEMS = [{ to: '/', label: 'Главная' }] satisfies readonly (NavItem & {
  readonly to: Path
})[]

const extensions: NavModuleExtension[] = []

function rebuild(): void {
  const sorted = [...extensions].sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
  NAV_ITEMS.splice(0, NAV_ITEMS.length, ...CORE_ITEMS, ...sorted.flatMap((ext) => ext.navItems ?? []))
  HOME_CARDS.splice(0, HOME_CARDS.length, ...sorted.flatMap((ext) => ext.homeCards ?? []))
}

export function registerNavExtension(ext: NavModuleExtension): void {
  extensions.push(ext)
  rebuild()
}

export const NAV_ITEMS: NavItem[] = [...CORE_ITEMS]

export const HOME_CARDS: ModuleHomeCard[] = []