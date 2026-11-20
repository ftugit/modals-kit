<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { cn } from '#core/ui/utils.js'

  interface Props extends HTMLAttributes<HTMLElement> {
    as?: 'div' | 'span' | 'h3'
    truncate?: boolean
    children?: Snippet
  }

  let { as = 'div', truncate = false, class: cls, children, ...rest }: Props = $props()
</script>

<svelte:element
  this={as}
  {...rest}
  class={cn('min-w-0 text-sm font-medium leading-snug', truncate && 'truncate', cls)}
  data-slot="item-title"
>
  {#if children}{@render children()}{/if}
</svelte:element>
