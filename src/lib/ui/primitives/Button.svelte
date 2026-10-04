<script module lang="ts">
  import { variants, type VariantProps } from '../cn'

  export const buttonVariants = variants(
    'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
    {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
        accent: 'bg-accent text-accent-foreground shadow-xs hover:bg-accent/80',
        destructive: 'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90',
        outline:
          'border border-input bg-background shadow-xs hover:bg-accent hover:text-accent-foreground',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-foreground underline-offset-4 hover:underline',
      },
      size: {
        xs: 'h-7 rounded-md px-2 text-xs',
        sm: 'h-8 px-3 text-sm',
        md: 'h-9 px-4 text-sm',
        lg: 'h-10 px-6 text-sm',
        icon: 'h-9 w-9',
        'icon-sm': 'h-8 w-8',
      },
    },
    { variant: 'default', size: 'md' },
  )

  export type ButtonVariants = VariantProps<{
    variant: Record<
      'default' | 'secondary' | 'accent' | 'destructive' | 'outline' | 'ghost' | 'link',
      string
    >
    size: Record<'xs' | 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm', string>
  }>
</script>

<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'

  interface Props extends HTMLButtonAttributes, ButtonVariants {
    children?: Snippet
  }

  let {
    variant,
    size,
    class: cls,
    type = 'button',
    children,
    ...rest
  }: Props = $props()
</script>

<button
  {type}
  class={buttonVariants({ variant, size, class: cls })}
  {...rest}
>
  {#if children}{@render children()}{/if}
</button>
