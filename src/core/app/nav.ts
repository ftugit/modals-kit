import type { Path } from '$app/types'
import type { NavItem } from '#core/ui/shell/index.js'
import type { ModuleHomeCard, NavModuleExtension, NavModuleHomeEntry } from '#core/hooks/module-ext.js'

const CORE_ITEMS = [{ to: '/', label: 'Главная' }] satisfies readonly (NavItem & {
  readonly to: Path
})[]

export interface NavComposition {
  readonly navItems: readonly NavItem[]
  readonly homeCards: readonly ModuleHomeCard[]
  readonly homeEntries: readonly NavModuleHomeEntry[]
}

export function composeNav(extensions: readonly NavModuleExtension[]): NavComposition {
  const sorted = [...extensions].sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
  const homeEntries = sorted.flatMap((ext) => ext.homeEntries ?? [])
  const seen = new Set<string>()
  for (const entry of homeEntries) {
    if (seen.has(entry.id)) throw new Error(`[nav] duplicate home entry id: ${entry.id}`)
    seen.add(entry.id)
  }
  return {
    navItems: [...CORE_ITEMS, ...sorted.flatMap((ext) => ext.navItems ?? [])],
    homeCards: sorted.flatMap((ext) => ext.homeCards ?? []),
    homeEntries,
  }
}