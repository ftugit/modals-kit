<script lang="ts">
  import { onMount } from 'svelte'
  import { tryUseModals } from '#lib/modals/svelte/index.js'
  import { Button } from '#components/ui/index.js'
  import { asLink } from '#hooks/links/index.js'
  import FilterBlockPopup from './FilterBlockPopup.svelte'
  import { useFilterBlocks } from './filter-blocks.svelte.js'
  import type { CatalogFilterChip } from '#lib/paginate/filters/index.js'

  interface Props {
    chips: readonly CatalogFilterChip[]
    count?: number
    onRemove?: (chip: CatalogFilterChip) => boolean | void
    /** Прямой commit черновика формы (валидация + применение) при автопримене. */
    onCommitDraft?: (form: HTMLFormElement) => void
    class?: string
  }

  let { chips, count, onRemove, onCommitDraft, class: cls = '' }: Props = $props()

  const ctx = useFilterBlocks()
  const host = tryUseModals()

  let client = $state(false)
  let anchors = $state<Record<string, HTMLElement | undefined>>({})
  let popupNode = $state<HTMLElement | undefined>(undefined)
  let openSnapshot = $state<string | null>(null)

  onMount(() => {
    client = true
  })

  const openKey = $derived(ctx?.openKey ?? null)

  function remember(key: string) {
    return (el: HTMLElement) => {
      anchors[key] = el
      return () => {
        if (anchors[key] === el) anchors[key] = undefined
      }
    }
  }

  function serializeForm(form: HTMLFormElement): string {
    const fd = new FormData(form)
    const parts: string[] = []
    for (const [k, v] of fd.entries()) {
      parts.push(`${k}=${String(v)}`)
    }
    parts.sort()
    return parts.join('&')
  }

  // Снимок значений формы при открытии popup: чтобы применять только при изменении.
  $effect(() => {
    const k = openKey
    if (!k || !ctx) {
      openSnapshot = null
      return
    }
    queueMicrotask(() => {
      const entry = ctx.blocks[k]
      // `home` остаётся в форме даже после переноса блока во всплывашку.
      const form = entry?.home?.closest('form') ?? document.querySelector('[data-testid="catalog-filter-form"]')
      if (form) openSnapshot = serializeForm(form)
    })
  })

  function close() {
    if (!ctx) return
    const key = ctx.openKey
    // Применить только если черновик изменился (валидация пройдёт через submit).
    if (key) {
      const entry = ctx.blocks[key]
      const form = entry?.home?.closest('form') ?? document.querySelector('[data-testid="catalog-filter-form"]')
      if (form && openSnapshot !== null) {
        const now = serializeForm(form)
        if (now !== openSnapshot) {
          try {
            if (onCommitDraft) {
              const f = form
              setTimeout(() => onCommitDraft(f), 0)
            } else {
              form.requestSubmit()
            }
          } catch (e) {
            // noop
          }
        }
      }
    }
    ctx.reclaim()
    ctx.setOpen(null)
    openSnapshot = null
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

  /** Группировка чипов по полю (срезу). */
  const groups = $derived.by(() => {
    const map = new Map<string, CatalogFilterChip[]>()
    for (const chip of chips) {
      if (!map.has(chip.key)) map.set(chip.key, [])
      map.get(chip.key)!.push(chip)
    }
    return [...map.entries()]
  })

  function hasBlock(key: string): boolean {
    return Boolean(client && host && ctx?.blocks[key])
  }

  /** Перечисление значений с заменой последней запятой на союз. */
  function joinEnum(items: string[], connector: string): string {
    if (items.length <= 1) return items.join('')
    if (items.length === 2) return items.join(` ${connector} `)
    return items.slice(0, -1).join(', ') + ` ${connector} ` + items[items.length - 1]
  }

  /** Объединённая подпись поля (среза) со всеми его значениями. */
  function combinedLabel(key: string, group: CatalogFilterChip[]): string {
    const fieldLabel = group[0]?.fieldLabel ?? key

    // Числовые границы (min/max).
    const minChip = group.find((c) => c.bound === 'min')
    const maxChip = group.find((c) => c.bound === 'max')
    const numericParts: string[] = []
    if (minChip && maxChip) {
      numericParts.push(`${fieldLabel} от ${minChip.label} до ${maxChip.label}`)
    } else if (minChip) {
      numericParts.push(`${fieldLabel} от ${minChip.label}`)
    } else if (maxChip) {
      numericParts.push(`${fieldLabel} до ${maxChip.label}`)
    }

    // Перечислимые значения по режимам.
    const byMode = new Map<string, string[]>()
    for (const c of group) {
      if (c.bound) continue
      const m = c.mode ?? 'or'
      if (!byMode.has(m)) byMode.set(m, [])
      byMode.get(m)!.push(c.label)
    }
    const andVals = byMode.get('and') ?? []
    const notVals = byMode.get('not') ?? []
    const orVals = byMode.get('or') ?? []

    let enumStr = ''
    if (andVals.length && notVals.length) {
      enumStr = `${joinEnum(andVals, 'и')} исключая ${joinEnum(notVals, 'и')}`
    } else if (andVals.length) {
      enumStr = joinEnum(andVals, 'и')
    } else if (notVals.length) {
      enumStr = `исключая ${joinEnum(notVals, 'и')}`
    }
    if (orVals.length) {
      const orPart = joinEnum(orVals, 'или')
      if (enumStr) enumStr += ` или ${orPart}`
      else enumStr = orPart
    }

    if (enumStr) {
      enumStr = `${fieldLabel} ${enumStr}`
    }

    const all: string[] = []
    if (numericParts.length) all.push(...numericParts)
    if (enumStr) all.push(enumStr)
    if (!all.length) return fieldLabel
    return all.join(' ')
  }

  function clickChip(event: MouseEvent, chip: CatalogFilterChip) {
    if (event.defaultPrevented) return
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (onRemove?.(chip) !== true) return
    event.preventDefault()
  }

  function chipAttrs(chip: CatalogFilterChip) {
    return {
      'data-testid': 'active-filter',
      'data-filter-path': chip.path,
      'data-filter-value': chip.value,
      'data-filter-excluded': chip.excluded || undefined,
      title: `${chip.fieldLabel}: ${chip.label} — нажмите, чтобы снять`,
      class: chip.excluded
        ? 'inline-flex max-lg:shrink-0 items-center gap-1 rounded-md border border-destructive/25 bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/15'
        : 'inline-flex max-lg:shrink-0 items-center gap-1 rounded-md border border-border bg-muted/60 px-2.5 py-0.5 text-xs font-medium transition-colors hover:bg-muted',
    }
  }
</script>

<div
  class={`flex min-w-0 flex-wrap items-center gap-1.5 max-lg:flex-nowrap max-lg:overflow-x-auto max-lg:[scrollbar-width:none] max-lg:[&::-webkit-scrollbar]:hidden ${cls}`}
  data-testid="active-filters"
  role="group"
  aria-label={count ? `Активные фильтры: ${count}` : 'Активные фильтры'}
>
  {#if count}
    <span
      class="inline-flex max-lg:shrink-0 items-center rounded-md border border-transparent bg-secondary px-2.5 py-0.5 text-xs font-medium"
      data-testid="filters-count"
      aria-hidden="true">{count}</span
    >
  {/if}

  {#each groups as [key, group] (key)}
    {#if hasBlock(key)}
      {@const cut = client && host && ctx?.blocks[key]}
      {#if cut}
        <button
          type="button"
          class="inline-flex max-lg:shrink-0 items-center gap-1 rounded-md border border-border bg-muted/60 px-2.5 py-0.5 text-xs font-medium transition-colors hover:bg-muted"
          data-testid="active-filter"
          data-filter-label={key}
          data-filter-label-popup="true"
          aria-expanded={openKey === key}
          aria-haspopup="dialog"
          aria-controls={openKey === key ? popupNode?.id : undefined}
          {@attach remember(key)}
          onclick={() => toggle(key)}
        >{combinedLabel(key, group)}</button>
      {:else}
        <span
          class="inline-flex max-lg:shrink-0 items-center gap-1 rounded-md border border-border bg-muted/60 px-2.5 py-0.5 text-xs font-medium"
          data-testid="active-filter"
          data-filter-label={key}
          data-filter-label-popup="false"
        >{combinedLabel(key, group)}</span>
      {/if}
    {:else}
      {#each group as chip (chip.path + '=' + chip.value)}
        {#if chip.href !== null}
          <a
            {...asLink(chip.href)}
            onclick={(event) => clickChip(event, chip)}
            {...chipAttrs(chip)}
          >
            <span class="text-muted-foreground">{chip.fieldLabel}:</span>
            <span>{chip.label}</span>
            <span class="sr-only">— убрать этот фильтр</span>
          </a>
        {:else}
          <Button variant="plain" size="none" onclick={() => onRemove?.(chip)} {...chipAttrs(chip)}>
            <span class="text-muted-foreground">{chip.fieldLabel}:</span>
            <span>{chip.label}</span>
            <span class="sr-only">— убрать этот фильтр</span>
          </Button>
        {/if}
      {/each}
    {/if}
  {/each}

  {#if !chips.length}
    <span class="max-lg:shrink-0 text-xs text-muted-foreground" data-testid="active-filters-empty">Фильтры не выбраны</span>
  {/if}
</div>

{#if client && host && openKey}
  {@const entry = ctx?.blocks[openKey]}
  {#if entry}
    <FilterBlockPopup
      {entry}
      anchor={anchors[entry.key]}
      onClose={close}
      {onSlot}
      reclaim={() => ctx?.reclaim()}
      bind:container={popupNode}
    />
  {/if}
{/if}
