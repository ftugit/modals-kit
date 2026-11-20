<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { cn } from '#core/ui/utils.js'

  interface Props extends HTMLAttributes<HTMLElement> {
    as?: 'div' | 'ul'
    gap?: 'sm' | 'md' | 'lg'
    children?: Snippet
  }

  let { as = 'div', gap = 'md', class: cls, children, ...rest }: Props = $props()

  const GAP = { sm: 'gap-1.5', md: 'gap-2', lg: 'gap-3' } as const
</script>

<svelte:element this={as} role={as === 'div' ? 'list' : undefined} class={cn('flex flex-col', GAP[gap], cls)} {...rest}>
  {#if children}{@render children()}{/if}
</svelte:element>
