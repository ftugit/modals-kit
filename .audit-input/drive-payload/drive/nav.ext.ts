import type { NavModuleExtension } from '#core/hooks/module-ext.js'
import DriveEntry from './ui/DriveEntry.svelte'

export const navExtension: NavModuleExtension = {
  order: 30,
  homeEntries: [{ id: 'drive', component: DriveEntry }],
}