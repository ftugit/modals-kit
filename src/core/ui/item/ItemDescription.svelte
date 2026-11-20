<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { cn } from '#core/ui/utils.js'

  interface Props extends HTMLAttributes<HTMLElement> {
    as?: 'p' | 'div' | 'span'
    truncate?: boolean
    children?: Snippet
  }

  let { as = 'p', truncate = false, class: cls, children, ...rest }: Props = $props()
</script>

<svelte:element
  this={as}
  {...rest}
  class={cn('min-w-0 text-xs text-muted-foreground', truncate ? 'truncate' : 'break-words', cls)}
  data-slot="item-description"
>
  {#if children}{@render children()}{/if}
</svelte:element>
