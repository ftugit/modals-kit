<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { cn } from '../cn'

  interface Props extends HTMLAttributes<HTMLDivElement> {
    orientation?: 'horizontal' | 'vertical'
    children?: Snippet
  }

  let { orientation = 'horizontal', class: cls, children, ...rest }: Props = $props()
  let vertical = $derived(orientation === 'vertical')
</script>

<div
  role="separator"
  aria-orientation={vertical ? 'vertical' : undefined}
  class={cn(
    vertical
      ? 'mx-2 w-px self-stretch bg-border'
      : 'my-4 flex items-center gap-3 text-xs text-muted-foreground',
    cls,
  )}
  {...rest}
>
  {#if !vertical}
    <span class="h-px flex-1 bg-border"></span>
    {#if children}
      <span>{@render children()}</span>
      <span class="h-px flex-1 bg-border"></span>
    {/if}
  {/if}
</div>
