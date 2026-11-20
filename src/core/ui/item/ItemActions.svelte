<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { cn } from '#core/ui/utils.js'

  interface Props extends HTMLAttributes<HTMLDivElement> {
    align?: 'start' | 'end'
    children?: Snippet
  }

  let { align = 'end', class: cls, children, ...rest }: Props = $props()
</script>

<div
  {...rest}
  class={cn('flex shrink-0 items-center gap-1.5', align === 'end' && 'ml-auto', cls)}
  data-slot="item-actions"
>
  {#if children}{@render children()}{/if}
</div>
