<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { cn } from '#core/ui/utils.js'

  export type DescriptionListLayout = 'responsive' | 'inline' | 'stacked'
  export type DescriptionListVariant = 'default' | 'compact'

  interface Props extends HTMLAttributes<HTMLDListElement> {
    layout?: DescriptionListLayout
    variant?: DescriptionListVariant
    children?: Snippet
  }

  let { layout = 'responsive', variant = 'default', class: cls, children, ...rest }: Props = $props()

  const LAYOUT = {
    responsive: 'grid grid-cols-1 gap-y-1 sm:grid-cols-[auto_1fr]',
    inline: 'grid grid-cols-[auto_1fr] gap-y-1',
    stacked: 'grid grid-cols-1 gap-y-1',
  } as const
  const VARIANT = {
    default: 'gap-x-3 text-sm',
    compact: 'gap-x-2 gap-y-0.5 text-xs',
  } as const
</script>

<dl {...rest} class={cn('min-w-0', LAYOUT[layout], VARIANT[variant], cls)} data-slot="description-list" data-layout={layout} data-variant={variant}>
  {#if children}{@render children()}{/if}
</dl>
