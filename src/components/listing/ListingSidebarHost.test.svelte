<script lang="ts">
  import { renderMergeSlot, setPageContext, type SidebarPlace } from '#components/shell/index.js'
  import type { PaginatorState } from '#lib/paginate/index.js'
  import Listing from './Listing.svelte'

  let {
    zone,
    snapshot,
  }: {
    zone?: SidebarPlace
    snapshot: PaginatorState<{ id: string }>
  } = $props()

  const page = setPageContext()
  const middle = $derived(renderMergeSlot(page.sidebar.middle))
</script>

{#snippet form()}
  <p data-testid="sidebar-filter-form">форма</p>
{/snippet}

{#snippet item(row: { id: string })}
  <span>{row.id}</span>
{/snippet}

<Listing
  name="probe-list"
  pageParam="probe"
  route="/probe"
  ariaLabel="probe"
  title="Probe"
  url={false}
  {item}
  rowAttrs={() => ({ href: '/probe/1' })}
  sidebar={zone}
  filtersForm={form}
  filters={{
    modal: 'probe.filters',
    path: '/probe/filters',
    keys: ['ord'],
    defaults: { ord: 'new' },
    pageSize: 20,
    testId: 'probe-filters',
  }}
  initial={{ snapshot, fact: null }}
/>

<div data-sidebar-probe="">
  {#each middle as entry (entry.id)}
    <div data-sidebar-offset={entry.offset ?? ''}>
      {@render entry.snippet()}
    </div>
  {/each}
</div>
