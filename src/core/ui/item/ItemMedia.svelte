<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { cn } from '#core/ui/utils.js'

  interface Props extends HTMLAttributes<HTMLSpanElement> {
    variant?: 'default' | 'muted'
    size?: 'sm' | 'md'
    children?: Snippet
  }

  let { variant = 'default', size = 'sm', class: cls, children, ...rest }: Props = $props()
</script>

<span
  {...rest}
  class={cn(
    'flex shrink-0 items-center justify-center overflow-hidden rounded-md',
    variant === 'default' ? 'bg-muted text-muted-foreground' : 'bg-muted/50',
    size === 'sm' ? 'size-9' : 'size-10',
    cls,
  )}
  data-slot="item-media"
>
  {#if children}{@render children()}{/if}
</span>
