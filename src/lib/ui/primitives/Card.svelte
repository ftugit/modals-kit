<script lang="ts" module>
  import { variants, type VariantProps } from '../cn'

  export const cardVariants = variants(
    'rounded-xl border border-border bg-card text-card-foreground shadow-sm',
    {
      variant: {
        default: 'bg-card text-card-foreground',
        muted: 'border-muted bg-muted/50 text-foreground',
      },
    },
    {
      variant: 'default',
    },
  )

  export type CardVariants = VariantProps<typeof cardVariants>
</script>

<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { cn } from '../cn'

  interface Props extends HTMLAttributes<HTMLDivElement> {
    variant?: CardVariants['variant']
    children?: Snippet
  }

  let { variant = 'default', class: cls, children, ...rest }: Props = $props()
</script>

<div
  class={cn(cardVariants({ variant }), cls)}
  {...rest}
>
  {#if children}{@render children()}{/if}
</div>
