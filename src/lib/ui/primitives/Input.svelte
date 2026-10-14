<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements'
  import { cn } from '../cn'
  import { AUTO_WIDTH_CLASS, inputVariants } from './field'

  interface Props extends Omit<HTMLInputAttributes, 'size'> {
    size?: 'sm' | 'md' | 'lg'
    /** Ширина по тексту вместо всей строки. */
    autoWidth?: boolean
    /** Наименьшая ширина при `autoWidth`, в символах. */
    minChars?: number
  }

  let { size, autoWidth = false, minChars = 8, class: cls, style, value = $bindable(), ...rest }: Props = $props()
</script>

<input
  bind:value
  class={inputVariants({ size, class: cn(autoWidth && [AUTO_WIDTH_CLASS, 'min-w-[var(--field-min-width)]'], cls) })}
  style={autoWidth ? `--field-min-width: ${minChars}ch;${style ? ` ${style}` : ''}` : style}
  {...rest}
/>
