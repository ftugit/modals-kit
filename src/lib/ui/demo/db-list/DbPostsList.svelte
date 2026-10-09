<script lang="ts">
  /**
   * Список демо — обычный потребитель `$lib/paginate`: строки рисует
   * `PageList`, навигацию и настройки — компоненты `$lib/ui/paginator`.
   * Своего `slice`, своих ссылок «дальше» и своего чтения адреса здесь нет:
   * адрес принадлежит пагинатору (`?page`, `?page.size`, `?page.flt`,
   * `?page.ord`, `?page.mode`).
   *
   * Способ навигации переключает панель настроек: `pages` — обычная навигация
   * со списком страниц (`PageNav`, REPLACE), `stream` — поток с подгрузкой
   * (`mode="accumulate"` у хоста + `LoadMoreLink`). Различается только
   * взаимодействие: источник, размер страницы и фильтр на оба режима одни.
   */
  import { PaginatorHost, usePaginatorState } from '$lib/paginate/svelte'
  import type { PaginatorState } from '$lib/paginate'
  import {
    EmptyState,
    ErrorRow,
    LoadMoreLink,
    LoadingIndicator,
    PageList,
    PageNav,
    PaginatorSettings,
    type SettingsField,
  } from '$lib/ui/paginator'
  // ИМПОРТ ЗНАЧЕНИЯ, а не типа: пагинатор обязан быть зарегистрирован в том же
  // бандле, где рендерится хост. Иначе клиент падает на гидрации с
  // «Unknown paginator» (registry.ts), а SSR этого не видит.
  import {
    DB_LIST_MODES,
    DB_LIST_NAME,
    DB_LIST_PAGE_SIZES,
    dbListExtraOf,
    ensureDbListPaginator,
    type DbListExtra,
    type DbListMode,
    type DbPost,
  } from './definition'
  import ListMeta from './ListMeta.svelte'

  interface Props {
    /** SSR-снапшот из лоадера: без JavaScript список виден целиком. */
    snapshot?: PaginatorState<DbPost> | null
    /** Первая строка как пришла из слоя — технический блок демо. */
    showRaw?: boolean
  }

  let { snapshot = null, showRaw = true }: Props = $props()

  // Регистрация на стороне компонента — так же, как в демо пагинатора
  // (`features/paginator/PaginatorDemo.svelte`): тело родителя выполняется до
  // инициализации `<PaginatorHost>`, поэтому хост заведомо видит экземпляр.
  // Функция идемпотентна (guard `hasPaginator`).
  ensureDbListPaginator()
  const name = DB_LIST_NAME

  const state = usePaginatorState<DbPost>(name)
  const modeOf = (extra: Record<string, unknown> | undefined): DbListMode | undefined =>
    extra?.mode === 'stream' || extra?.mode === 'pages' ? (extra.mode as DbListMode) : undefined
  /**
   * Режим на первой отрисовке берётся из ТОГО ЖЕ источника, что и строки: на
   * сервере стор вне области видимости пуст (снапшот живёт в хосте), поэтому
   * значение доится из снимка лоадера. Иначе `?page.mode=stream` дал бы
   * расхождение SSR/клиента — ровно то, о чём предупреждает
   * `snapshotSafeError`.
   */
  const mode: DbListMode = $derived(modeOf(state().extra) ?? modeOf(snapshot?.extra) ?? 'pages')
  const stream = $derived(mode === 'stream')

  /**
   * Панель — данные (`SettingsField[]`), а не разметка: компилятор панели
   * строит из них форму `lib/form` и гасит то, что не может работать без JS.
   */
  const FIELDS: readonly SettingsField<DbListExtra>[] = [
    {
      key: 'mode',
      label: 'Способ навигации',
      type: 'select',
      options: DB_LIST_MODES.map((m) => [m, m === 'pages' ? 'Страницы (?page=N, список номеров)' : 'Поток (подгрузка, accumulate)']),
    },
  ]
</script>

<!--
  Триггеры края — то, чем «поток» отличается от «страниц» практически: в потоке
  внизу живёт ручной «показать ещё» (bottomTrigger="manual"), в режиме страниц оба
  триггера выключены, чтобы рядом с PageNav не выросла вторая навигация.
  Без явного `manual`/`always` ссылка не рисуется вовсе (LoadMoreSlot.svelte:
  `if (!always && trig !== 'manual') return false`) — значит, «ссылки нет» здесь
  не отказ слоя, а дефолт хоста, и его нужно задать самому.
-->
<PaginatorHost
  {name}
  {snapshot}
  mode={stream ? 'accumulate' : 'single'}
  topTrigger="off"
  bottomTrigger={stream ? 'manual' : 'off'}
  class="space-y-3"
  ariaLabel="Список записей демо"
>
  {#snippet toolbar()}
    <PaginatorSettings
      {name}
      class="mb-3 rounded-xl border border-border bg-card p-4 text-sm shadow-sm"
      pageSizes={DB_LIST_PAGE_SIZES}
      fields={FIELDS}
      values={dbListExtraOf}
      noscriptHint="Без JavaScript работают страница, размер и режим навигации (все три — ключи адреса); фильтр и порядок — тоже адрес (?page.flt, ?page.ord)."
    >
      {#snippet footer(ctx)}
        Страница <b data-testid="panel-page">{ctx.page}</b>, размер <b data-testid="panel-size">{ctx.pageSize}</b>.
        Фильтр и порядок разбираются на сервере (`parseListInput`), поэтому отказ по ним —
        состояние ошибки списка, а не пустой результат.
      {/snippet}
    </PaginatorSettings>
  {/snippet}

  <ListMeta {showRaw} />
  <LoadingIndicator {name} text="Загружаю страницу…" />
  <ErrorRow {name} />

  <div class="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card" data-testid="rows">
    <div class="flex items-baseline gap-3 px-4 py-2 text-xs text-muted-foreground">
      <span class="min-w-0 flex-1">title</span>
      <span>created_at</span>
      <span>id — скопируйте в поле удаления</span>
    </div>
    <PageList {name}>
      {#snippet renderItem(item: DbPost)}
        <div class="flex items-baseline gap-3 px-4 py-2" data-testid="row">
          <span class="min-w-0 flex-1 truncate">{item.title}</span>
          <span class="text-xs text-muted-foreground">{item.created_at}</span>
          <code class="text-xs text-muted-foreground" data-testid="row-id">{item.id}</code>
        </div>
      {/snippet}
    </PageList>
    <EmptyState {name}>
      <p class="px-4 py-6 text-center text-sm text-muted-foreground">записей нет — добавьте первую формой слева</p>
    </EmptyState>
  </div>

  {#if stream}
    <LoadMoreLink dir={1} {name} />
  {:else}
    <PageNav {name} counter class="flex items-center gap-2 text-sm" />
  {/if}
</PaginatorHost>
