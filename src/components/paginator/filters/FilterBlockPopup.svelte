<!--
  Всплывашка одного нарезанного блока. Закрытие и слот живут здесь, не в
  каждом списке меток: хост сам решает лист, `programmatic` и `transfer`
  блок не возвращают — это перенос, не отказ.
-->
<script lang="ts">
  import Floating from '#components/ui/floating/Floating.svelte'
  import type { HostFloatingCloseReason } from '#lib/modals/svelte/index.js'
  import type { FilterBlockEntry } from './filter-blocks.svelte.js'

  interface Props {
    entry: FilterBlockEntry
    anchor: HTMLElement | undefined
    onClose: () => void
    onSlot: (slot: HTMLElement | null) => void
    reclaim: () => void
    container?: HTMLElement
  }

  let { entry, anchor, onClose, onSlot, reclaim, container = $bindable() }: Props = $props()

  const placement = { gap: 6, minSideSpace: 160, maxOverlayHeight: 480 }

  function onOpenChange(next: boolean, reason?: HostFloatingCloseReason) {
    if (next) return
    if (reason === 'programmatic' || reason === 'transfer') return
    onClose()
  }

  function adopt(el: HTMLElement) {
    onSlot(el)
    return () => {
      reclaim()
      onSlot(null)
    }
  }
</script>

<Floating
  open
  {anchor}
  mode="flow"
  label={entry.label}
  title={entry.label}
  popup="dialog"
  minWidth={280}
  maxWidth={420}
  {placement}
  class="p-0 text-sm"
  returnFocus={true}
  bind:container
  {onOpenChange}
>
  {#snippet render()}
    <div class="p-3" data-filter-block-popup="" {@attach adopt}></div>
  {/snippet}
</Floating>
