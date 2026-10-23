<script lang="ts" module>
  import { variants, type VariantProps } from '../../../utils'

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
  import { cn } from '../../../utils'

  interface Props extends HTMLAttributes<HTMLSpanElement> {
    size?: SpinnerVariants['size'] | number
  }

  let { size = 'md', style, class: cls, ...rest }: Props = $props()

  const inlineStyle = $derived(
    typeof size === 'number'
      ? `width: ${size}px; height: ${size}px;${typeof style === 'string' && style ? ` ${style}` : ''}`
      : style,
  )
</script>

<span
  role="status"
  aria-label="Загрузка"
  class={cn(spinnerVariants({ size: typeof size === 'number' ? 'sm' : size }), cls)}
  style={inlineStyle}
  {...rest}
>
  <span class="sr-only">Загрузка...</span>
</span>
