<script lang="ts">
  import { onMount } from 'svelte'
  import { tryUseModals } from '#lib/modals/svelte/index.js'
  import { Button } from '#components/ui/index.js'
  import { asLink } from '#hooks/links/index.js'
  import FilterBlockPopup from './FilterBlockPopup.svelte'
  import { useFilterBlocks } from './filter-blocks.svelte.js'
  import { catalogFilterRemoveGroupPatch, catalogFilterCombinedLabel } from '#lib/paginate/filters/index.js'
  import type { CatalogFilterChip, CatalogFilterPatch } from '#lib/paginate/filters/index.js'
  import type { FormError } from '#lib/form/result.js'

  interface Props {
    chips: readonly CatalogFilterChip[]
    count?: number
    onRemove?: (chip: CatalogFilterChip) => boolean | void
    /** Снять всю группу значений поля одним патчем. */
    onRemoveGroup?: (patch: CatalogFilterPatch) => void
    /** Прямой commit черновика формы (валидация + применение) при автопримене. */
    onCommitDraft?: (form: HTMLFormElement) => readonly FormError[] | void
    /** Текст для одиночного select, в котором оказалось несколько значений. */
    singleValueNotice?: string
    class?: string
  }

  let { chips, count, onRemove, onRemoveGroup, onCommitDraft, singleValueNotice, class: cls = '' }: Props = $props()

  const ctx = useFilterBlocks()
  const host = tryUseModals()

  let client = $state(false)
  let anchors = $state<Record<string, HTMLElement | undefined>>({})
  let popupNode = $state<HTMLElement | undefined>(undefined)
  let openSnapshot = $state<string | null>(null)
  let draftErrors = $state<readonly FormError[]>([])

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
              setTimeout(() => {
                // Не перетирать ошибки, если popup уже открыт заново.
                if (ctx?.openKey !== null) return
                try {
                  const errors = onCommitDraft(f) ?? []
                  draftErrors = errors
                  const firstPath = errors.find((error) => error.path)?.path
                  if (firstPath) {
                    const control = f.elements.namedItem(firstPath) as HTMLElement | null
                    control?.focus({ preventScroll: true })
                    control?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
                  }
                } catch {
                  draftErrors = []
                }
              }, 0)
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
    draftErrors = []
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

  /**
   * Одиночный select с несколькими чипами: форма показывает «Любое», но набор
   * из `extra` не пуст. Диапазон `number` и несколько значений `multiselect` —
   * норма, поэтому проверяем именно `select`.
   */
  const openGroup = $derived(openKey ? (groups.find(([key]) => key === openKey)?.[1] ?? []) : [])
  const openField = $derived(openKey ? ctx?.schema.fields.find((field) => field.key === openKey) : undefined)
  const openNotice = $derived(
    singleValueNotice && openGroup.length > 1 && openField?.type === 'select' ? singleValueNotice : undefined,
  )

  function hasBlock(key: string): boolean {
    return Boolean(client && host && ctx?.blocks[key])
  }

  /** Перечисление значений с заменой последней запятой на союз. */
  function joinEnum(items: string[], connector: string): string {
    if (items.length <= 1) return items.join('')
    if (items.length === 2) return items.join(` ${connector} `)
    return items.slice(0, -1).join(', ') + ` ${connector} ` + items[items.length - 1]
  }

  function clickChip(event: MouseEvent, chip: CatalogFilterChip) {
    if (event.defaultPrevented) return
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (onRemove?.(chip) !== true) return
    event.preventDefault()
  }

  /** Снять все значения группы: один патч, а не гонка нескольких setExtra. */
  function removeGroup(event: MouseEvent, group: CatalogFilterChip[]) {
    event.preventDefault()
    event.stopPropagation()
    // Патч чипа снимает одно значение и сохраняет соседние. Если склеить такие
    // патчи, последний вернёт снятое предыдущим, поэтому пути группы гасим явно.
    onRemoveGroup?.(catalogFilterRemoveGroupPatch(group))
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
        <span
          class="inline-flex max-lg:shrink-0 items-center overflow-hidden rounded-md border border-border bg-muted/60 text-xs font-medium"
        >
          <button
            type="button"
            class="inline-flex items-center px-2.5 py-0.5 transition-colors hover:bg-muted"
            data-testid="active-filter"
            data-filter-label={key}
            data-filter-label-popup="true"
            aria-expanded={openKey === key}
            aria-haspopup="dialog"
            aria-controls={openKey === key ? popupNode?.id : undefined}
            {@attach remember(key)}
            onclick={() => toggle(key)}
          >{catalogFilterCombinedLabel(group)}</button>
          {#if onRemoveGroup}
            <button
              type="button"
              class="inline-flex items-center border-l border-border/70 px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              data-testid="active-filter-remove"
              data-filter-label-remove={key}
              aria-label={`Снять фильтр «${group[0]?.fieldLabel ?? key}»`}
              title="Снять все значения поля"
              onclick={(event) => removeGroup(event, group)}
            >×</button>
          {/if}
        </span>
      {:else}
        <span
          class="inline-flex max-lg:shrink-0 items-center gap-1 rounded-md border border-border bg-muted/60 px-2.5 py-0.5 text-xs font-medium"
          data-testid="active-filter"
          data-filter-label={key}
          data-filter-label-popup="false"
        >{catalogFilterCombinedLabel(group)}</span>
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

{#if draftErrors.length}
  <div
    class="mt-2 text-xs text-destructive"
    role="alert"
    data-testid="active-filters-errors"
  >
    {#each draftErrors as error (error.id)}
      <p>{error.message || error.code}</p>
    {/each}
  </div>
{/if}

{#if client && host && openKey}
  {@const entry = ctx?.blocks[openKey]}
  {#if entry}
    <FilterBlockPopup
      {entry}
      anchor={anchors[entry.key]}
      notice={openNotice}
      onClose={close}
      {onSlot}
      reclaim={() => ctx?.reclaim()}
      bind:container={popupNode}
    />
  {/if}
{/if}
