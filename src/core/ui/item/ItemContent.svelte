<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { cn } from '#core/ui/utils.js'

  interface Props extends HTMLAttributes<HTMLDivElement> {
    children?: Snippet
  }

  let { class: cls, children, ...rest }: Props = $props()
</script>

<div {...rest} class={cn('flex min-w-0 flex-1 flex-col gap-1', cls)} data-slot="item-content">
  {#if children}{@render children()}{/if}
</div>
