<script lang="ts" generics="T">
  import type { Snippet } from 'svelte'
  import { pendingSide } from '$lib/paginate'
  import {
    PageAnchor,
    usePaginatorPages,
    usePaginatorState,
  } from '$lib/paginate/svelte'
  import PageDivider from './PageDivider.svelte'
  import StatusRow from './StatusRow.svelte'

  interface Props<T> {
    name?: string
    class?: string
    itemClass?: string
    renderItem: Snippet<[T, { page: number; index: number }]>
    renderSkeleton?: Snippet<[{ page: number; index: number }]>
    renderPending?: Snippet<[{ page: number }]>
    renderDivider?: Snippet<[{ page: number; count: number | null }]> | null
  }

  let {
    name,
    class: className,
    itemClass = 'mb-2',
    renderItem,
    renderSkeleton,
    renderPending,
    renderDivider,
  }: Props<T> = $props()

  const pagesGetter = usePaginatorPages<T>(name)
  const pages = $derived(pagesGetter())
  const pagState = usePaginatorState<T>(name)

  const pendingAbove = $derived.by(() => {
    if (renderSkeleton) return null
    const p = pendingSide(pages)
    return p && p.side === 'above' ? p : null
  })

  const pendingBelow = $derived.by(() => {
    if (renderSkeleton) return null
    const p = pendingSide(pages)
    return p && p.side === 'below' ? p : null
  })
</script>

{#if pendingAbove}
  {#if renderPending}
    {@render renderPending({ page: pendingAbove.page })}
  {:else}
    <StatusRow text={`Загрузка страницы ${pendingAbove.page}…`} />
  {/if}
{/if}

<div class={className}>
  {#each pages as group (group.page)}
    <PageAnchor page={group.page} {name}>
      {#if renderDivider !== null}
        {#if renderDivider}
          {@render renderDivider({
            page: group.page,
            count: group.pending ? null : group.items.length,
          })}
        {:else}
          <PageDivider
            page={group.page}
            count={group.pending ? null : group.items.length}
          />
        {/if}
      {/if}

      {#if group.pending}
        {#if renderSkeleton}
          {#each Array.from({ length: group.slots }, (_, i) => i) as idx (idx)}
            <div class={itemClass}>
              {@render renderSkeleton({ page: group.page, index: idx })}
            </div>
          {/each}
        {:else if renderPending}
          {@render renderPending({ page: group.page })}
        {:else}
          <StatusRow text={`Загрузка страницы ${group.page}…`} />
        {/if}
      {:else}
        {#each group.items as item, itemIdx (itemIdx)}
          <div class={itemClass}>
            {@render renderItem(item, { page: group.page, index: itemIdx })}
          </div>
        {/each}
      {/if}
    </PageAnchor>
  {/each}
</div>

{#if pendingBelow}
  {#if renderPending}
    {@render renderPending({ page: pendingBelow.page })}
  {:else}
    <StatusRow text={`Загрузка страницы ${pendingBelow.page}…`} />
  {/if}
{/if}
