<!--
  Пункты меток схемы. Текст — подпись поля схемы, не подпись контрола формы.
  Блок есть и есть хост — пункт открывает его. Иначе пункт остаётся текстом:
  всплывашки нет. Без JavaScript все пункты — текст, форма в панели работает сама.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { tryUseModals } from '#lib/modals/svelte/index.js'
  import FilterBlockPopup from './FilterBlockPopup.svelte'
  import { useFilterBlocks } from './filter-blocks.svelte.js'

  const ctx = useFilterBlocks()
  const host = tryUseModals()

  let client = $state(false)
  let anchors = $state<Record<string, HTMLElement | undefined>>({})
  let popupNode = $state<HTMLElement | undefined>(undefined)

  const fields = $derived(ctx?.schema.fields ?? [])
  const openKey = $derived(ctx?.openKey ?? null)
  const openEntry = $derived(openKey && ctx ? ctx.blocks[openKey] : undefined)

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
    if (!ctx) return
    ctx.reclaim()
    ctx.setOpen(null)
  }

  function toggle(key: string) {
    if (!ctx) return
    if (ctx.openKey === key) {
      close()
      return
    }
    ctx.setOpen(key)
  }

  function onSlot(slot: HTMLElement | null) {
    ctx?.setSlot(slot)
  }
</script>

<div
  class="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm"
  data-testid="filter-labels"
  role="group"
  aria-label="Метки фильтров"
>
  {#each fields as field (field.key)}
    {@const cut = client && host && ctx?.blocks[field.key]}
    {#if cut}
      <button
        type="button"
        class="font-medium underline-offset-4 hover:underline"
        data-filter-label={field.key}
        data-filter-label-popup="true"
        aria-expanded={openKey === field.key}
        aria-haspopup="dialog"
        aria-controls={openKey === field.key ? popupNode?.id : undefined}
        {@attach remember(field.key)}
        onclick={() => toggle(field.key)}
      >{field.label}</button>
    {:else}
      <span class="text-muted-foreground" data-filter-label={field.key} data-filter-label-popup="false">{field.label}</span>
    {/if}
  {/each}
</div>

{#if client && host && openEntry}
  <FilterBlockPopup
    entry={openEntry}
    anchor={anchors[openEntry.key]}
    onClose={close}
    {onSlot}
    reclaim={() => ctx?.reclaim()}
    bind:container={popupNode}
  />
{/if}
