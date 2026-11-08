<script lang="ts">
  // Отображение одного ряда шапки (start / center / end)
  import type { Snippet } from 'svelte'
  import { renderMergeSlot, type RowSlots } from './page.svelte'

  interface Props {
    slots: RowSlots
    leading?: Snippet
    class?: string
  }

  let { slots, leading, class: className = '' }: Props = $props()

  // Маркер хранит offset числом. В порядок его переводит рендер, не регистрация.
  const start = $derived(renderMergeSlot(slots.start))
  const center = $derived(renderMergeSlot(slots.center))
  const end = $derived(renderMergeSlot(slots.end))
</script>

<div
  class={`mx-auto flex w-full max-w-5xl flex-wrap items-center gap-y-1 px-4 ${className}`}
>
  <!-- START -->
  {#if leading || start.length > 0}
    <div
      class="flex min-w-0 items-center gap-2 overflow-x-auto [scrollbar-width:none]"
    >
      {#if leading}
        {@render leading()}
      {/if}
      {#each start as item (item.id)}
        {@render item.snippet()}
      {/each}
    </div>
  {/if}

  <!-- CENTER -->
  {#if center.length > 0}
    <div
      class="flex min-w-0 flex-1 items-center justify-start gap-2 overflow-x-auto px-3 [scrollbar-width:none]"
    >
      {#each center as item (item.id)}
        {@render item.snippet()}
      {/each}
    </div>
  {/if}

  <!-- END -->
  {#if end.length > 0}
    <div
      class="ml-auto flex min-w-0 items-center gap-1 overflow-x-auto whitespace-nowrap sm:gap-1.5 [scrollbar-width:none]"
    >
      {#each end as item (item.id)}
        {@render item.snippet()}
      {/each}
    </div>
  {/if}
</div>
