<script module lang="ts">
  import { variants, type VariantProps } from '../cn'

  export const badgeVariants = variants(
    'inline-flex items-center gap-1 rounded-md border font-medium whitespace-nowrap transition-colors',
    {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        muted: 'border-transparent bg-muted text-muted-foreground',
        outline: 'border-border text-foreground',
        info: 'border-transparent bg-info text-info-foreground',
        success: 'border-transparent bg-success text-success-foreground',
        warning: 'border-transparent bg-warning text-warning-foreground',
        destructive: 'border-transparent bg-destructive text-destructive-foreground',
      },
      size: { sm: 'px-1.5 py-0.5 text-xs', md: 'px-2 py-0.5 text-xs', lg: 'px-2.5 py-1 text-sm' },
    },
    { variant: 'muted', size: 'md' },
  )

  export type BadgeVariants = VariantProps<{
    variant: Record<
      'default' | 'secondary' | 'muted' | 'outline' | 'info' | 'success' | 'warning' | 'destructive',
      string
    >
    size: Record<'sm' | 'md' | 'lg', string>
  }>
</script>

<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  interface Props extends HTMLAttributes<HTMLSpanElement>, BadgeVariants {
    children?: Snippet
  }

  let {
    variant,
    size,
    class: cls,
    children,
    ...rest
  }: Props = $props()
</script>

<span
  class={badgeVariants({ variant, size, class: cls })}
  {...rest}
>
  {#if children}{@render children()}{/if}
</span>
