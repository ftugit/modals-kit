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
  role="group"
  class={cn(
    'inline-flex items-stretch',
    '[&>*:not(:first-child)]:rounded-l-none [&>*:not(:last-child)]:rounded-r-none',
    '[&>*:not(:first-child)]:-ml-px',
    '[&>*]:focus-visible:relative [&>*]:focus-visible:z-10',
    cls,
  )}
  {...rest}
>
  {#if children}{@render children()}{/if}
</div>
