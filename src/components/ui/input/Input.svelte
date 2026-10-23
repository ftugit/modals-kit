<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements'
  import { cn } from '#components/utils.js'
  import { AUTO_WIDTH_CLASS, inputVariants } from '../field/field'

  interface Props extends Omit<HTMLInputAttributes, 'size'> {
    size?: 'sm' | 'md' | 'lg'
    /** Ширина по тексту вместо всей строки. */
    autoWidth?: boolean
    /** Наименьшая ширина при `autoWidth`, в символах. */
    minChars?: number
    /**
     * Forwarded ref: узел <input> в руки потребителю (фокус, выделение,
     * слушатели формы) — сборные поля (`password/`, `copy-input/`) рендерят
     * этот примитив, как `HoldButton` рендерит `Button`.
     */
    ref?: (el: HTMLInputElement | null) => void
  }

  let { size, autoWidth = false, minChars = 8, class: cls, style, value = $bindable(), ref, ...rest }: Props = $props()

  let self = $state<HTMLInputElement | null>(null)
  // ref — эффект: потребителю нужен именно элемент (см. Button).
  $effect(() => ref?.(self))
</script>

<input
  bind:this={self}
  bind:value
  class={inputVariants({ size, class: cn(autoWidth && [AUTO_WIDTH_CLASS, 'min-w-[var(--field-min-width)]'], cls) })}
  style={autoWidth ? `--field-min-width: ${minChars}ch;${style ? ` ${style}` : ''}` : style}
  {...rest}
/>
