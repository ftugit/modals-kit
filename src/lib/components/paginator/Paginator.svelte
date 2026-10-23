<script lang="ts" generics="T">
  // Единый папочный компонент пагинатора: собирает `PaginatorHost`, сентинелы краёв,
  // `PageList` / `PageColumns`, статусы `aria-live`, обработку ошибок, навигацию и лог событий.
  import { untrack } from 'svelte'
  import { EdgeSentinel, PaginatorHost } from '#lib/paginate/svelte/index.js'
  import { cn } from '../../utils'
  import type { PaginatorProps } from './types.js'
  import EmptyState from './ui/EmptyState.svelte'
  import EndRow from './ui/EndRow.svelte'
  import ErrorRow from './ui/ErrorRow.svelte'
  import EventLog from './ui/EventLog.svelte'
  import LiveStatus from './ui/LiveStatus.svelte'
  import LoadMoreLink from './ui/LoadMoreLink.svelte'
  import LoadingIndicator from './ui/LoadingIndicator.svelte'
  import PageColumns from './ui/PageColumns.svelte'
  import PageList from './ui/PageList.svelte'
  import PageNav from './ui/PageNav.svelte'
  import ReplaceLoadingRow from './ui/ReplaceLoadingRow.svelte'
  import ResetButton from './ui/ResetButton.svelte'
  import { paginatorHostVariants } from './variants.js'

  let {
    name: nameProp,
    ariaLabel,
    snapshot = null,
    externalPage,
    externalRestorable,
    currentSearch,
    layout = 'list',
    mode = 'accumulate',
    columns = 'auto',
    columnWidth = 220,
    stretch = '25%',
    minColumns,
    maxColumns,
    gap = 8,
    topTrigger,
    bottomTrigger,
    topZone,
    bottomZone,
    prependBehavior,
    hashAnchor,
    showIndicator = true,
    sentinel = true,
    replaceLoading = true,
    bottomNav = true,
    eventLog = false,
    variant = 'default',
    class: cls,
    onError,
    onColumns,
    toolbar,
    renderItem,
    renderSkeleton,
    renderPending,
    renderDivider,
  }: PaginatorProps<T> = $props()

  const name = untrack(() => nameProp)
</script>

<PaginatorHost
  {name}
  {ariaLabel}
  {snapshot}
  {externalPage}
  {externalRestorable}
  {currentSearch}
  {mode}
  {topTrigger}
  {bottomTrigger}
  {topZone}
  {bottomZone}
  {prependBehavior}
  {hashAnchor}
  {onError}
  class={cn(paginatorHostVariants({ variant }), cls)}
  {toolbar}
>
  {#if showIndicator}
    <LoadingIndicator {name} />
  {/if}
  {#if sentinel}
    <EdgeSentinel dir={-1} {name} />
    <LoadMoreLink dir={-1} {name} />
  {/if}

  <EmptyState {name} />

  {#if layout === 'columns'}
    <PageColumns
      {name}
      {columns}
      {columnWidth}
      {stretch}
      {minColumns}
      {maxColumns}
      {gap}
      {onColumns}
      {renderDivider}
      {renderSkeleton}
      {renderPending}
      {renderItem}
    />
  {:else}
    <PageList
      {name}
      {renderDivider}
      {renderSkeleton}
      {renderPending}
      {renderItem}
    />
  {/if}

  <LiveStatus {name} />
  <ErrorRow {name} />
  {#if replaceLoading !== 'off'}
    <ReplaceLoadingRow {name} when={replaceLoading} />
  {/if}

  {#if sentinel}
    <LoadMoreLink dir={1} {name} />
    <EdgeSentinel dir={1} {name} />
    <EndRow {name} />
  {/if}

  {#if bottomNav}
    <PageNav {name}>
      {#snippet children()}
        <ResetButton {name} />
      {/snippet}
    </PageNav>
  {/if}

  {#if eventLog}
    <EventLog {name} />
  {/if}
</PaginatorHost>
