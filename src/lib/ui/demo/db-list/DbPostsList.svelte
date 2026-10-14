<script lang="ts">
  /**
   * Список демо — обычный потребитель `#lib/paginate/index.js`: строки рисует `PageList`,
   * навигацию и настройки — компоненты `#lib/ui/paginator/index.js`. Своего `slice`, своих
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
   *
   * Оптимистичная карточка (`optimistic`) рисуется ОТТУДА ЖЕ, откуда строки, и тем
   * же компонентом строки, но в состояние источника не попадает: у неё нет
   * `created_at`, она не участвует в `totalItems` и в указателе следующего шага.
   * Место — по порядку сортировки (`pendingPlacement`), исчезает — когда настоящая
   * строка приехала в окно (`isAbsorbed`).
   */
  import { PaginatorHost, usePaginatorActions, usePaginatorState } from '#lib/paginate/svelte/index.js'
  import { onDestroy, untrack } from 'svelte'
  import type { PaginatorState } from '#lib/paginate/index.js'
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
  } from '#lib/ui/paginator/index.js'
  // ИМПОРТ ЗНАЧЕНИЯ, а не типа: пагинатор обязан быть зарегистрирован в том же
  // бандле, где рендерится хост. Иначе клиент падает на гидрации с
  // «Unknown paginator» (registry.ts), а SSR этого не видит.
  import {
    DB_LIST_LIVE_KEY,
    DB_LIST_NAME,
    DB_LIST_PAGE_SIZES,
    dbListExtraOf,
    ensureDbListPaginator,
    type DbListExtra,
    type DbPost,
    type DbPostsFresh,
    type FailureMode,
  } from './definition'
  import { createLive } from './live.svelte'
  import { freshLabel, freshUrl, mergeFresh } from './fresh'
  import { isAbsorbed, ownRowPlacement, pendingPlacement, type Optimistic } from './optimistic.svelte'
  import DbPostPendingRow from './DbPostPendingRow.svelte'
  import DbPostRow from './DbPostRow.svelte'
  import Button from '#lib/ui/primitives/Button.svelte'
  import ListMeta from './ListMeta.svelte'
  import { useCursorMode } from './cursor-mode.svelte'

  interface Props {
    /** SSR-снапшот из лоадера: без JavaScript список виден целиком. */
    snapshot?: PaginatorState<DbPost> | null
    /** Первая строка как пришла из слоя — технический блок демо. */
    showRaw?: boolean
    /** Оптимистичные строки формы добавления; без неё список чисто серверный. */
    optimistic?: Optimistic | null
  }

  let { snapshot = null, showRaw = true, optimistic = null }: Props = $props()

  // Регистрация на стороне компонента — так же, как в демо пагинатора
  // (`routes/(site)/(app)/paginator/+page.svelte`): тело родителя выполняется до
  // инициализации `<PaginatorHost>`, поэтому хост заведомо видит экземпляр.
  // Функция идемпотентна (guard `hasPaginator`).
  ensureDbListPaginator()
  const name = DB_LIST_NAME

  /**
   * Режим и уборка указателя — общий хук (`useCursorMode`): тот же код служит
   * этой странице и пункту «БД» в демо-пагинаторе, поэтому «сняли курсор →
   * адрес честный» не может оказаться правдой только на одной из них.
   *
   * Имя здесь обязательно: этот вызов — ВНЕ области видимости `<PaginatorHost>`
   * (он рисует хост, а не живёт внутри него), контекста ещё нет. `ListMeta`,
   * который находится внутри хоста, наоборот, имени не принимает — иначе
   * молча читал бы чужой стор, если демо вставят в другую страницу.
   */
  const cursorOn = useCursorMode(name, () => snapshot)
  const cursor = $derived(cursorOn())

  /**
   * Порядок и режим отказа — из состояния пагинатора, а не из пропов: панель пишет
   * их в extra, и только там они совпадают с тем, что реально ушло на сервер.
   * Снимок лоадера участвует как страховка на первом рендере (до гидрации).
   */
  const listState = usePaginatorState<DbPost>(name)
  const extra = $derived(
    dbListExtraOf({ ...snapshot?.extra, ...listState().extra } as Record<string, unknown>),
  )
  const place = $derived(pendingPlacement(extra.ord))
  /** Карточки, которые ещё не приехали из источника. `settled` тоже считается. */
  const cards = $derived.by(() => {
    if (!optimistic) return []
    // `pages` — отображение номера в окно строк; «видимые» = всё, что накоплено
    // (в accumulate-режиме окно живёт под первым ключом, и flat() это ловит).
    const visible = Object.values(listState().pages ?? {}).flat() as DbPost[]
    return optimistic.list().filter((c) => !isAbsorbed(c, visible))
  })
  // Опция панели доходит до формы одним числом: в момент отказа store читает
  // последнее значение — гонка «меняю тумблер и жму отправить» здесь означает
  // «повезло или не повезло», и прятать это за доступором смысла нет.
  $effect(() => optimistic?.setFailureMode(extra.err as FailureMode))

  const actions = usePaginatorActions(name)

  /**
   * Живой список — опрос «что появилось» (`fresh.ts`), а не переспрос окна.
   * Ответ — строки новее отметки под фильтром выдачи; известные (в окне, свои)
   * отсеиваются. Что делать с остальными — правило «держать край» (LIVE-APPEND
   * Р7): в курсорном режиме при порядке «новые сверху» и читателе у начала
   * (порог 100 px) строки встают в голову окна сразу (`patchItems`, без
   * перезагрузки). Иначе — пилюля с числом: читатель ушёл от начала или место
   * строк в этом режиме знает только сервер, и двигать ему выдачу без просьбы
   * нельзя. Клик по пилюле: курсор — те же строки в голову и наверх; страницы —
   * сброс на первую (номера страниц после вставки сверху всё равно сдвинулись).
   */
  const visibleIds = $derived(new Set((Object.values(listState().pages ?? {}).flat() as DbPost[]).map((r) => r.id)))
  /** Вставка в голову уместна: накопление и порядок по `created_at ↓`. */
  const canPrepend = $derived(cursor && ownRowPlacement({ ord: extra.ord }) === 'head')
  let mark = $state<string | null | undefined>(undefined)
  let markId: string | null = null
  let waiting = $state<DbPost[]>([])
  /** Ожидающие, которых читатель ещё не видит (мог дойти до них сам). */
  const unseen = $derived(waiting.filter((r) => !visibleIds.has(r.id)))
  const atTop = (): boolean => typeof window !== 'undefined' && window.scrollY <= 100

  /** Отметка заново: после сброса или смены выдачи старая говорит о другом списке. */
  function rebaseline(): void {
    mark = undefined
    markId = null
    waiting = []
    live.poke()
  }

  function prependWaiting(): void {
    const rows = unseen
    // Старые первыми: каждая вставка встаёт перед предыдущей — итог «свежие сверху».
    for (const r of [...rows].reverse()) actions.patchItems<DbPost>({ insert: r, at: 'head' })
    if (rows[0]) {
      mark = rows[0].created_at
      markId = rows[0].id
    }
    waiting = []
  }

  function showWaiting(): void {
    if (canPrepend) prependWaiting()
    else {
      actions.reset()
      rebaseline()
    }
    window.scrollTo({ top: 0 })
  }

  const live = createLive({
    url: () => (extra.live ? freshUrl(extra.flt, mark) : null),
    onData: (body) => {
      const b = body as DbPostsFresh
      if ('mark' in b) {
        mark = b.mark ?? null
        markId = b.markId ?? null
        waiting = []
        return
      }
      waiting = mergeFresh(waiting, b.items ?? [], {
        markId,
        known: (id) => visibleIds.has(id) || (optimistic?.own(id) ?? false),
      })
      if (unseen.length && canPrepend && atTop()) prependWaiting()
    },
  })
  $effect(() => {
    if (extra.live) {
      live.start()
      untrack(rebaseline)
    } else {
      live.stop()
      untrack(() => {
        mark = undefined
        waiting = []
      })
    }
  })
  // Выдача сменилась (фильтр, порядок, режим) — отметка относится к прошлой.
  let viewKey = ''
  $effect(() => {
    const key = `${extra.flt ?? ''}|${extra.ord}|${cursor}`
    if (viewKey && key !== viewKey && untrack(() => extra.live)) untrack(rebaseline)
    viewKey = key
  })
  onDestroy(() => live.stop())

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
    {
      key: DB_LIST_LIVE_KEY,
      label: 'Следить за новыми (опрос раз в 2 с)',
      type: 'toggle',
    },
    {
      key: 'err',
      label: 'При отказе записи',
      type: 'select',
      options: [
        ['retry', 'Оставить карточку с кнопкой «повторить»'],
        ['remove', 'Убрать карточку из списка'],
      ],
    },
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
      fallbackHint="Пока JavaScript не загружен, работают размер страницы, сортировка и режим курсора — все три ключи адреса (?page.size, ?page.ord, ?page.cur). Указатель следующего шага (?page.after) сервер выдаёт подписанным, поэтому ссылка «дальше» ведёт туда же, куда клик с JavaScript."
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

  {#if extra.live}
    <!-- Состояние опроса видно текстом: «тихий» live-режим неотличим от сломанного,
         а проверять «пауза на скрытой вкладке» иначе было бы нечем. -->
    <p class="flex items-center gap-2 text-xs text-muted-foreground" data-testid="live-state">
      <span>опрос новых: {live.stats().ticks} тиков{#if live.stats().errors}, сбоев {live.stats().errors}{/if}</span>
      {#if unseen.length}
        <Button variant="outline" size="xs" data-testid="live-pill" onclick={showWaiting}>{freshLabel(unseen.length)}</Button>
      {/if}
    </p>
  {/if}

  <ListMeta {showRaw} />
  <LoadingIndicator {name} text="Загружаю страницу…" />
  <ErrorRow {name} />

  <div class="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card" data-testid="rows">
    <div class="flex items-baseline gap-3 px-4 py-2 text-xs text-muted-foreground">
      <span class="min-w-0 flex-1">title</span>
      <span>created_at</span>
      <span>id — скопируйте в поле удаления</span>
    </div>
    {#if place === 'head'}
      {#each cards as card (card.tmpId)}
        <DbPostPendingRow {card} {optimistic} />
      {/each}
    {/if}
    <PageList {name}>
      {#snippet renderItem(item: DbPost)}
        <!--
          Компонент общий с демо-пагинатором: `full` здесь включает полный id и метку
          `row-id`, потому что на этой странице id копируют в форму удаления.
        -->
        <DbPostRow {item} full />
      {/snippet}
    </PageList>
    {#if place === 'tail'}
      {#each cards as card (card.tmpId)}
        <DbPostPendingRow {card} {optimistic} />
      {/each}
    {/if}
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
