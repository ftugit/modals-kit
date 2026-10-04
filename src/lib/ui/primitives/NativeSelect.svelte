<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLSelectAttributes } from 'svelte/elements'
  import { cn } from '../cn'
  import { inputVariants } from './field'

  interface Props extends Omit<HTMLSelectAttributes, 'size'> {
    size?: 'sm' | 'md' | 'lg'
    children?: Snippet
  }

  let { size, class: cls, value = $bindable(), children, ...rest }: Props = $props()
</script>

<select
  bind:value
  class={inputVariants({ size, class: cn('pr-8', cls) })}
  {...rest}
>
  {#if children}{@render children()}{/if}
</select>
