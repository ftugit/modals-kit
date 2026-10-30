<script lang="ts">
  import { asLink } from '#hooks/links/index.js'
  import { Button } from '#components/ui/index.js'
  /**
   * Активные фильтры списком — только разметка.
   *
   * Чип — как `PageLink`: есть ссылка (`href` строит адаптер пагинатора, `linkFor`) —
   * НАСТОЯЩАЯ ссылка: без JavaScript снятие фильтра работает обычным переходом,
   * «открыть в новой вкладке» — тоже, а с JS клик перехватывается и уходит владельцу
   * (`onRemove`), чтобы снятие шло тем же каналом состояния, что и установка
   * (`setExtra`), и адрес писало хранилище. Ссылки нет (хранилище без адреса) — кнопка.
   *
   * Значения режима `not` (в источнике — исключение) помечены красным: это
   * единственный цвет, который здесь что-то значит.
   */
  import type { CatalogFilterChip } from '#lib/paginate/filters/index.js'

  interface Props {
    chips: readonly CatalogFilterChip[]
    /**
     * Сколько фильтров выбрано. Число рисует ЭТОТ компонент — он и есть та
     * часть комплекта, что показывает активные фильтры: счётчик у чужой
     * разметки (шапка панели, кнопка «Применить») означал бы вторую правду о
     * том же самом.
     */
    count?: number
    /** Снять одно значение. Вернул `true` — событие обработано владельцем. */
    onRemove?: (chip: CatalogFilterChip) => boolean | void
    class?: string
  }

  let { chips, count, onRemove, class: cls = '' }: Props = $props()

  function click(event: MouseEvent, chip: CatalogFilterChip) {
    if (event.defaultPrevented) return
    // Модификаторы и не-левая кнопка — это браузер: новая вкладка, копирование
    // адреса. Перехватываем только обычный клик.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (onRemove?.(chip) !== true) return
    event.preventDefault()
  }

  /** Общие атрибуты чипа — у ссылки и у кнопки (хранилище без адреса) они одни. */
  const chipAttrs = (chip: CatalogFilterChip) => ({
    'data-testid': 'active-filter',
    'data-filter-path': chip.path,
    'data-filter-value': chip.value,
    'data-filter-excluded': chip.excluded || undefined,
    title: `${chip.fieldLabel}: ${chip.label} — нажмите, чтобы снять`,
    class: chip.excluded
      ? 'inline-flex items-center gap-1 rounded-md border border-destructive/25 bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/15'
      : 'inline-flex items-center gap-1 rounded-md border border-border bg-muted/60 px-2.5 py-0.5 text-xs font-medium transition-colors hover:bg-muted',
  })
</script>

{#snippet body(chip: CatalogFilterChip)}
  <span class="text-muted-foreground">{chip.fieldLabel}:</span>
  <span>{chip.label}</span>
  <span aria-hidden="true">✕</span>
  <span class="sr-only">— убрать этот фильтр</span>
{/snippet}

<div
  class={`flex flex-wrap items-center gap-1.5 ${cls}`}
  data-testid="active-filters"
  role="group"
  aria-label={count ? `Активные фильтры: ${count}` : 'Активные фильтры'}
>
  {#if count}
    <span
      class="inline-flex items-center rounded-md border border-transparent bg-secondary px-2 py-0.5 text-xs font-medium"
      data-testid="filters-count"
      aria-hidden="true">{count}</span
    >
  {/if}
  {#if chips.length}
    {#each chips as chip (chip.path + '=' + chip.value)}
      {#if chip.href !== null}
        <a {...asLink(chip.href)} onclick={(event) => click(event, chip)} {...chipAttrs(chip)}>{@render body(chip)}</a>
      {:else}
        <Button variant="plain" size="none" onclick={() => onRemove?.(chip)} {...chipAttrs(chip)}>{@render body(chip)}</Button>
      {/if}
    {/each}
  {:else}
    <span class="text-xs text-muted-foreground" data-testid="active-filters-empty">Фильтры не выбраны</span>
  {/if}
</div>
