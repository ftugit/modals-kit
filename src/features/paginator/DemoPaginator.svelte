<script lang="ts">
  import { onMount } from 'svelte'
  import {
    EdgeSentinel,
    PaginatorHost,
    usePaginatorActions,
    usePaginatorState,
    useScopeStore,
  } from '$lib/paginate/svelte'
  import { fetchReplace } from '$lib/paginate'
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
  import type { DemoEntry } from '../../content/items'
  import {
    DEFAULT_DEMO_EXTRA,
    DEMO_PAGE_SIZES,
    demoExtraOf,
    type DemoExtra,
    type DemoStore,
  } from './definition'
  import { isAnimeRecord, shotHeight } from './item-views'
  import ShotTile from './ShotTile.svelte'
  import ItemRow from './ItemRow.svelte'
  import AnimeCard from './AnimeCard.svelte'
  import SearchForm from './SearchForm.svelte'
  import SearchNote from './SearchNote.svelte'
  import type { PaginatorState } from '$lib/paginate'

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

  const acc = (v: DemoExtra) => v.mode === 'accumulate'
  const zoneOn = (t: DemoExtra['topTrigger']) => t === 'direction' || t === 'chat'

  const DEMO_FIELDS: readonly SettingsField<DemoExtra>[] = [
    {
      key: 'kind',
      label: 'Содержимое (источник)',
      type: 'select',
      options: [
        ['products', 'Товары (299)'],
        ['photos', 'Фото (131)'],
        ['anime', 'Аниме (Shikimori API)'],
      ],
    },
    { type: 'divider', label: 'Поиск (источник и lib search)' },
    {
      // Отключает поиск целиком: поля нет, `?page.q` до источника не доходит.
      key: 'search',
      label: 'Поиск (поле и ?page.q)',
      type: 'toggle',
    },
    {
      // Отключает именно lib search: запрос уходит источнику как есть
      // (у Shikimori — серверная подстрока нашего бэкенда, без fuzzy).
      key: 'fuzzy',
      label: 'lib/search (fuzzy-перехват)',
      type: 'toggle',
      jsOnly: true,
      enabledWhen: (v) => v.search,
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
      key: 'layout',
      label: 'Раскладка',
      type: 'select',
      options: [
        ['list', 'Список'],
        ['columns', 'Колонки (round-robin)'],
      ],
    },
    {
      key: 'cols',
      label: 'Колонки',
      type: 'select',
      parse: (raw) => (raw === 'auto' ? 'auto' : Number(raw)),
      enabledWhen: (v) => v.layout === 'columns',
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
      enabledWhen: (v) => v.layout === 'columns' && v.cols === 'auto',
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
      enabledWhen: (v) => v.layout === 'columns' && v.cols === 'auto',
      options: [
        ['0', '0% — только целые колонки'],
        ['10', '10%'],
        ['25', '25%'],
        ['50', '50%'],
      ],
    },
    { key: 'total', label: 'Известное число страниц', type: 'toggle' },
    { key: 'skel', label: 'Скелетоны', type: 'toggle', jsOnly: true },
    { key: 'ind', label: 'Плавающий индикатор загрузки', type: 'toggle', jsOnly: true },
    {
      key: 'pend',
      label: 'Скелетоны: минимум на экране',
      type: 'select',
      jsOnly: true,
      parse: (raw) => Number(raw),
      options: [
        ['0', '0 мс — без задержки'],
        ['200', '200 мс'],
        ['300', '300 мс (по умолчанию)'],
        ['600', '600 мс'],
        ['900', '900 мс'],
      ],
    },
    { type: 'divider', label: 'Подгрузка по краям (только в режиме накопления)' },
    {
      key: 'topTrigger',
      label: 'Триггер сверху',
      type: 'select',
      jsOnly: true,
      enabledWhen: acc,
      options: TRIGGER_OPTIONS,
    },
    {
      key: 'topZone',
      label: 'Зона сверху',
      type: 'select',
      jsOnly: true,
      enabledWhen: (v) => acc(v) && zoneOn(v.topTrigger),
      options: ZONE_OPTIONS,
    },
    {
      key: 'prepend',
      label: 'Позиция при подгрузке сверху',
      type: 'select',
      jsOnly: true,
      enabledWhen: (v) => acc(v) && v.topTrigger !== 'off',
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
      enabledWhen: acc,
      options: TRIGGER_OPTIONS,
    },
    {
      key: 'bottomZone',
      label: 'Зона снизу',
      type: 'select',
      jsOnly: true,
      enabledWhen: (v) => acc(v) && zoneOn(v.bottomTrigger),
      options: ZONE_OPTIONS,
    },
  ]

  interface Props {
    name: string
    storeKind: DemoStore
    onStore: (store: DemoStore) => void
    /** SSR-снапшот URL-бранча. Страницу из адреса хост считает сам (через адаптер). */
    url?: { snapshot: PaginatorState<DemoEntry> | null }
  }

  let { name, storeKind, onStore, url }: Props = $props()

  /** Хранилище пагинаторов страницы (SSR-снапшоты): нужно для пересборки после гидратации. */
  const scopeStore = useScopeStore()

  const pagState = usePaginatorState<DemoEntry>(name)
  const { scrollToPage, setExtra } = usePaginatorActions(name)

  const cfg = $derived.by((): DemoExtra => {
    const s = pagState()
    return demoExtraOf(s.extra)
  })

  // Смена «источник/флаги поиска» — это смена ДАННЫХ: ключи объявлены в
  // reloadKeys пагинатора, ядро само сбросит страницу и перезагрузит первую.
  const searchLabel = $derived(
    cfg.kind === 'anime'
      ? cfg.fuzzy
        ? 'Поиск: lib/search (fuzzy на клиенте, добор страниц)'
        : 'Поиск: родной (бэкенд сужает выдачу подстрокой)'
      : cfg.fuzzy
        ? 'Поиск: lib/search (fuzzy по названиям)'
        : 'Поиск: у этого источника родного нет — включите lib/search'
  )
  const searchHint = $derived(
    cfg.kind === 'anime'
      ? cfg.fuzzy
        ? 'Например, «нарута» — опечатку исправит словарь lib/search'
        : 'Например, «наруто» — точная подстрока на бэкенде'
      : 'Например, «Product 1» или «Photo 1»'
  )
  const qValue = $derived(String(pagState().extra.q ?? ''))

  // Поделённый адрес с включённым lib search: SSR отдал выдачу ИСТОЧНИКА
  // (fuzzy на сервере не выполняется никогда). С JS перехват пересобирает её
  // с первой страницы источника и показывает запрошенную страницу — адрес при
  // этом не меняется. Как fetchReplace при монтировании страницы Shikimori
  // в исходнике.
  onMount(() => {
    if (!url?.snapshot) return
    const state = pagState()
    const opts = demoExtraOf(state.extra)
    const q = String(state.extra.q ?? '').trim()
    if (!opts.search || !opts.fuzzy || !q) return
    void fetchReplace(scopeStore, name, state.page, 'replace')
  })

  // Смена раскладки (list ↔ columns) пересобирает якоря: возвращаем viewport к странице,
  // которая была текущей ДО смены — как createEffect(on(() => cfg().layout, …)) в исходнике.
  let prevLayout: DemoExtra['layout'] | undefined = undefined
  $effect(() => {
    const layout = cfg.layout
    if (prevLayout !== undefined && prevLayout !== layout) {
      scrollToPage(pagState().page)
    }
    prevLayout = layout
  })

  function restoredLabel(store: DemoStore): string {
    return store === 'url' ? 'из URL' : store === 'local' ? 'из localStorage' : 'из памяти'
  }
</script>

<PaginatorHost
  {name}
  class={HOST_CLASS}
  ariaLabel="Демо пагинатора"
  extraDefaults={DEFAULT_DEMO_EXTRA}
  mode={cfg.mode}
  topTrigger={cfg.topTrigger}
  bottomTrigger={cfg.bottomTrigger}
  topZone={cfg.topZone}
  bottomZone={cfg.bottomZone}
  prependBehavior={cfg.prepend}
  pendingDelayMs={cfg.pend}
  snapshot={url?.snapshot ?? null}
>
  {#snippet toolbar()}
    {#if cfg.search}
      <SearchForm
        pageParam="page"
        label={searchLabel}
        hint={searchHint}
        value={qValue}
        commit={(value) => setExtra({ q: value })}
        class="mb-2"
      />
    {:else if qValue}
      <p class="mb-2 text-xs text-muted-foreground" data-testid="search-off">
        Поиск выключен (<code class="rounded bg-muted/70 px-1">?page.search=false</code>): запрос
        «{qValue}» не учитывается — показан обычный каталог.
      </p>
    {/if}
    <SearchNote {name} active={cfg.search && cfg.fuzzy} />
    <PaginatorSettings
      {name}
      class="mb-5 rounded-xl border border-border bg-card p-4 text-sm shadow-sm"
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
      noscriptHint="Без JavaScript: работают источник, поиск (родной — на сервере), раскладка, размер страницы и число страниц (через адрес); fuzzy-перехват и остальные опции требуют JS."
    >
      {#snippet footer(ctx)}
        Настройки и страница восстановлены {restoredLabel(storeKind)}; каждое изменение
        сразу пишется туда же. Размер страницы: <b data-testid="page-size">{ctx.pageSize}</b> —
        номера страниц подписаны на разделителях в списке.
      {/snippet}
    </PaginatorSettings>
  {/snippet}

  {#snippet children()}
    {@render DemoBody({ cfg, name })}
  {/snippet}
</PaginatorHost>

{#snippet DemoBody({ cfg, name }: { cfg: DemoExtra; name: string })}
  <!--
    Скелетоны объявлены значениями и передаются УСЛОВНО: выключены — `undefined`,
    и список сам рисует строку «Загрузка страницы N…» (ровно как в исходнике,
    `renderSkeleton={cfg().skel ? skeleton(cfg().kind) : undefined}`).
  -->
  {#snippet skelColumns(ctx: { page: number; index: number })}
    <Skeleton height={shotHeight(ctx.index + 1)} />
  {/snippet}
  <!-- Карточка источника: запись Shikimori (постер/синонимы) либо демо-запись. -->
  {#snippet skelList(ctx: { page: number; index: number })}
    {#if cfg.kind === 'photos'}
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
      {#snippet renderItem(item: DemoEntry)}
        {#if isAnimeRecord(item)}<AnimeCard {item} />{:else}<ShotTile {item} />{/if}
      {/snippet}
    </PageColumns>
  {:else}
    <PageList {name} renderSkeleton={cfg.skel ? skelList : undefined}>
      {#snippet renderItem(item: DemoEntry)}
        {#if isAnimeRecord(item)}<AnimeCard {item} />{:else}<ItemRow {item} />{/if}
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
