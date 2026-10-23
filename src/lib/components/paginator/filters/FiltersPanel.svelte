<script lang="ts">
  /**
   * Панель фильтров каталога: рамка вокруг формы фильтров одной схемы.
   *
   * Форму — какие поля, где и с какими подписями — пишет приложение: своё
   * описание под схему (`describe`) и свой компонент (`form`), поля в котором
   * расставлены руками. Панель знает то, чего не знает форма: имя пагинатора,
   * канал-хранилище, путь страницы, чипы применённого набора и нарушения.
   *
   * Контролов нет — панели нет (пустая схема честно молчит). Удаление панели из
   * страницы ничего не ломает: она ни на что не подписывается, кроме состояния
   * пагинатора, и нигде не регистрируется.
   */
  import { untrack } from 'svelte'
  import { currentPathname, currentSearch } from '#lib/paginate/sveltekit/router.js'
  import { getClientStore, getPaginator, linkFor, setExtra } from '#lib/paginate/index.js'
  import {
    catalogFilterExtraPatch,
    catalogFilterView,
    type CatalogFilterSchema,
  } from '#lib/paginate/filters/index.js'
  import type { Component } from 'svelte'
  import type { MessageDictionary } from '#lib/form/index.js'
  import type { CatalogFilterDescribe } from '#lib/paginate/filters/index.js'
  import ActiveFilters from './ActiveFilters.svelte'
  import type { FilterFormProps } from './filter-form.svelte.js'

  interface Props {
    /** Имя пагинатора-владельца: единственный канал записи — его хранилище. */
    name: string
    /** Готовая схема источника (собрана серверной зоной, пришла роутом). */
    schema: CatalogFilterSchema
    /** Значения фильтров из состояния пагинатора (`extra`), не из адреса. */
    extra: Record<string, unknown> | undefined
    /** Путь страницы каталога: `action` формы и начало ссылок (по умолчанию — текущий). */
    url?: string
    /**
     * Срез адреса, от которого адаптер строит ссылки и скрытые поля (по умолчанию —
     * живой адрес). Приложение передаёт свой, если часть чужого состояния не должна
     * переживать смену фильтров (например, открытая модалка).
     */
    search?: Readonly<Record<string, unknown>>
    /** Описание формы под схему — функция приложения (та же, что у сервера). */
    describe: CatalogFilterDescribe
    /** Компонент фильтров этой схемы: поля расставлены руками. */
    form: Component<FilterFormProps>
    /** Словарь приложения для текстов нарушений. */
    messages?: MessageDictionary
    class?: string
  }

  let {
    name,
    schema,
    extra,
    url = currentPathname(),
    search: searchProp,
    describe,
    form: FilterForm,
    messages,
    class: cls = '',
  }: Props = $props()

  /**
   * Слой имён полей — у адаптера пагинатора: URL-транспорт кладёт фильтры в
   * `page.filters.kind`, транспорт без адреса — в `filters.kind`. Панель его не выбирает.
   */
  const prefix = untrack(() => getPaginator(name).adapter.pageParam ?? '')
  /** Описание формы: имена полей — ключи хранилища (`page.filters.kind`). */
  const description = $derived(describe(schema, { prefix: prefix ? `${prefix}.` : '' }))

  /**
   * Адрес — только через адаптер: ссылку на «первую страницу после патча» строит
   * `linkFor` (у хранилища без адреса — `null`, и UI рисует кнопки), скрытые поля
   * формы — `carryFields` (всё, кроме своих фильтров и указателя страницы).
   */
  const search = $derived(searchProp ?? currentSearch())
  const href = (patch: Record<string, string | number | undefined>): string | null => {
    const query = linkFor(name, { page: 1, patch }, { search })
    return query === null ? null : url + query
  }
  const hidden = $derived(getPaginator(name).adapter.carryFields?.(search, ['filters.*']) ?? [])

  /** Вся картина панели — из схемы, описания и extra: ни одного решения в разметке. */
  const view = $derived(catalogFilterView(schema, extra, { description, prefix, href, messages }))

  /**
   * Форма сеет значения ОДИН раз (её зеркало — черновик пользователя), поэтому
   * применённый набор, изменённый ВНЕ формы (снят чип, «Сбросить», «Назад»),
   * пересоздаёт её — иначе контрол показывал бы снятое значение, и следующее
   * «Применить» вернуло бы его. Своё «Применить» форму не пересоздаёт: фокус
   * остаётся на кнопке, черновик уже равен применённому.
   */
  const chipsKey = (chips: readonly { path: string; value: string }[]): string =>
    chips.map((chip) => `${chip.path}=${chip.value}`).join('&')
  const appliedKey = $derived(chipsKey(view.chips))
  let seenKey = untrack(() => appliedKey)
  let ownKey: string | null = null
  let formEpoch = $state(0)
  $effect.pre(() => {
    const key = appliedKey
    untrack(() => {
      if (key === seenKey) return
      if (key !== ownKey) formEpoch++
      seenKey = key
      ownKey = null
    })
  })

  /**
   * Применение набора: полный патч ОДНИМ `setExtra` — так ядро снимает
   * опустевшие ключи, сбрасывает указатель на первую страницу (reloadKeys) и
   * пишет всё в выбранное хранилище. Адрес обновляет persist адаптера, не форма.
   */
  function apply(next: Record<string, string[]>) {
    const patch = catalogFilterExtraPatch(schema, next)
    ownKey = chipsKey(catalogFilterView(schema, { ...extra, ...patch }, { description, prefix }).chips)
    void setExtra(getClientStore(), name, patch)
  }

  /** Снятие одного значения (клик по чипу) — тем же каналом состояния. */
  function remove(chip: { patch: Record<string, string | number | undefined> }): boolean {
    void setExtra(getClientStore(), name, chip.patch)
    return true
  }

  /** «Сбросить» с JS — тот же канал: адрес пишет хранилище, форма пересоздаётся по чипам. */
  function reset() {
    void setExtra(getClientStore(), name, view.reset.patch)
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
        Форма привязана к описанию, собранному из схемы, поэтому смена схемы
        пересоздаёт её целиком: варианты и правила — из новой схемы, значения —
        тем же `seed` из состояния. `formEpoch` — то же для набора, изменённого
        вне формы.
      -->
      {#key description}
        {#key formEpoch}
          <FilterForm
            {description}
            {schema}
            values={extra}
            {prefix}
            action={url}
            {hidden}
            resetHref={view.reset.href ?? undefined}
            onReset={reset}
            onApply={apply}
          />
        {/key}
      {/key}
    </div>
  </details>

  <div class="mt-3">
    <ActiveFilters chips={view.chips} count={view.count} onRemove={remove} />
  </div>
</section>
