<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements'
  import { cn } from '../cn'

  interface Props extends HTMLInputAttributes {
    minChars?: number
  }

  let { minChars = 8, class: cls, style = '', value = $bindable(), ...rest }: Props = $props()
</script>

<input
  bind:value
  class={cn(
    'rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30',
    // Бывший `.field-autosize-inline`: ширина по содержимому.
    'field-sizing-content w-auto self-start min-w-[var(--field-min-width,8ch)] max-w-full transition-[width] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:duration-[1ms]',
    cls,
  )}
  style={`--field-min-width: ${minChars}ch; ${typeof style === 'string' ? style : ''}`}
  {...rest}
/>
