<script lang="ts" generics="T">
  // Единый папочный компонент пагинатора: собирает `PaginatorHost`, сентинелы краёв,
  // `PageList` / `PageColumns`, статусы `aria-live`, обработку ошибок, навигацию и лог событий.
  import { EdgeSentinel, PaginatorHost } from '#lib/paginate/svelte/index.js'
  import { cn } from '#components/utils.js'
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
  import PageSlice from './ui/PageSlice.svelte'
  import ReplaceLoadingRow from './ui/ReplaceLoadingRow.svelte'
  import ResetButton from './ui/ResetButton.svelte'
  import { paginatorHostVariants } from './variants.js'

  let {
    name,
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
    slice = true,
    eventLog = false,
    variant = 'default',
    class: cls,
    onError,
    onColumns,
    toolbar,
    header,
    footer,
    beforeItems,
    afterItems,
    empty,
    loadMoreLabel,
    nav,
    itemsClass,
    itemsAttrs,
    itemClass,
    renderItem,
    renderSkeleton,
    renderPending,
    renderDivider,
  }: PaginatorProps<T> = $props()

  // Строки и пустое состояние — отдельный сниппет: он рисуется либо голым (как
  // раньше), либо внутри контейнера потребителя, когда тот заказал свой.
  const sliceObj = $derived(typeof slice === 'object' ? slice : undefined)
  const sliceDisabled = $derived(slice === false || sliceObj?.enable === false)
  const sliceFloating = $derived(
    !sliceDisabled && (sliceObj?.floating === 'top' || sliceObj?.floating === 'bottom')
      ? sliceObj.floating
      : false,
  )
  const listSlice = $derived(
    sliceDisabled || sliceFloating
      ? false
      : {
          ...sliceObj,
          enable: sliceObj?.enable ?? (mode === 'single' ? true : undefined),
        },
  )
</script>

{#snippet body()}
  {#if layout === 'columns'}
    {#if !sliceDisabled && !sliceFloating}
      <PageSlice
        firstPageOnly
        {...sliceObj}
        enable={sliceObj?.enable ?? true}
      />
    {/if}
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
    {#if renderDivider === null && !sliceDisabled && !sliceFloating}
      <PageSlice
        firstPageOnly={mode !== 'single'}
        {...sliceObj}
        enable={sliceObj?.enable ?? (mode === 'single' ? true : undefined)}
      />
    {/if}
    <PageList
      {name}
      slice={listSlice}
      {renderDivider}
      {renderSkeleton}
      {renderPending}
      {renderItem}
      {itemClass}
    />
  {/if}

  <!-- Пустое состояние — оболочка компонента: потребитель меняет только текст. -->
  {#if empty}
    <EmptyState {name}>{@render empty()}</EmptyState>
  {:else}
    <EmptyState {name} />
  {/if}
{/snippet}

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
    <!-- Строка вместо `true` — свой текст индикатора (дефолт «Загрузка…»). -->
    <LoadingIndicator {name} text={typeof showIndicator === 'string' ? showIndicator : undefined} />
  {/if}
  {#if sliceFloating === 'top'}
    <PageSlice firstPageOnly={false} {...sliceObj} floating="top" />
  {/if}
  {#if sentinel}
    <EdgeSentinel dir={-1} {name} />
    <LoadMoreLink dir={-1} {name}>
      {#snippet label(p)}{@render loadMoreLabel?.(p)}{/snippet}
    </LoadMoreLink>
  {/if}

  {#if header}
    {@render header()}
  {/if}

  {#if beforeItems || afterItems || itemsClass || itemsAttrs}
    <!--
      Контейнер строк — собственность потребителя: рамка, разделители, `data-testid`.
      Обёртка появляется только когда он её заказал, поэтому разметка прочих
      потребителей (`class` со скроллом на самом хосте) не меняется.
    -->
    <div class={cn('shrink-0', itemsClass)} {...itemsAttrs}>
      {@render beforeItems?.()}
      {@render body()}
      {@render afterItems?.()}
    </div>
  {:else}
    {@render body()}
  {/if}

  {#if footer}
    {@render footer()}
  {/if}

  <LiveStatus {name} />
  <ErrorRow {name} />
  {#if replaceLoading !== 'off'}
    <ReplaceLoadingRow {name} when={replaceLoading} />
  {/if}

  {#if sentinel}
    <LoadMoreLink dir={1} {name}>
      {#snippet label(p)}{@render loadMoreLabel?.(p)}{/snippet}
    </LoadMoreLink>
    <EdgeSentinel dir={1} {name} />
    <EndRow {name} />
  {/if}

  {#if sliceFloating === 'bottom'}
    <PageSlice firstPageOnly={false} {...sliceObj} floating="bottom" />
  {/if}

  {#if nav}
    {@render nav()}
  {:else if bottomNav}
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
