<script lang="ts">
  import type { Snippet } from 'svelte'
  import { cn } from '#components/utils.js'

  interface Props {
    text: string
    testid?: string
    /** Классы корневого элемента (через `cn` к базовым, как у `Acl`). */
    class?: string
    children?: Snippet
  }

  let { text, testid, class: className, children }: Props = $props()
</script>

<div
  data-testid={testid}
  class={cn('flex items-center justify-center gap-2 py-2 text-center text-xs text-muted-foreground', className)}
>
  {text}
  {#if children}
    {@render children()}
  {/if}
</div>
