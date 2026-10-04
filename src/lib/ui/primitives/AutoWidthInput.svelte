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
    'field-autosize-inline w-auto self-start',
    cls,
  )}
  style={`--field-min-width: ${minChars}ch; ${typeof style === 'string' ? style : ''}`}
  {...rest}
/>
