<script lang="ts">
  import { untrack } from 'svelte'
  import { setModalsContext, type HostFloatingApi, type ModalsContext } from '#lib/modals/svelte/index.js'
  import Floating from './Floating.svelte'

  let {
    floating,
    mode = 'popup',
    sheetOnNarrow,
    frame = true,
    open = true,
  }: {
    floating?: HostFloatingApi
    mode?: 'popup' | 'flow'
    sheetOnNarrow?: boolean
    frame?: boolean
    open?: boolean
  } = $props()

  const api = untrack(() => floating)
  if (api) setModalsContext({ floating: api } as ModalsContext)

  let anchor = $state<HTMLButtonElement | null>(null)
  let shown = $state(untrack(() => open))
</script>

<button type="button" bind:this={anchor} data-floating-anchor="">Якорь</button>
<Floating
  open={shown}
  {anchor}
  {mode}
  {sheetOnNarrow}
  {frame}
  label="Проба"
  title="Проба"
  minWidth={180}
  onOpenChange={(next) => {
    shown = next
  }}
>
  {#snippet render({ close })}
    <p data-floating-body="">Содержимое</p>
    <button type="button" data-floating-request="" onclick={close}>Убрать</button>
  {/snippet}
</Floating>
