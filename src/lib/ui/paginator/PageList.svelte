<script lang="ts" generics="T">
  import type { Snippet } from 'svelte'
  import { PageAnchor, usePaginatorPages } from '$lib/paginate/svelte'
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
  // Строка «загрузка» живёт ТОЛЬКО внутри pending-группы (как в исходнике SolidHono:
  // `PageList` → слоты скелетонов, иначе `renderPending`/дефолтная строка). Внешние
  // `pendingRow(side)` + `pendingAbove/Below` есть только у колоночной раскладки
  // (`layout.tsx:220`); здесь они добавляли вторую строку «Загрузка страницы N…» —
  // одна внутри группы, вторая рядом с ней.
</script>

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

