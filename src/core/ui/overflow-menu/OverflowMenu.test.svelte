<script lang="ts">
  import { untrack } from 'svelte'
  import {
    setModalsContext,
    type HostFloatingApi,
    type ModalsContext,
  } from '#core/lib/modals/svelte/index.js'
  import OverflowMenu, { type OverflowMenuItem } from './OverflowMenu.svelte'

  let {
    floating,
    items,
    testId = 'probe',
    maxVisible = 1,
  }: {
    floating: HostFloatingApi
    items: OverflowMenuItem[]
    testId?: string
    maxVisible?: number
  } = $props()

  const api = untrack(() => floating)
  if (api) setModalsContext({ floating: api } as ModalsContext)
</script>

<OverflowMenu {items} {maxVisible} data-testid={testId} />
