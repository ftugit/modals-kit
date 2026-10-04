<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { cn } from '../cn'

  interface Props extends HTMLAttributes<HTMLDivElement> {
    children?: Snippet
  }

  let { class: cls, children, ...rest }: Props = $props()
</script>

<div
  class={cn('relative flex min-w-0 items-center', cls)}
  {...rest}
>
  {#if children}{@render children()}{/if}
</div>
