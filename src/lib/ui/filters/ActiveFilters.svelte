<script lang="ts">
  /**
   * Активные фильтры списком — только разметка.
   *
   * Каждый чип — НАСТОЯЩАЯ ссылка (`href` приходит готовым из
   * `catalogFilterUrlWithout`): без JavaScript снятие фильтра работает обычным
   * переходом, «открыть в новой вкладке» — тоже, а с JS клик перехватывается и
   * уходит владельцу (`onRemove`), чтобы снятие шло тем же каналом состояния,
   * что и установка (`setExtra`), и адрес писало хранилище.
   *
   * Значения режима `not` (в источнике — исключение) помечены красным: это
   * единственный цвет, который здесь что-то значит.
   */
  import type { CatalogFilterChip } from '$lib/filters'

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
</script>

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
      <a
        href={chip.href || undefined}
        onclick={(event) => click(event, chip)}
        data-testid="active-filter"
        data-filter-path={chip.path}
        data-filter-value={chip.value}
        data-filter-excluded={chip.excluded || undefined}
        title={`${chip.fieldLabel}: ${chip.label} — нажмите, чтобы снять`}
        class={chip.excluded
          ? 'inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive hover:bg-destructive/20'
          : 'inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 px-2.5 py-0.5 text-xs font-medium hover:bg-muted'}
      >
        <span class="text-muted-foreground">{chip.fieldLabel}:</span>
        <span>{chip.label}</span>
        <span aria-hidden="true">✕</span>
        <span class="sr-only">— убрать этот фильтр</span>
      </a>
    {/each}
  {:else}
    <span class="text-xs text-muted-foreground" data-testid="active-filters-empty">Фильтры не выбраны</span>
  {/if}
</div>
