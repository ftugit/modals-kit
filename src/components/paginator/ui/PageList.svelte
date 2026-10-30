<script lang="ts" generics="T">
  import { untrack } from 'svelte'
  import type { Snippet } from 'svelte'
  import { PageAnchor, usePaginatorPages } from '#lib/paginate/svelte/index.js'
  import type { PageSliceOptions } from '../types.js'
  import PageDivider from './PageDivider.svelte'
  import StatusRow from './StatusRow.svelte'

  interface Props<T> {
    name?: string
    class?: string
    itemClass?: string
    slice?: boolean | PageSliceOptions
    renderItem: Snippet<[T, { page: number; index: number }]>
    renderSkeleton?: Snippet<[{ page: number; index: number }]>
    renderPending?: Snippet<[{ page: number }]>
    renderDivider?: Snippet<[{ page: number; count: number | null }]> | null
  }

  let {
    name: nameProp,
    class: className,
    itemClass = 'mb-2',
    slice = true,
    renderItem,
    renderSkeleton,
    renderPending,
    renderDivider,
  }: Props<T> = $props()
  // Имя пагинатора — идентичность экземпляра: читается один раз при монтировании.
  // Другое имя = другой пагинатор; пересоздаёт компонент родитель (`{#key}`).
  const name = untrack(() => nameProp)

  const pagesGetter = usePaginatorPages<T>(name)
  const pages = $derived(pagesGetter())

  // Строки «загрузка страницы N» — ТОЛЬКО внутри pending-группы ниже (скелетоны,
  // renderPending или StatusRow): так же устроен исходник SolidHono
  // (`PageList`: `g.pending ? renderSkeleton ? слоты : pending() : items`).
  // Внешние пары `pendingSide(...)` над и под списком давали вторую такую же
  // строку — двойной счёт подгрузки; они есть только у колоночной раскладки.
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
            {name}
            page={group.page}
            count={group.pending ? null : group.items.length}
            {slice}
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
