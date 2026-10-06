<script lang="ts" module>
  import { variants, type VariantProps } from '../cn'

  export const skeletonVariants = variants(
    'animate-pulse rounded-md bg-muted',
    {
      variant: {
        default: 'bg-muted',
        card: 'h-24 w-full rounded-lg',
        line: 'h-4 w-full rounded',
        circle: 'rounded-full',
      },
    },
    {
      variant: 'default',
    },
  )

  export type SkeletonVariants = VariantProps<typeof skeletonVariants>
</script>

<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements'
  import { cn } from '../cn'

  interface Props extends HTMLAttributes<HTMLDivElement> {
    variant?: SkeletonVariants['variant']
  }

  let { variant = 'default', class: cls, ...rest }: Props = $props()
</script>

<div
  aria-hidden="true"
  class={cn(skeletonVariants({ variant }), cls)}
  {...rest}
></div>
