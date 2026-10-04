<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLLabelAttributes } from 'svelte/elements'
  import { cn } from '../cn'

  interface Props extends HTMLLabelAttributes {
    children?: Snippet
  }

  let { class: cls, children, ...rest }: Props = $props()
</script>

<label
  class={cn('text-sm font-medium leading-none text-foreground', cls)}
  {...rest}
>
  {#if children}{@render children()}{/if}
</label>
