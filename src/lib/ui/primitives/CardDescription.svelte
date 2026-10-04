<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { cn } from '../cn'

  interface Props extends HTMLAttributes<HTMLParagraphElement> {
    children?: Snippet
  }

  let { class: cls, children, ...rest }: Props = $props()
</script>

<p
  class={cn('text-sm text-muted-foreground', cls)}
  {...rest}
>
  {#if children}{@render children()}{/if}
</p>
