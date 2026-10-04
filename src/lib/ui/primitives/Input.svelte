<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements'
  import { inputVariants } from './field'

  interface Props extends Omit<HTMLInputAttributes, 'size'> {
    size?: 'sm' | 'md' | 'lg'
  }

  let { size, class: cls, value = $bindable(), ...rest }: Props = $props()
</script>

<input
  bind:value
  class={inputVariants({ size, class: cls })}
  {...rest}
/>
