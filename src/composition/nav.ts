import type { NavModuleExtension } from '#core/hooks/module-ext.js'
import { composeNav } from '#core/app/nav.js'

const navModules = import.meta.glob<{ navExtension?: NavModuleExtension }>(
  '/src/modules/**/nav.ext.ts',
  { eager: true },
)

const extensions = Object.keys(navModules)
  .sort()
  .map((key) => navModules[key]?.navExtension)
  .filter((ext): ext is NavModuleExtension => Boolean(ext))

const composed = composeNav(extensions)

export const NAV_ITEMS = composed.navItems
export const HOME_CARDS = composed.homeCards
export const HOME_ENTRIES = composed.homeEntries