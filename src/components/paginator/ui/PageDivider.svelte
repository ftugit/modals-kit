<script lang="ts">
  import type { Snippet } from 'svelte'
  import { cn } from '#components/utils.js'

  interface Props {
    page: number
    count?: number | null
    /** Классы корневого элемента (через `cn` к базовым, как у `Acl`). */
    class?: string
    children?: Snippet<[{ page: number; count?: number | null }]>
  }

  let { page, count, class: className, children }: Props = $props()
</script>

<div
  data-testid={`page-divider-${page}`}
  class={cn('mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground', className)}
>
  <span class="h-px flex-1 bg-muted/70"></span>
  {#if children}
    {@render children({ page, count })}
  {:else}
    страница {page}{count != null ? ` (${count})` : ''}
  {/if}
  <span class="h-px flex-1 bg-muted/70"></span>
</div>
