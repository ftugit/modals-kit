<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { cn } from '../cn'

  interface Props extends HTMLAttributes<HTMLDivElement> {
    side?: 'start' | 'end'
    interactive?: boolean
    children?: Snippet
  }

  let { side = 'end', interactive = false, class: cls, children, ...rest }: Props = $props()
</script>

<div
  data-affix={side}
  class={cn(
    'absolute inset-y-0 flex items-center justify-center text-muted-foreground',
    side === 'end' ? 'right-0' : 'left-0',
    interactive ? 'z-10' : 'pointer-events-none',
    cls,
  )}
  {...rest}
>
  {#if children}{@render children()}{/if}
</div>
