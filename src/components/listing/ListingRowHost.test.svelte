<!--
  Хост для проверки контракта строки: `Listing` отдаёт строку сниппетом и не
  навязывает элемент. `mode='image'` рисует строку картинкой — если оболочка
  где-то внутри всё же обернёт её ссылкой, тест это увидит.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { PaginatorState } from '#lib/paginate/index.js'
  import Listing from './Listing.svelte'
  import ListingRow from './ListingRow.svelte'

  let {
    snapshot,
    mode = 'link',
  }: {
    snapshot: PaginatorState<{ id: string }>
    mode?: 'link' | 'image'
  } = $props()
</script>

{#snippet rowLink(item: { id: string }, ctx: { selected: boolean; index: number })}
  <ListingRow attrs={{ href: `/probe/${item.id}` }} id={item.id} testId="probe-row" selected={ctx.selected}>
    <span>строка {item.id} / {ctx.index}</span>
  </ListingRow>
{/snippet}

{#snippet rowImage(item: { id: string }, ctx: { selected: boolean; index: number })}
  <img
    src={`/pic/${item.id}.png`}
    alt=""
    data-testid="probe-image"
    data-id={item.id}
    data-index={ctx.index}
    data-selected={ctx.selected || undefined}
  />
{/snippet}

<Listing
  name="probe-list"
  pageParam="probe"
  route="/probe"
  ariaLabel="probe"
  title="Probe"
  url={false}
  row={mode === 'image' ? rowImage : rowLink}
  isSelected={(id) => id === 'r2'}
  initial={{ snapshot, fact: null }}
/>
