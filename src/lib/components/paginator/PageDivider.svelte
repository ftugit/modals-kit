<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    page: number
    count?: number | null
    children?: Snippet<[{ page: number; count?: number | null }]>
  }

  let { page, count, children }: Props = $props()
</script>

<div
  data-testid={`page-divider-${page}`}
  class="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground"
>
  <span class="h-px flex-1 bg-muted/70"></span>
  {#if children}
    {@render children({ page, count })}
  {:else}
    страница {page}{count != null ? ` (${count})` : ''}
  {/if}
  <span class="h-px flex-1 bg-muted/70"></span>
</div>
