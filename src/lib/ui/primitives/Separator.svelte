<script lang="ts" module>
  import { variants, type VariantProps } from '../cn'

  export const separatorVariants = variants(
    '',
    {
      orientation: {
        horizontal: 'my-4 flex items-center gap-3 text-xs text-muted-foreground',
        vertical: 'mx-2 w-px self-stretch bg-border',
      },
    },
    {
      orientation: 'horizontal',
    },
  )

  export type SeparatorVariants = VariantProps<typeof separatorVariants>
</script>

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
  class={cn(separatorVariants({ orientation }), cls)}
  {...rest}
>
  {#if vertical}
    <!-- vertical separator has no inner text -->
  {:else if children}
    <div class="h-px flex-1 bg-border"></div>
    <span>{@render children()}</span>
    <div class="h-px flex-1 bg-border"></div>
  {:else}
    <div class="h-px w-full bg-border"></div>
  {/if}
</div>
