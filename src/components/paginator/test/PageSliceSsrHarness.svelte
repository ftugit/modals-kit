<script lang="ts">
  import type { PaginatorState, Store } from '#lib/paginate/index.js'
  import { PaginatorHost, PaginatorScope } from '#lib/paginate/svelte/index.js'
  import type { PageSliceFloating } from '../types.js'
  import PageDivider from '../ui/PageDivider.svelte'
  import PageSlice from '../ui/PageSlice.svelte'

  interface Props {
    store: Store
    name: string
    snapshot: PaginatorState<unknown>
    mode: 'inside' | 'outside' | 'dividers'
    floating?: PageSliceFloating
    jsOnly?: boolean
    now?: number
    sliceClass?: string
  }

  let {
    store,
    name,
    snapshot,
    mode,
    floating = false,
    jsOnly = false,
    now,
    sliceClass,
  }: Props = $props()
</script>

<PaginatorScope {store}>
  {#if mode === 'outside'}
    <PageSlice {name} {floating} {jsOnly} {now} class={sliceClass} />
  {/if}
  <PaginatorHost {name} ariaLabel="Тест среза" {snapshot}>
    {#if mode === 'inside'}
      <PageSlice {floating} {jsOnly} {now} class={sliceClass} />
    {:else if mode === 'dividers'}
      <PageDivider page={1} count={5} slice={{ class: sliceClass }} />
      {#if now !== undefined}
        <!-- Детерминированный прогон со временем now -->
        <PageSlice page={1} firstPageOnly {now} />
      {/if}
      <PageDivider page={2} count={5} />
    {/if}
  </PaginatorHost>
</PaginatorScope>
