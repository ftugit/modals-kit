<script lang="ts">
  /**
   * Панель фильтров каталога: связка «схема источника → хранилище пагинатора».
   *
   * Сложного здесь нет по устройству: всё, что можно посчитать, считает api
   * схемы (`$lib/filters`) — какие контролы есть, что гасит связка и почему,
   * какие чипы висят, какой патч положить в extra, какой адрес снимает одно
   * значение. Этот компонент знает ровно три вещи, которых api знать не может:
   * имя пагинатора, канал-хранилище и путь страницы.
   *
   * Контролов нет — панели нет (пустая схема честно молчит). Удаление панели из
   * страницы ничего не ломает: она ни на что не подписывается, кроме состояния
   * пагинатора, и нигде не регистрируется.
   */
  import { page } from '$app/state'
  import { getClientStore, setExtra } from '$lib/paginate'
  import {
    catalogFilterExtraPatch,
    catalogFilterRemoveValuePatch,
    catalogFilterView,
    type CatalogFilterSchema,
  } from '$lib/filters'
  import { ActiveFilters, CatalogFilterForm } from '$lib/ui/filters'

  interface Props {
    /** Имя пагинатора-владельца: единственный канал записи — его хранилище. */
    name: string
    /** Готовая схема источника (собрана серверной зоной, пришла роутом). */
    schema: CatalogFilterSchema
    /** Значения фильтров из состояния пагинатора (`extra`), не из адреса. */
    extra: Record<string, unknown> | undefined
    /** Путь страницы каталога для адресов ссылок (по умолчанию — текущий). */
    url?: string
    prefix?: string
    /** Чужие ключи адреса: их сохраняет и форма (скрытыми полями), и чипы. */
    preserved?: Record<string, string>
    class?: string
  }

  let {
    name,
    schema,
    extra,
    url = page.url.pathname,
    prefix = 'page',
    preserved = {},
    class: cls = '',
  }: Props = $props()

  /** Вся картина панели — из схемы и extra: ни одного решения в разметке. */
  const view = $derived(catalogFilterView(schema, extra, { url: { page: url, prefix, preserved } }))

  /**
   * Применение набора: полный патч ОДНИМ `setExtra` — так ядро снимает
   * опустевшие ключи, сбрасывает указатель на первую страницу (reloadKeys) и
   * пишет всё в выбранное хранилище. Адрес обновляет persist адаптера, не форма.
   */
  function apply(next: Record<string, string[]>) {
    void setExtra(getClientStore(), name, catalogFilterExtraPatch(schema, next))
  }

  /** Снятие одного значения (клик по чипу) — тем же каналом состояния. */
  function remove(chip: { path: string; value: string }): boolean {
    void setExtra(
      getClientStore(),
      name,
      catalogFilterRemoveValuePatch(schema, extra, chip.path, chip.value),
    )
    return true
  }
</script>

<section
  class={`rounded-xl border border-border bg-card p-4 text-sm shadow-sm ${cls}`}
  data-testid="filters-panel"
  data-filter-source={view.source}
>
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div class="flex flex-wrap items-center gap-2">
      <h2 class="font-medium">Фильтры каталога</h2>
      {#if view.builtAt}
        <span class="text-xs text-muted-foreground" data-testid="filters-built-at"
          >схема собрана {new Date(view.builtAt).toLocaleString('ru-RU')}</span
        >
      {/if}
    </div>
    {#if view.searchBlocked}
      <p class="text-xs text-muted-foreground" data-testid="filters-search-blocked">
        Поиск не применяется: {view.searchBlocked.reason}
      </p>
    {/if}
  </div>

  <!--
    Серверная проверка расположена ВНЕ закрываемого <details>: после no-JS GET
    человек должен увидеть, почему заведомо несовместимый набор не применился,
    не открывая форму повторно.
  -->
  {#if view.violations.length}
    <ul class="mt-2 space-y-1" data-testid="filters-validation">
      {#each view.violations as violation (violation.id + violation.keys.join(','))}
        <li class="text-xs text-destructive" data-violation-id={violation.id}>{violation.message}</li>
      {/each}
    </ul>
  {/if}

  <!-- Раскрытие — нативный <details>: форма-GET работает и без JavaScript. -->
  <details class="mt-3" data-testid="filters-details">
    <summary class="cursor-pointer text-sm font-medium" data-testid="filters-toggle">
      Выбрать фильтры
    </summary>
    <div class="mt-3">
      <!--
        Форма привязана к Описанию, собранному из схемы, поэтому смена схемы
        (другой источник) пересоздаёт её целиком: имена полей и валидаторы —
        из нового compile, значения — тем же `seed` из состояния.
      -->
      {#key schema}
        <CatalogFilterForm
          {schema}
          values={extra}
          {prefix}
          action={view.formAction ?? url}
          hidden={view.hidden}
          resetHref={view.formAction ?? url}
          onApply={apply}
        />
      {/key}
    </div>
  </details>

  <div class="mt-3">
    <ActiveFilters chips={view.chips} count={view.count} onRemove={remove} />
  </div>
</section>
