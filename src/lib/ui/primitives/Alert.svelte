<script module lang="ts">
  import { variants, type VariantProps } from '../cn'

  export const alertVariants = variants(
    'relative flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-sm [&>svg]:mt-0.5 [&>svg]:shrink-0',
    {
      variant: {
        default: 'border-border bg-card text-card-foreground',
        info: 'border-info/40 bg-info/10 text-foreground [&>svg]:text-info',
        success: 'border-success/40 bg-success/10 text-foreground [&>svg]:text-success',
        warning: 'border-warning/40 bg-warning/10 text-foreground [&>svg]:text-warning',
        destructive:
          'border-destructive/40 bg-destructive/10 text-foreground [&>svg]:text-destructive',
      },
    },
    { variant: 'default' },
  )

  export interface AlertProps
    extends Record<string, unknown>,
      VariantProps<{
        variant: Record<'default' | 'info' | 'success' | 'warning' | 'destructive', string>
      }> {}
</script>

<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  interface ComponentProps extends HTMLAttributes<HTMLDivElement>, AlertProps {
    children?: Snippet
  }

  let {
    variant,
    class: cls,
    children,
    ...rest
  }: ComponentProps = $props()
</script>

<div
  role="alert"
  class={alertVariants({ variant, class: cls })}
  {...rest}
>
  {#if children}{@render children()}{/if}
</div>
