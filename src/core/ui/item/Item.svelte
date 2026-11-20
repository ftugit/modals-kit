<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { cn } from '#core/ui/utils.js'

  type ItemVariant = 'default' | 'outline' | 'muted'
  type ItemSize = 'sm' | 'md' | 'lg'

  interface Props extends HTMLAttributes<HTMLElement> {
    as?: 'div' | 'li' | 'article'
    variant?: ItemVariant
    size?: ItemSize
    interactive?: boolean
    selected?: boolean
    children?: Snippet
  }

  let {
    as = 'div',
    variant = 'outline',
    size = 'sm',
    interactive = false,
    selected = false,
    class: cls,
    children,
    ...rest
  }: Props = $props()

  const VARIANT = {
    default: 'bg-transparent',
    outline: 'rounded-lg border border-border bg-card',
    muted: 'rounded-lg border border-border bg-muted/30',
  } as const
  const SIZE = { sm: 'px-3 py-2 text-sm', md: 'p-3 text-sm', lg: 'p-4 text-sm' } as const
</script>

<svelte:element
  this={as}
  role={as === 'li' ? undefined : 'listitem'}
  aria-selected={selected ? 'true' : undefined}
  class={cn(
    'flex min-w-0 flex-wrap items-center gap-3 text-card-foreground',
    VARIANT[variant],
    SIZE[size],
    interactive && 'transition-colors hover:bg-muted/50',
    selected && 'border-primary bg-accent/40',
    cls,
  )}
  data-slot="item"
  data-variant={variant}
  {...rest}
>
  {#if children}{@render children()}{/if}
</svelte:element>
