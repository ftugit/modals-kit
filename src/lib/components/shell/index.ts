// Публичный API модуля App Shell (шапка, сайдбар, SEO).
export {
  PageState,
  setPageContext,
  usePage,
  useHeaderSlot,
  useHeaderSlots,
  useSidebarSlot,
  useHeadSeo,
  HEADER_ROWS,
  HEADER_SIDES,
  SIDEBAR_ZONES,
  type HeaderRow,
  type HeaderSide,
  type HeaderSlotPath,
  type SidebarZone,
  type SidebarSlotPath,
  type HeadSeo,
  type HeaderSlots,
  type SidebarSlots,
  type RowSlots,
  type SlotItem,
} from './page.svelte'

export {
  ShellState,
  setShellContext,
  useShell,
  type HeaderDock,
  type SidebarSide,
} from './shell.svelte'

export { default as AppShell } from './AppShell.svelte'
export { default as CollapsingHeader } from './CollapsingHeader.svelte'
export { default as HeaderRowView } from './HeaderRowView.svelte'
export { default as HeaderSlot } from './HeaderSlot.svelte'
export { default as PageHead } from './PageHead.svelte'
