<script lang="ts">
  // Декларативный компонент для вставки слотов в шапку или сайдбар прямо из разметки страницы.
  import type { Snippet } from 'svelte'
  import {
    usePage,
    type HeaderSlotPath,
    type SidebarSlotPath,
    type SidebarZone,
  } from './page.svelte'

  interface Props {
    target: HeaderSlotPath | SidebarSlotPath | SidebarZone
    offset?: number
    enabled?: boolean
    children: Snippet
  }

  let { target, offset, enabled = true, children }: Props = $props()

  const page = usePage()

  const isSidebar = $derived(
    target.startsWith('sidebar.') ||
      target === 'top' ||
      target === 'middle' ||
      target === 'bottom',
  )

  $effect(() => {
    if (!enabled || !children) return

    if (isSidebar && (target.startsWith('sidebar.') || !target.includes('.'))) {
      return page.registerSidebarSlot(target as SidebarZone, children, offset)
    }

    return page.registerHeaderSlot(target as HeaderSlotPath, children, offset)
  })
</script>
