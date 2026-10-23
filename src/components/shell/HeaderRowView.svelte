<script lang="ts">
  // Отображение одного ряда шапки (start / center / end)
  import type { Snippet } from 'svelte'
  import type { RowSlots } from './page.svelte'

  interface Props {
    slots: RowSlots
    leading?: Snippet
    class?: string
  }

  let { slots, leading, class: className = '' }: Props = $props()
</script>

<div
  class={`mx-auto flex w-full max-w-5xl flex-wrap items-center gap-y-1 px-4 ${className}`}
>
  <!-- START -->
  {#if leading || (slots.start && slots.start.length > 0)}
    <div
      class="flex min-w-0 items-center gap-2 overflow-x-auto [scrollbar-width:none]"
    >
      {#if leading}
        {@render leading()}
      {/if}
      {#if slots.start}
        {#each slots.start as item (item.id)}
          {@render item.snippet()}
        {/each}
      {/if}
    </div>
  {/if}

  <!-- CENTER -->
  {#if slots.center && slots.center.length > 0}
    <div
      class="flex min-w-0 flex-1 items-center justify-start gap-2 overflow-x-auto px-3 [scrollbar-width:none]"
    >
      {#each slots.center as item (item.id)}
        {@render item.snippet()}
      {/each}
    </div>
  {/if}

  <!-- END -->
  {#if slots.end && slots.end.length > 0}
    <div
      class="ml-auto flex min-w-0 items-center gap-1 overflow-x-auto whitespace-nowrap sm:gap-1.5 [scrollbar-width:none]"
    >
      {#each slots.end as item (item.id)}
        {@render item.snippet()}
      {/each}
    </div>
  {/if}
</div>
