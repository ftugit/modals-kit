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
  class={cn('rounded-xl border border-border bg-card text-card-foreground shadow-sm', cls)}
  {...rest}
>
  {#if children}{@render children()}{/if}
</div>
