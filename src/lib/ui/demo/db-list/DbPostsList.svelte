<script lang="ts">
  /**
   * Список демо — обычный потребитель `$lib/paginate`: строки рисует `PageList`,
   * навигацию и настройки — компоненты `$lib/ui/paginator`. Своего `slice`, своих
   * ссылок «дальше» и своего чтения адреса здесь нет: адрес принадлежит
   * пагинатору (`?page`, `?page.size`, `?page.ord`, `?page.cur`, `?page.after`).
   *
   * Способ навигации — одна опция панели, `Курсор вместо номеров страниц`
   * (`?page.cur=1`). Выключен: `PageNav` со списком номеров, REPLACE, `?page=N`.
   * Включён: список накапливается, указатель следующего шага — подписанный
   * токен слоя в адресе (`?page.after=…`), поэтому «дальше» остаётся обычной
   * ССЫЛКОЙ и работает без JavaScript; номеров нет, потому что keyset-шаг не
   * знает, сколько страниц впереди (источник в этом режиме честно объявляет
   * `totals: false`, и панель с навигацией гасят их сами).
   *
   * Различается только взаимодействие: источник, размер страницы, порядок и
   * фильтр на оба режима одни — тот же `queryPage` на сервере.
   */
  import { PaginatorHost, usePaginatorState } from '$lib/paginate/svelte'
  import type { PaginatorState } from '$lib/paginate'
  import {
    EmptyState,
    EndRow,
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
    DB_LIST_NAME,
    DB_LIST_PAGE_SIZES,
    dbListExtraOf,
    ensureDbListPaginator,
    isCursorOn,
    type DbListExtra,
    type DbPost,
  } from './definition'
  import DbPostRow from './DbPostRow.svelte'
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

  // Имя здесь обязательно: этот вызов — ВНЕ области видимости `<PaginatorHost>`
  // (он рисует хост, а не живёт внутри него), контекста ещё нет. `ListMeta`,
  // который находится внутри хоста, наоборот, имени не принимает — иначе
  // молча читал бы чужой стор, если демо вставят в другую страницу.
  const state = usePaginatorState<DbPost>(name)
  /**
   * Режим на первой отрисовке берётся из ТОГО ЖЕ источника, что и строки: на
   * сервере стор вне области видимости хоста пуст (снапшот живёт в хосте), поэтому
   * значение доится из снимка лоадера. Иначе `?page.cur=true` дал бы расхождение
   * SSR/клиента — ровно то, о чём предупреждает `snapshotSafeError`.
   */
  const cursor = $derived(isCursorOn(state().extra) || isCursorOn(snapshot?.extra))

  /**
   * Панель — данные (`SettingsField[]`), а не разметка: компилятор панели
   * строит из них форму `lib/form` и гасит то, что не может работать без JS.
   * Порядок и размер страницы — скалярные ключи адреса, поэтому no-JS они
   * работают как обычные контролы GET-формы.
   */
  const FIELDS: readonly SettingsField<DbListExtra>[] = [
    {
      key: 'ord',
      label: 'Сортировка',
      type: 'select',
      // Значение — ровно то, что кладётся в `?page.ord`: JSON-спека порядка слоя.
      // «Как в слое» отдельным значением, а не пустой строкой: снятие выбора должно
      // быть выразимо (пустое поле панели означает «ключ не трогать»).
      options: [
        ['default', 'Как в слое (created_at ↓, затем id ↑)'],
        ['[["created_at","asc"]]', 'Сначала старые (created_at ↑)'],
        ['[["title","asc"]]', 'По названию A→Я'],
        ['[["title","desc"]]', 'По названию Я→A'],
      ],
    },
    { key: 'cur', label: 'Курсор вместо номеров страниц', type: 'toggle' },
  ]
</script>

<!--
  Триггеры края — то, чем «курсор» отличается от «страниц» практически: в
  курсорном режиме внизу живёт ручной «показать ещё» (bottomTrigger="manual"), а
  сверху ничего: обратного указателя у keyset-шага нет, и ссылка «назад» вела бы не
  туда. В постраничном режиме оба триггера выключены, чтобы рядом с `PageNav` не
  выросла вторая навигация. Без явного `manual`/`always` ссылка не рисуется вовсе
  (`LoadMoreSlot.svelte: if (!always && trig !== 'manual') return false`) — значит,
  «ссылки нет» здесь не отказ слоя, а дефолт хоста, и его нужно задать самому.
-->
<PaginatorHost
  {name}
  {snapshot}
  mode={cursor ? 'accumulate' : 'single'}
  topTrigger="off"
  bottomTrigger={cursor ? 'manual' : 'off'}
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
      noscriptHint="Без JavaScript работают размер страницы, сортировка и режим курсора — все три ключи адреса (?page.size, ?page.ord, ?page.cur). Указатель следующего шага (?page.after) сервер выдаёт подписанным, поэтому ссылка «дальше» ведёт туда же, куда клик с JavaScript."
    >
      {#snippet footer(ctx)}
        Страница <b data-testid="panel-page">{ctx.page}</b>, размер <b data-testid="panel-size">{ctx.pageSize}</b>.
        Фильтр, порядок и подпись токена разбирает сервер (`parseListInput`), поэтому отказ по ним —
        состояние ошибки списка, а не пустой результат.
        {#if !cursor}
          Указатель следующего шага в адресе появляется, когда включён курсорный режим.
        {:else}
          Токен живёт 30 минут (`DB_CURSOR_TTL_SECONDS`): старая ссылка отдаст отказ,
          а не чужую страницу.
        {/if}
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
        <!--
          Компонент общий с демо-пагинатором: `full` здесь включает полный id и метку
          `row-id`, потому что на этой странице id копируют в форму удаления.
        -->
        <DbPostRow {item} full />
      {/snippet}
    </PageList>
    <EmptyState {name}>
      <p class="px-4 py-6 text-center text-sm text-muted-foreground">записей нет — добавьте первую формой слева</p>
    </EmptyState>
  </div>

  {#if cursor}
    <LoadMoreLink dir={1} {name}>
      {#snippet label(p)}
        <!--
          Подпись говорит про токен: это не «страница N из M», продолжения без
          указателя не существует, и врать про номера здесь — значит портить
          проверку «что именно загрузки, а не перезагрузки».
        -->
        <span data-testid="cursor-next">↓ дальше по указателю{#if p.href} (ссылка без JS){/if}</span>
      {/snippet}
    </LoadMoreLink>
    <EndRow {name} />
  {:else}
    <PageNav {name} counter class="flex items-center gap-2 text-sm" />
  {/if}
</PaginatorHost>
