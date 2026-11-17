<!--
  Всплывашка одного нарезанного блока. Закрытие и слот живут здесь, не в
  каждом списке меток: хост сам решает лист, `programmatic` и `transfer`
  блок не возвращают — это перенос, не отказ.
-->
<script module lang="ts">
  let noticeSeq = 0
</script>

<script lang="ts">
  import { untrack } from 'svelte'
  import Floating from '#core/ui/floating/Floating.svelte'
  import type { HostFloatingCloseReason } from '#core/lib/modals/svelte/index.js'
  import type { FilterBlockEntry } from './filter-blocks.svelte.js'

  interface Props {
    entry: FilterBlockEntry
    anchor: HTMLElement | undefined
    /** Пояснение над полем; например, одиночный select с несколькими значениями. */
    notice?: string
    onClose: () => void
    onSlot: (slot: HTMLElement | null) => void
    reclaim: () => void
    container?: HTMLElement
  }

  let { entry, anchor, notice, onClose, onSlot, reclaim, container = $bindable() }: Props = $props()

  const placement = { gap: 6, minSideSpace: 160, maxOverlayHeight: 480 }
  const noticeId = `filter-block-notice-${++noticeSeq}`
  const hasNotice = $derived(!!notice)

  function onOpenChange(next: boolean, reason?: HostFloatingCloseReason) {
    if (next) return
    if (reason === 'programmatic' || reason === 'transfer') return
    onClose()
  }

  function adopt(el: HTMLElement) {
    onSlot(el)
    container = el
    return () => {
      container = undefined
      onSlot(null)
      reclaim()
    }
  }

  function removeNoticeFrom(control: HTMLElement) {
    const ids = (control.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
    const rest = ids.filter((id) => id !== noticeId)
    if (rest.length) control.setAttribute('aria-describedby', rest.join(' '))
    else control.removeAttribute('aria-describedby')
  }

  // Синхронизирует aria-describedby контролей при появлении/исчезновении notice
  // и при переносе блока во всплывашку.
  $effect(() => {
    if (!container) return
    if (!hasNotice) {
      for (const control of container.querySelectorAll<HTMLElement>('input, select, textarea')) removeNoticeFrom(control)
      return
    }
    const described = new Set<HTMLElement>()
    const sync = () => {
      for (const control of container!.querySelectorAll<HTMLElement>('input, select, textarea')) {
        const ids = (control.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
        if (!ids.includes(noticeId)) control.setAttribute('aria-describedby', [...ids, noticeId].join(' '))
        described.add(control)
      }
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(container, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      for (const control of described) removeNoticeFrom(control)
    }
  })
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
    <div class="p-3">
      {#if notice}
        <p id={noticeId} class="mb-2 text-xs text-muted-foreground" role="status" data-filter-block-notice>{notice}</p>
      {/if}
      <div data-filter-block-popup="" {@attach adopt}></div>
    </div>
  {/snippet}
</Floating>