<script lang="ts">
  /**
   * Список seed-юзеров — конечный компонент, а не экран на подаче
   * носителя: он сам запрашивает данные и сам рисует всё своё
   * (заголовок, поиск, фильтры, строки, скелетоны, ожидание). Поэтому
   * он одинаково живёт на странице, в модалке и в шаге админки на
   * хосте шагов, где маршрутного `load` под него нет.
   *
   * Данные — одна точка: `load` роута `/users`. Страница отдаёт свой
   * серверный результат пропсом `initial` (SSR/no-JS целы); остальные
   * носители ничего не приносят — компонент при показе сам зовёт
   * `preloadData` того же роута, а порции догружает источник тем же
   * путём. ACL компонент не рисует: отказ (`fact`) сообщает носителю
   * через `onAcl`, носитель показывает `Acl`.
   *
   * Механика нажатия на строку — не часть списка: её задаёт носитель
   * фабрикой атрибутов `rowAttrs(user)` (по умолчанию — профиль:
   * модалка `user.profile`, без JS роут `/user/<id>`). Та же фабрика
   * ставит другую зарегистрированную пару «модалка + роут» или
   * параметрный выбор между этапами (`asLink` с `?picked=…`) — список
   * и карточка при этом не меняются; каждая механика стоит на `href`.
   * Оформление выбора — `isSelected(id)` снаружи. Шаг подтверждения
   * показывает тех же юзеров срезом адреса `users.ids` (состояние
   * пагинатора): список переспрашивает источник при его смене.
   */
  import { preloadData } from '$app/navigation'
  import { untrack } from 'svelte'
  import { Paginator, SearchBar, Skeleton } from '#components/paginator/index.js'
  import { Button } from '#components/ui/index.js'
  import { cn } from '#components/utils.js'
  import { useModalLink } from '#hooks/links/index.js'
  import type { LinkAttrs } from '#hooks/links/index.js'
  import { PaginatorScope, usePaginatorState } from '#lib/paginate/svelte/index.js'
  import { currentPathname, currentSearch } from '#lib/paginate/sveltekit/router.js'
  import type { AuthErrorCode } from '../error.js'
  import type { SeedUserView } from '../types.js'
  import type { PaginatorState } from '#lib/paginate/index.js'
  import { userSurfaceVariants, type UserSurfaceVariant } from './Acl.svelte'
  import SeedUserCard from './seed-users/SeedUserCard.svelte'
  import {
    ensureSeedUsersPaginator,
    SEED_USERS_EXTRA_DEFAULTS,
    SEED_USERS_FILTER_KEYS,
    SEED_USERS_NAME,
    SEED_USERS_PAGE_PARAM,
    SEED_USERS_PAGE_SIZE,
    type SeedUsersRouteData,
  } from './seed-users/source.js'

  interface Props {
    /** Данные `load` роута от носителя (страница): своего запроса не будет. */
    initial?: SeedUsersRouteData | null
    /** Отказ из собственного запроса: ACL рисует носитель. */
    onAcl?: (fact: AuthErrorCode) => void
    /**
     * Механика строки: атрибуты ссылки на карточку юзера. Задаёт носитель;
     * по умолчанию — профиль (`user.profile`: модалка, без JS — роут).
     */
    rowAttrs?: (user: SeedUserView) => LinkAttrs
    /** Оформление выбранных строк: смысл выбора — у механики носителя. */
    isSelected?: (id: string) => boolean
    variant?: UserSurfaceVariant
    class?: string
  }

  let {
    initial = null,
    onAcl,
    rowAttrs,
    isSelected = (_id: string) => false,
    variant = 'plain',
    class: className,
  }: Props = $props()

  // Регистрация — на стороне компонента, в том же бандле, что и хост пагинатора.
  ensureSeedUsersPaginator()

  const asModalLink = useModalLink()
  const attrsOf = (user: SeedUserView): LinkAttrs =>
    rowAttrs?.(user) ?? { ...asModalLink('user.profile', { id: user.id }), title: 'Открыть профиль' }

  let data = $state<SeedUsersRouteData | null>(untrack(() => initial))
  // Срез по списку id (`users.ids` адреса — шаг подтверждения выбора):
  // адресное состояние пагинатора, а не проп: адаптер всё равно ведёт
  // истину из адреса, и отдельный канал среза с ним бы спорил. Сменился
  // набор — список переспрашивает источник, стор принимает новый
  // снапшот (идентичность объекта).
  const sliceIds = $derived(String(currentSearch()[`${SEED_USERS_PAGE_PARAM}.ids`] ?? ''))
  let askedFor: string | null = null

  $effect(() => {
    if (initial) {
      data = initial
      return
    }
    const key = sliceIds
    if (askedFor === key) return
    askedFor = key
    // Запрос — на адрес носителя как есть: все ключи `users.*` текущего
    // адреса (срез, страница, фильтры) `load` разберёт в тот же срез,
    // что видит адаптер пагинатора.
    const sp = new URLSearchParams()
    for (const [k, v] of Object.entries(currentSearch())) {
      if (k === SEED_USERS_PAGE_PARAM || k.startsWith(`${SEED_USERS_PAGE_PARAM}.`)) sp.set(k, String(v))
    }
    const target = sp.size ? `/users?${sp.toString()}` : '/users'
    void (async () => {
      const r = await preloadData(target)
      if (r.type !== 'loaded') {
        // Гостя увели редиректом на вход: носителю — сессионный отказ.
        onAcl?.('auth.expired')
        return
      }
      const d = r.data as SeedUsersRouteData
      if (d.fact) {
        onAcl?.(d.fact)
        return
      }
      data = d
    })()
  })

  const snapshot = $derived(data?.snapshot ?? null)

  const pagState = usePaginatorState<SeedUserView>(SEED_USERS_NAME)
  const query = $derived(
    typeof pagState().extra?.q === 'string' ? (pagState().extra.q as string) : '',
  )
  // Счётчик — только реальные отличия от среза по умолчанию: URL-адаптер
  // материализует дефолты (`ord=created-desc`, `state=active`) в `extra`,
  // и без этого сравнения кнопка вечно показывала бы «(2)» на чистом списке.
  // Размер порции живёт не в `extra`, а в состоянии пагинатора — его
  // отличие от умолчания считается отдельным слагаемым.
  const activeFilters = $derived(
    SEED_USERS_FILTER_KEYS.filter((k) => {
      const v = pagState().extra?.[k]
      const fallback = (SEED_USERS_EXTRA_DEFAULTS as Record<string, string>)[k]
      return typeof v === 'string' && v !== '' && v !== fallback
    }).length + (pagState().pageSize !== SEED_USERS_PAGE_SIZE ? 1 : 0),
  )
  // Параметр никнейма включён текущим срезом (ключ `nick` адреса) — подпись
  // поиска обещает и никнейм. Право и сам столбец решает сервер.
  const nickOn = $derived(pagState().extra?.nick === '1')
  // «Всего» — из живого состояния пагинатора: снапшот `load` честен только
  // на первой порции, дальше срез (поиск/фильтры) меняет totals без SSR.
  const totalItems = $derived(pagState().totalItems ?? snapshot?.totalItems)
  // No-JS адрес кнопки фильтров: страница `/users/filters`, которой текущий
  // адрес носителя уходит параметром `from` — форма вернёт GET именно сюда
  // (список может жить на любой странице и в модалке), а не на фиксированный
  // роут. Текущие фильтры страница прочитает из того же `from`.
  const filtersHref = $derived.by(() => {
    const qs = new URLSearchParams(
      Object.entries(currentSearch()).map(([k, v]) => [k, String(v)] as [string, string]),
    )
    const from = currentPathname() + (qs.size ? `?${qs}` : '')
    return `/users/filters?from=${encodeURIComponent(from)}`
  })
</script>

{#if snapshot}
  <PaginatorScope snapshots={{ [SEED_USERS_NAME]: snapshot }}>
  <section class={cn(userSurfaceVariants({ variant }), className)}>
    <div class="mb-4 flex items-baseline justify-between gap-3">
      <h2 class="text-lg font-semibold leading-tight tracking-tight">Seed-юзеры</h2>
      <span class="text-xs text-muted-foreground">всего: {totalItems ?? '—'}</span>
    </div>
    <div class="mb-3 flex items-start justify-between gap-3">
      <div class="min-w-0 flex-1">
        <SearchBar
          name={SEED_USERS_NAME}
          {query}
          label={nickOn ? 'Поиск по seed, id и никнейму' : 'Поиск по seed и id'}
          placeholder={nickOn ? 'Подстрока seed, id или никнейма…' : 'Подстрока seed или id…'}
        />
      </div>
      <Button
        {...asModalLink('user.list.filters', {}, { href: filtersHref })}
        variant="outline"
        data-testid="seed-users-filters-open"
      >
        Фильтры{#if activeFilters}&nbsp;({activeFilters}){/if}
      </Button>
    </div>
    <Paginator
      name={SEED_USERS_NAME}
      ariaLabel="Список seed-юзеров"
      {snapshot}
      mode="accumulate"
      topTrigger="direction"
      bottomTrigger="direction"
      topZone="40%"
      bottomZone="40%"
      renderDivider={null}
      class="max-h-[420px]"
    >
      {#snippet renderItem(item: SeedUserView)}
        <!-- Механика — атрибуты снаружи на ссылке-обёртке; карточка внутри
             только рисует юзера и о нажатии не знает. -->
        <a
          {...attrsOf(item)}
          class="block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="seed-user-row"
          data-id={item.id}
          data-selected={isSelected(item.id) || undefined}
        >
          <SeedUserCard {item} selected={isSelected(item.id)} />
        </a>
      {/snippet}
      {#snippet renderSkeleton()}
        <!--
          Скелетон повторяет геометрию строки списка, а не один серый блок:
          те же сегменты, что у SeedUserCard. Блок никнейма — только при
          включённом параметре: выключен — у скелетона его нет, как нет
          столбца у настоящих строк.
        -->
        <div class="flex w-full items-center gap-3 px-2 py-2" data-testid="seed-user-skeleton">
          <Skeleton class="h-4 min-w-0 flex-1 basis-0" />
          {#if nickOn}
            <span class="min-w-0 flex-1 basis-0" data-testid="seed-user-skeleton-nickname">
              <Skeleton class="h-3 w-full" />
            </span>
          {/if}
          <Skeleton class="h-3 min-w-0 flex-1 basis-0" />
          <Skeleton class="h-3 min-w-0 flex-1 basis-0" />
          <Skeleton class="h-3 min-w-0 flex-1 basis-0" />
        </div>
      {/snippet}
    </Paginator>
  </section>
  </PaginatorScope>
{:else}
  <!-- Собственное ожидание компонента: носителю скелет списка не положен. -->
  <section class={cn(userSurfaceVariants({ variant }), className)} data-testid="seed-users-pending" aria-busy="true">
    <div class="mb-4 flex items-baseline justify-between gap-3">
      <h2 class="text-lg font-semibold leading-tight tracking-tight">Seed-юзеры</h2>
      <span class="text-xs text-muted-foreground">всего: —</span>
    </div>
    <div class="flex flex-col gap-2">
      {#each [0, 1, 2] as i (i)}
        <Skeleton class="h-9 w-full" />
      {/each}
    </div>
  </section>
{/if}
