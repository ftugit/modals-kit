<script lang="ts">
  import { onMount } from 'svelte'
  import { report } from '$lib/app-errors.svelte'
  import { page } from '$app/state'
  import type { CatalogFilterSchema } from '$lib/filters'
  import { featureGates, getClientStore, goToPage, type PaginatorState } from '$lib/paginate'
  import {
    EdgeSentinel,
    PaginatorHost,
    usePaginatorState,
  } from '$lib/paginate/svelte'
  import { useSearchCorrection, useSearchStats } from '$lib/search/svelte'
  import {
    EmptyState,
    EndRow,
    ErrorRow,
    EventLog,
    LoadMoreLink,
    LoadingIndicator,
    PageColumns,
    PageList,
    PageNav,
    PaginatorSettings,
    ReplaceLoadingRow,
    ResetButton,
    Skeleton,
    type SettingsField,
  } from '$lib/ui/paginator'
  import {
    DEFAULT_DEMO_EXTRA,
    DEMO_PAGE_SIZES,
    demoExtraOf,
    demoPreservedSearch,
    demoQueryOf,
    demoHasFilterSchema,
    loadFilterSchema,
    type DemoExtra,
    type DemoStore,
  } from './definition'
  import FiltersPanel from './FiltersPanel.svelte'
  import { isAnimeItem, isDbItem, shotHeight, type CatalogItem } from './item-views'
  import AnimeRow from './AnimeRow.svelte'
  import AnimeTile from './AnimeTile.svelte'
  import DbRow from './DbRow.svelte'
import ItemRow from './ItemRow.svelte'
  import SearchQueryForm from './SearchQueryForm.svelte'
  import ShotTile from './ShotTile.svelte'

  const HOST_CLASS =
    'h-[520px] scroll-mt-20 overflow-y-auto rounded-xl border border-border/70 bg-background p-3'

  const TRIGGER_OPTIONS = [
    ['off', 'Выкл'],
    ['direction', 'Направление + зона (edge, rearm)'],
    ['edge', 'Только жест у кромки'],
    ['chat', 'Чат: только в сторону движения'],
    ['manual', 'Вручную (ссылка «показать ещё»)'],
  ] as const

  const ZONE_OPTIONS = [
    ['edge', 'Край'],
    ['20%', '20 % высоты'],
    ['40%', '40 % высоты'],
    ['200px', '200 px'],
  ] as const

  const DEMO_FIELDS: readonly SettingsField<DemoExtra>[] = [
    {
      key: 'src',
      label: 'Источник данных',
      type: 'select',
      options: [
        ['products', 'Товары (299, локально)'],
        ['photos', 'Фото (131, локально)'],
        ['animes', 'Shikimori (живой API)'],
        ['db', 'БД (записи demo_post, $lib/db)'],
      ],
    },
    {
      key: 'cur',
      label: 'Курсор вместо номеров страниц',
      // Опция ИСТОЧНИКА: у товаров, фото и Shikimori указателя следующего шага нет,
      // поэтому поле связано с выбором источника, а не с догадкой разметки. Работает
      // и без JavaScript: ?page.cur=1 попадает в адрес, а токен выдаёт сервер.
      enabledBy: [{ field: 'src', equals: 'db' }],
      type: 'toggle',
    },
    { type: 'divider', label: 'Поиск: два независимых слоя' },
    {
      key: 'srch',
      label: 'Родной поиск источника (q → search)',
      type: 'toggle',
      // Источник сам объявляет, умеет ли он искать (capabilities.search): товары
      // ищут по названию своими данными, у живого каталога это `search` в API,
      // а у фото родного поиска нет — опция гаснет, а не «включается вхолостую».
      requires: 'nativeSearch',
    },
    {
      key: 'ls',
      label: 'lib/search поверх источника (fuzzy)',
      type: 'toggle',
      jsOnly: true,
      // Без JavaScript этот декоратор не запускается: не показываем тумблер как
      // работающую опцию до гидратации. После неё проверяется capability источника.
      requires: 'libSearch',
    },
    { type: 'divider', label: 'Раскладка и режим' },
    {
      key: 'layout',
      label: 'Раскладка',
      type: 'select',
      options: [
        ['list', 'Список'],
        ['columns', 'Колонки (round-robin)'],
      ],
    },
    {
      key: 'mode',
      label: 'Режим',
      type: 'select',
      jsOnly: true,
      options: [
        ['accumulate', 'Накопление (подгрузка)'],
        ['single', 'Классическая смена'],
      ],
    },
    {
      key: 'cols',
      label: 'Колонки',
      type: 'select',
      parse: (raw) => (raw === 'auto' ? 'auto' : Number(raw)),
      enabledBy: [{ field: 'layout', equals: 'columns' }],
      options: [
        ['auto', 'Авто (по ширине)'],
        ['2', '2'],
        ['3', '3'],
        ['4', '4'],
      ],
    },
    {
      key: 'colW',
      label: 'Авто: ширина колонки',
      type: 'select',
      parse: (raw) => Number(raw),
      enabledBy: [{ field: 'layout', equals: 'columns' }, { field: 'cols', equals: 'auto' }],
      options: [
        ['160', '160px'],
        ['220', '220px'],
        ['300', '300px'],
        ['400', '400px'],
      ],
    },
    {
      key: 'colFit',
      label: 'Авто: допуск вписывания (±)',
      type: 'select',
      parse: (raw) => Number(raw),
      enabledBy: [{ field: 'layout', equals: 'columns' }, { field: 'cols', equals: 'auto' }],
      options: [
        ['0', '0% — только целые колонки'],
        ['10', '10%'],
        ['25', '25%'],
        ['50', '50%'],
      ],
    },
    {
      key: 'total',
      label: 'Известное число страниц',
      type: 'toggle',
      // Тумблер гасит totals в ответе источника (`withTotalsGate`) — значит
      // осмысленен только там, где источник totals вообще отдаёт. У Shikimori
      // их нет by design (API не отдаёт ни `Link`, ни счётчика) — источник их
      // не объявляет, и опция гаснет сама, без знания потребителя об имени источника.
      requires: 'totals',
    },
    { key: 'skel', label: 'Скелетоны', type: 'toggle', jsOnly: true },
    { key: 'ind', label: 'Плавающий индикатор загрузки', type: 'toggle', jsOnly: true },
    { type: 'divider', label: 'Подгрузка по краям (только в режиме накопления)' },
    {
      key: 'topTrigger',
      label: 'Триггер сверху',
      type: 'select',
      jsOnly: true,
      enabledBy: [{ field: 'mode', equals: 'accumulate' }],
      options: TRIGGER_OPTIONS,
    },
    {
      key: 'topZone',
      label: 'Зона сверху',
      type: 'select',
      jsOnly: true,
      enabledBy: [{ field: 'mode', equals: 'accumulate' }, { field: 'topTrigger', in: ['direction', 'chat'] }],
      options: ZONE_OPTIONS,
    },
    {
      key: 'prepend',
      label: 'Позиция при подгрузке сверху',
      type: 'select',
      jsOnly: true,
      enabledBy: [
        { field: 'mode', equals: 'accumulate' },
        { field: 'topTrigger', in: ['direction', 'edge', 'chat', 'manual'] },
      ],
      options: [
        ['auto', 'Авто (нативный якорь, иначе JS)'],
        ['native', 'Только нативный якорь (overflow-anchor)'],
        ['js', 'Только JS-компенсация'],
      ],
    },
    {
      key: 'bottomTrigger',
      label: 'Триггер снизу',
      type: 'select',
      jsOnly: true,
      enabledBy: [{ field: 'mode', equals: 'accumulate' }],
      options: TRIGGER_OPTIONS,
    },
    {
      key: 'bottomZone',
      label: 'Зона снизу',
      type: 'select',
      jsOnly: true,
      enabledBy: [{ field: 'mode', equals: 'accumulate' }, { field: 'bottomTrigger', in: ['direction', 'chat'] }],
      options: ZONE_OPTIONS,
    },
  ]

  interface Props {
    name: string
    storeKind: DemoStore
    onStore: (store: DemoStore) => void
    /** SSR-снапшот URL-бранча. Страницу из адреса хост считает сам (через адаптер). */
    url?: { snapshot: PaginatorState<CatalogItem> | null }
    /** Схема фильтров от сервера: есть, только если её объявляет выбранный источник. */
    schema?: CatalogFilterSchema | null
  }

  let { name, storeKind, onStore, url, schema = null }: Props = $props()

  const pagState = usePaginatorState<CatalogItem>(name)
  // Имя захватывается начальным значением осознанно (как у панели настроек рядом):
  // родитель пересоздаёт демо по `{#key activeName}` при смене хранилища.
  const correction = useSearchCorrection(name)

  const cfg = $derived.by((): DemoExtra => demoExtraOf(pagState().extra))
  const query = $derived(demoQueryOf(pagState().extra))
  /** Возможности текущего источника: панель и подсказки следуют им, а не имени `src`. */
  const gates = $derived(featureGates(pagState().capabilities))

  /**
   * Схема фильтров: серверная (её отдал лоадер, если источник выбран адресом)
   * или догруженная клиентом при переключении на живой источник. Панель без
   * схемы не рисуется — фильтров у неё тогда просто нет.
   */
  // Начальное значение читается осознанно: при SSR эффекты не исполняются, и
  // разметка панели обязана появиться уже в первом рендере (иначе без JS формы
  // фильтров не будет вовсе).
  let filterSchema = $state<CatalogFilterSchema | null>(schema)
  /**
   * Причина, по которой фильтров нет. Молчание тут было бы худшим ответом:
   * источник фильтры объявляет (`gates.filters`), значит пользователь ждёт
   * панель и обязан узнать, что схема не приехала и можно повторить.
   */
  let filterSchemaError = $state<string | null>(null)

  function loadSchema(options: { retry?: boolean } = {}): void {
    if (options.retry) filterSchemaError = null
    void loadFilterSchema()
      .then((loaded) => {
        filterSchema = loaded
        filterSchemaError = null
      })
      .catch((error) => {
        filterSchema = null
        filterSchemaError = `схема фильтров не загрузилась: ${
          error instanceof Error ? error.message : String(error)
        }`
      })
  }

  $effect(() => {
    // Пересборка схемы у сервера — на изменения выбранного источника: сам
    // выбор читается из extra (гейт `filters`), а не из имени. Состояние уже
    // загружено/уже провалилось — повтор только по кнопке, а не в цикле.
    // Живая схема есть только у источников из `DEMO_SCHEMA_SRCS`: у БД фильтры
    // тоже объявлены (`flt`/`ord` адресом), но собирать для них справочник
    // Shikimori — значит показать чужую панель.
    if (!gates.filters || !demoHasFilterSchema(cfg.src) || filterSchema || filterSchemaError) return
    loadSchema()
  })

  /**
   * Запрос некуда применить — поле гаснет; причина у поля обязательна и говорит
   * именно то, что случилось: у источника нет механизма поиска ЛИБО механизм
   * есть, но выключен тумблером панели. Формулировку даёт слой возможностей
   * (`gates`), а не догадка разметки.
   */
  const searchOff = $derived(!(gates.nativeSearch && cfg.srch) && !(gates.libSearch && cfg.ls))
  const searchOffReason = $derived(
    !searchOff
      ? null
      : !gates.nativeSearch && !gates.libSearch
        ? 'источник не поддерживает поиск — запрос некуда применить'
        : 'поиск выключен опциями панели'
  )

  /**
   * Живая статистика перехвата — хук ОБЩЕГО канала lib/search (тот же слой, что
   * подпись коррекции): числом владеет поиск, а не разметка страницы.
   */
  const stats = useSearchStats(name)

  /**
   * Deep-link с запросом и включённым lib/search: SSR-выдача пришла от
   * ИСТОЧНИКА (серверная подстрока — fuzzy на сервере не исполняется), а на
   * клиенте ту же страницу обязан показать перехватчик. Механика та же, что у
   * `resyncSearch` из lib/search (перезапрос текущей страницы), но вызванная
   * напрямую: `resyncSearch` адресован поискам, зарегистрированным через
   * `defineSearch`, а здесь регистрация канонная (пагинатор + перехватчик,
   * как на странице shikimori у исходника) — экземпляра поиска в реестре нет.
   * В single-семантике переход на ту же страницу = REPLACE через перехватчик;
   * в накоплении перехват подхватывает следующую же подгрузку.
   */
  onMount(() => {
    if (cfg.ls && query) void goToPage(getClientStore(), name, pagState().page)
  })

  function restoredLabel(store: DemoStore): string {
    return store === 'url' ? 'из URL' : store === 'local' ? 'из localStorage' : 'из памяти'
  }
</script>

<PaginatorHost
  {name}
  onError={report}
  class={HOST_CLASS}
  ariaLabel="Демо пагинатора"
  extraDefaults={DEFAULT_DEMO_EXTRA}
  mode={cfg.mode}
  topTrigger={cfg.topTrigger}
  bottomTrigger={cfg.bottomTrigger}
  topZone={cfg.topZone}
  bottomZone={cfg.bottomZone}
  prependBehavior={cfg.prepend}
  snapshot={url?.snapshot ?? null}
>
  {#snippet toolbar()}
    <PaginatorSettings
      {name}
      class="mb-3 rounded-xl border border-border bg-card p-4 text-sm shadow-sm"
      pageSizes={DEMO_PAGE_SIZES}
      fields={DEMO_FIELDS}
      values={demoExtraOf}
      store={{
        value: storeKind,
        onChange: (v: string) => onStore(v as DemoStore),
        options: [
          ['url', 'URL (GET ?page, ?page.*)'],
          ['local', 'localStorage'],
          ['none', 'Память (без персиста)'],
        ],
      }}
      noscriptHint="Без JavaScript: работают источник, поиск, раскладка, размер страницы и число страниц (через адрес); остальные опции требуют JS."
    >
      {#snippet footer(ctx)}
        Настройки и страница восстановлены {restoredLabel(storeKind)}; каждое изменение
        сразу пишется туда же. Размер страницы: <b data-testid="page-size">{ctx.pageSize}</b> — у
        Shikimori это <code>limit</code> запроса к API (максимум 50), номера страниц подписаны на
        разделителях в списке.
      {/snippet}
    </PaginatorSettings>

    <div class="mb-5 rounded-xl border border-border bg-card p-4 shadow-sm">
      <!--
        Поле запроса гаснет, когда запрос некуда применить: механизм поиска
        либо не объявлен источником (`gates`), либо выключен своим тумблером.
        Оба слоя независимы: lib/search работает и при выключенном родном.
      -->
      <SearchQueryForm {name} {query} path="page.q" disabled={searchOff} hint={searchOffReason ?? undefined} />
      <p class="text-xs text-muted-foreground" data-testid="search-hint">
        {#if gates.nativeSearch}
          Родной поиск ищет сам источник — подстрокой по названию (у живого каталога это
          параметр <code>search</code> в API, у товаров — фильтр по своим данным):
          «наруто» и «naruto» находит, «нарута» — нет.{' '}
          {#if gates.libSearch}
            lib/search добавляет fuzzy-ранжирование{#if gates.dictionary} и коррекцию по словарю
              источника{/if}; с выключенным родным поиском он сканирует источник без сужения —
            медленнее, но находит опечатки.
          {/if}
        {:else if gates.libSearch}
          Родного поиска у источника нет: запрос сужает выдачу только при включённом
          lib/search (fuzzy-сканирование данных источника).
        {:else}
          Источник не умеет искать: ни родного поиска, ни подключённого lib/search.
        {/if}
      </p>
      {#if filterSchema && gates.filters}
        <!--
          Фильтры — свойство ИСТОЧНИКА (capabilities.filters): у товаров и фото
          возможности нет, и панели нет. Схему рисует `FiltersPanel`, все
          решения (контролы, связки, патч хранилища) — в api схемы.
        -->
        <div class="mt-4">
          <FiltersPanel
            {name}
            schema={filterSchema}
            extra={pagState().extra}
            preserved={demoPreservedSearch(page.url.search)}
          />
        </div>
      {:else if gates.filters && filterSchemaError}
        <p
          class="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
          data-testid="filters-schema-error"
        >
          {filterSchemaError}
          <button
            type="button"
            class="rounded-md border border-border px-2 py-0.5 hover:bg-muted"
            data-testid="filters-schema-retry"
            onclick={() => loadSchema({ retry: true })}
          >
            Повторить
          </button>
        </p>
      {/if}
      <p class="mt-1 text-xs text-muted-foreground" data-testid="search-state">
        Родной поиск: <b data-testid="search-native">{cfg.srch ? 'вкл' : 'выкл'}</b> · lib/search:
        <b data-testid="search-ls">{cfg.ls ? 'вкл' : 'выкл'}</b>
        {#if correction()?.changed}
          · <span data-testid="search-correction"
            >искали «{correction()?.query}», показываем «{correction()?.corrected}»</span
          >
        {/if}
        {#if cfg.ls && stats.current}
          · <span data-testid="search-stats"
            >просмотрено {stats.current?.scanned}, совпало {stats.current?.matched}, выдано {stats
              .current?.emitted}{#if stats.current?.exhausted}{' '}· каталог исчерпан{/if}</span
          >
        {:else if !gates.totals}
          · <span data-testid="search-stats"
            >число страниц источник не отдаёт — навигация стрелками</span
          >
        {/if}
      </p>
    </div>
  {/snippet}

  {#snippet children()}
    {@render DemoBody({ cfg, name })}
  {/snippet}
</PaginatorHost>

{#snippet DemoBody({ cfg, name }: { cfg: DemoExtra; name: string })}
  <!--
    Скелетоны объявлены значениями и передаются УСЛОВНО: выключены — `undefined`,
    и список сам рисует строку «Загрузка страницы N…» (ровно как в исходнике,
    `renderSkeleton={cfg.skel ? skeleton(cfg.src) : undefined}`).
  -->
  {#snippet skelColumns(ctx: { page: number; index: number })}
    {#if cfg.src === 'animes'}
      <Skeleton height={240} />
    {:else if cfg.src === 'db'}
      <Skeleton height={44} />
    {:else}
      <Skeleton height={shotHeight(ctx.index + 1)} />
    {/if}
  {/snippet}
  {#snippet skelList(ctx: { page: number; index: number })}
    {#if cfg.src === 'animes'}
      <Skeleton height={52} />
    {:else if cfg.src === 'db'}
      <Skeleton height={44} />
    {:else if cfg.src === 'photos'}
      <Skeleton height={shotHeight(ctx.index + 1)} />
    {:else}
      <Skeleton />
    {/if}
  {/snippet}

  {#if cfg.ind}
    <LoadingIndicator {name} />
  {/if}
  <EdgeSentinel dir={-1} {name} />
  <LoadMoreLink dir={-1} {name} />

  <EmptyState {name} />

  {#if cfg.layout === 'columns'}
    <PageColumns
      {name}
      columns={cfg.cols}
      columnWidth={cfg.colW}
      stretch={`${cfg.colFit}%`}
      renderDivider={null}
      renderSkeleton={cfg.skel ? skelColumns : undefined}
    >
      {#snippet renderItem(item: CatalogItem)}
        {#if isAnimeItem(item)}
          <AnimeTile {item} />
        {:else if isDbItem(item)}
          <DbRow {item} />
        {:else}
          <ShotTile {item} />
        {/if}
      {/snippet}
    </PageColumns>
  {:else}
    <PageList {name} renderSkeleton={cfg.skel ? skelList : undefined}>
      <!-- Запись различается по форме (канон): тайтл Shikimori, товар или фото. -->
      {#snippet renderItem(item: CatalogItem)}
        {#if isAnimeItem(item)}
          <AnimeRow {item} />
        {:else if isDbItem(item)}
          <DbRow {item} />
        {:else}
          <ItemRow {item} />
        {/if}
      {/snippet}
    </PageList>
  {/if}

  <ErrorRow {name} />
  <ReplaceLoadingRow {name} when={!cfg.skel} />

  <LoadMoreLink dir={1} {name} />
  <EdgeSentinel dir={1} {name} />
  <EndRow {name} />

  <PageNav {name}>
    {#snippet children()}
      <ResetButton {name} />
    {/snippet}
  </PageNav>
  <EventLog {name} />
{/snippet}
