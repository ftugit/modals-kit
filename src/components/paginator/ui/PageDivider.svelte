<script lang="ts">
  import { untrack } from 'svelte'
  import type { Snippet } from 'svelte'
  import { cn } from '#components/utils.js'
  import { getPaginatorContext } from '#lib/paginate/svelte/index.js'
  import type { PageSliceOptions } from '../types.js'
  import PageSlice from './PageSlice.svelte'

  interface Props {
    name?: string
    page: number
    count?: number | null
    /** Настройки плашки среза (`false` — не показывать плашку). */
    slice?: boolean | PageSliceOptions
    /** Классы корневого элемента (через `cn` к базовым, как у `Acl`). */
    class?: string
    children?: Snippet<[{ page: number; count?: number | null }]>
  }

  let { name: nameProp, page, count, slice = true, class: className, children }: Props = $props()
  const rawName = untrack(() => nameProp)
  const hostCtx = getPaginatorContext()
  const hasPaginator = Boolean(hostCtx || rawName)
  // Если мы уже внутри целевого PaginatorHost, не передаём явный id в PageSlice,
  // чтобы родитель определялся контекстом.
  const sliceName = hostCtx && (!rawName || hostCtx.name === rawName) ? undefined : rawName
  const sliceOpts = $derived(typeof slice === 'object' ? slice : undefined)
</script>

{#if page === 1 && !children}
  {#if hasPaginator && slice !== false}
    <PageSlice
      name={sliceName}
      page={1}
      firstPageOnly
      dividerLines
      {...sliceOpts}
      class={cn(className, sliceOpts?.class)}
    />
  {/if}
{:else}
  {#if hasPaginator && slice !== false && !children}
    <PageSlice
      name={sliceName}
      {page}
      firstPageOnly
      dividerLines
      {...sliceOpts}
    />
  {/if}
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
{/if}
