<script lang="ts" module>
  import { variants, type VariantProps } from '../cn'

  export const spinnerVariants = variants(
    'inline-block shrink-0 animate-spin rounded-full border-current border-r-transparent',
    {
      size: {
        xs: 'h-3 w-3 border-2',
        sm: 'h-4 w-4 border-2',
        md: 'h-6 w-6 border-2',
        lg: 'h-10 w-10 border-[3px]',
      },
    },
    {
      size: 'md',
    },
  )

  export type SpinnerVariants = VariantProps<typeof spinnerVariants>
</script>

<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements'
  import { cn } from '../cn'

  interface Props extends HTMLAttributes<HTMLSpanElement> {
    size?: SpinnerVariants['size']
  }

  let { size = 'md', class: cls, ...rest }: Props = $props()
</script>

<span
  role="status"
  aria-label="Загрузка"
  class={cn(spinnerVariants({ size }), cls)}
  {...rest}
>
  <span class="sr-only">Загрузка...</span>
</span>
