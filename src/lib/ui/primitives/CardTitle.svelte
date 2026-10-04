<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { cn } from '../cn'

  interface Props extends HTMLAttributes<HTMLHeadingElement> {
    children?: Snippet
  }

  let { class: cls, children, ...rest }: Props = $props()
</script>

<h3
  class={cn('text-lg font-semibold leading-tight tracking-tight', cls)}
  {...rest}
>
  {#if children}{@render children()}{/if}
</h3>
