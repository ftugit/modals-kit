<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements'
  import { cn } from '../cn'

  const spinnerSize = {
    xs: 'h-3 w-3 border-2',
    sm: 'h-4 w-4 border-2',
    md: 'h-6 w-6 border-2',
    lg: 'h-10 w-10 border-[3px]',
  } as const

  interface Props extends HTMLAttributes<HTMLSpanElement> {
    size?: keyof typeof spinnerSize
  }

  let { size = 'md', class: cls, ...rest }: Props = $props()
</script>

<span
  role="status"
  aria-label="Загрузка"
  class={cn(
    'inline-block shrink-0 animate-spin rounded-full border-current border-r-transparent',
    spinnerSize[size],
    cls,
  )}
  {...rest}
></span>
