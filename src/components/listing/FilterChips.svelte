<!--
  Активные фильтры списка — между поиском и пагинатором.
  Чип снимает значение. Метка открывает нарезанный блок, только если он
  смонтирован. Форма в закрытой модалке блока не держит: всплывашки нет,
  снятие остаётся.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { asLink } from '#hooks/links/index.js'
  import { listHref, setExtra, type Store } from '#lib/paginate/index.js'
  import { tryUseModals } from '#lib/modals/svelte/index.js'
  import FilterBlockPopup from '#components/paginator/filters/FilterBlockPopup.svelte'
  import {
    filterLists,
    reclaimFilterList,
    setFilterListOpen,
    setFilterListSlot,
  } from '#components/paginator/filters/filter-registry.svelte.js'
  import type { ActiveFilterItem } from './active-filters.js'

  interface Props {
    name: string
    items: readonly ActiveFilterItem[]
    store: Store
    from: string
    defaultPageSize: number
  }

  let { name, items, store, from, defaultPageSize }: Props = $props()

  const host = tryUseModals()
  let client = $state(false)
  let anchors = $state<Record<string, HTMLElement | undefined>>({})
  let popupNode = $state<HTMLElement | undefined>(undefined)

  const list = $derived(filterLists[name])
  const openKey = $derived(list?.openKey ?? null)
  const openEntry = $derived(openKey && list ? list.blocks[openKey] : undefined)

  onMount(() => {
    client = true
  })

  function remember(key: string) {
    return (el: HTMLElement) => {
      anchors[key] = el
      return () => {
        if (anchors[key] === el) anchors[key] = undefined
      }
    }
  }

  function close() {
    reclaimFilterList(name)
    setFilterListOpen(name, null)
  }

  function toggle(key: string) {
    const current = filterLists[name]
    if (!current?.blocks[key]) return
    if (current.openKey === key) {
      close()
      return
    }
    setFilterListOpen(name, key)
  }

  function hrefOf(item: ActiveFilterItem): string | null {
    if (item.kind === 'pageSize') return listHref(name, from, {}, defaultPageSize)
    return listHref(name, from, { [item.key]: undefined })
  }

  function remove(event: MouseEvent, item: ActiveFilterItem) {
    if (event.defaultPrevented) return
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    if (filterLists[name]?.openKey === item.key) close()
    if (item.kind === 'pageSize') {
      void setExtra(store, name, {}, { pageSize: defaultPageSize })
      return
    }
    void setExtra(store, name, { [item.key]: undefined })
  }

  function onSlot(slot: HTMLElement | null) {
    setFilterListSlot(name, slot)
  }
</script>

<div
  class="mb-3 flex min-w-0 flex-wrap items-center gap-1.5"
  data-testid="listing-active-filters"
  role="group"
  aria-label="Активные фильтры"
>
  {#each items as item (item.key)}
    {@const href = hrefOf(item)}
    {@const canOpen = Boolean(client && host && list?.blocks[item.key])}
    <span
      class="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted/60 px-2.5 py-0.5 text-xs font-medium"
      data-testid="listing-active-filter"
      data-filter-key={item.key}
    >
      {#if canOpen}
        <button
          type="button"
          class="font-medium underline-offset-4 hover:underline"
          data-filter-label={item.key}
          data-filter-label-popup="true"
          aria-expanded={openKey === item.key}
          aria-haspopup="dialog"
          aria-controls={openKey === item.key ? popupNode?.id : undefined}
          {@attach remember(item.key)}
          onclick={() => toggle(item.key)}
        >{item.label}</button>
      {:else}
        <span data-filter-label={item.key} data-filter-label-popup="false">{item.label}</span>
      {/if}
      {#if item.text}
        <span class="text-muted-foreground" aria-hidden="true">:</span>
        <span class="max-w-[16rem] truncate">{item.text}</span>
      {/if}
      {#if href}
        <a
          {...asLink(href)}
          class="text-muted-foreground hover:text-foreground"
          aria-label="Снять {item.label}"
          onclick={(event) => remove(event, item)}
        >
          <span aria-hidden="true">✕</span>
        </a>
      {:else}
        <button
          type="button"
          class="text-muted-foreground hover:text-foreground"
          aria-label="Снять {item.label}"
          onclick={(event) => remove(event, item)}
        >
          <span aria-hidden="true">✕</span>
        </button>
      {/if}
    </span>
  {/each}
</div>

{#if client && host && openEntry}
  <FilterBlockPopup
    entry={openEntry}
    anchor={anchors[openEntry.key]}
    onClose={close}
    {onSlot}
    reclaim={() => reclaimFilterList(name)}
    bind:container={popupNode}
  />
{/if}
