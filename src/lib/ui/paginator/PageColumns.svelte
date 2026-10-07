<script lang="ts" generics="T">
  import { onMount, type Snippet } from 'svelte'
  import {
    computeColumns,
    distributeRoundRobin,
    pendingSide,
    runsOfColumn,
    type Stretch,
  } from '$lib/paginate'
  import {
    PageAnchor,
    usePaginatorActions,
    usePaginatorPages,
    usePaginatorState,
  } from '$lib/paginate/svelte'
  import StatusRow from './StatusRow.svelte'

  interface Props<T> {
    name?: string
    columns?: number | 'auto'
    columnWidth?: number
    stretch?: Stretch
    minColumns?: number
    maxColumns?: number
    gap?: number
    class?: string
    onColumns?: (n: number) => void
    renderItem: Snippet<[T, { page: number; index: number }]>
    renderSkeleton?: Snippet<[{ page: number; index: number }]>
    renderPending?: Snippet<[{ page: number }]>
    renderDivider?: Snippet<[{ page: number; count: number | null }]> | null
  }

  let {
    name,
    columns: columnsProp = 'auto',
    columnWidth = 220,
    stretch = '25%',
    minColumns,
    maxColumns,
    gap = 8,
    class: className = '',
    onColumns,
    renderItem,
    renderSkeleton,
    renderPending,
  }: Props<T> = $props()

  const pagesGetter = usePaginatorPages<T>(name)
  const pages = $derived(pagesGetter())
  const pagState = usePaginatorState<T>(name)
  const { scrollToPage } = usePaginatorActions(name)

  let containerEl: HTMLDivElement | undefined = $state()
  let colContainerWidth = $state(0)

  onMount(() => {
    if (columnsProp !== undefined && columnsProp !== 'auto') return
    const el = containerEl
    if (!el || typeof ResizeObserver === 'undefined') return
    colContainerWidth = el.clientWidth
    const ro = new ResizeObserver(() => {
      colContainerWidth = el.clientWidth
    })
    ro.observe(el)
    return () => ro.disconnect()
  })

  const auto = $derived.by(() =>
    computeColumns({
      width: colContainerWidth,
      columnWidth,
      gap,
      stretch,
      min: minColumns,
      max: maxColumns,
    })
  )

  const count = $derived.by(() => {
    if (typeof columnsProp === 'number') return Math.max(1, columnsProp)
    return colContainerWidth > 0 ? auto.count : 4
  })

  let prevCount: number | undefined = undefined
  $effect(() => {
    const c = count
    onColumns?.(c)
    if (prevCount !== undefined && prevCount !== c) {
      scrollToPage(pagState().page)
    }
    prevCount = c
  })

  // Слоты-скелетоны включаются РОВНО тогда, когда есть чем их рисовать
  // (канон: `distributeRoundRobin(pages, count, !!props.renderSkeleton)`).
  // С инверсией pending-страница давала ноль ячеек, и в раскладке «колонки»
  // подгрузка шла с пустым местом: скелетоны «не работали».
  const cols = $derived.by(() => distributeRoundRobin(pages, count, !!renderSkeleton))

  const firstIndexOf = $derived.by(() => {
    const m = new Map<number, number>()
    for (const col of cols) {
      for (const c of col) {
        if (!m.has(c.page) || c.index < m.get(c.page)!) {
          m.set(c.page, c.index)
        }
      }
    }
    return m
  })

  const runsByCol = $derived.by(() => {
    return cols.map((col) => runsOfColumn(col))
  })

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

  const colStyle = $derived.by(() => {
    if (typeof columnsProp === 'number' || colContainerWidth === 0) return 'flex: 1 1 0%;'
    const a = auto
    return a.fit === 'single'
      ? 'flex: 1 1 0%;'
      : `flex: 0 0 ${a.columnWidth}px; max-width: ${a.columnWidth}px;`
  })
</script>

{#if pendingAbove}
  {#if renderPending}
    {@render renderPending({ page: pendingAbove.page })}
  {:else}
    <StatusRow text={`Загрузка страницы ${pendingAbove.page}…`} />
  {/if}
{/if}

<div
  bind:this={containerEl}
  class={`flex items-start ${className}`}
  style={`gap: ${gap}px;`}
  data-pag-columns={count}
>
  {#each Array.from({ length: count }, (_, i) => i) as ci (ci)}
    <div
      class="flex flex-col"
      style={`${colStyle} gap: ${gap}px;`}
      data-testid={`masonry-col-${ci}`}
    >
      {#each runsByCol[ci] ?? [] as run, runIdx (run.page + '-' + runIdx)}
        <PageAnchor
          page={run.page}
          {name}
          class="flex flex-col"
          marker={run.cells[0]?.index === firstIndexOf.get(run.page)}
        >
          {#each run.cells as cell (cell.index)}
            <div style={`margin-bottom: ${gap}px;`}>
              {#if cell.item !== null}
                {@render renderItem(cell.item, { page: cell.page, index: cell.index })}
              {:else if renderSkeleton}
                {@render renderSkeleton({ page: cell.page, index: cell.index })}
              {/if}
            </div>
          {/each}
        </PageAnchor>
      {/each}
    </div>
  {/each}
</div>

{#if pendingBelow}
  {#if renderPending}
    {@render renderPending({ page: pendingBelow.page })}
  {:else}
    <StatusRow text={`Загрузка страницы ${pendingBelow.page}…`} />
  {/if}
{/if}
