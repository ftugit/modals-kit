<script lang="ts" module>
  // Изменяется только в клиентских эффектах, никогда в SSR.
  let lastPrincipal: string | null | undefined = undefined
</script>

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
  import { onDestroy, untrack } from 'svelte'
  import { Paginator, SearchBar, Skeleton } from '#components/paginator/index.js'
  import { Button, Surface } from '#components/ui/index.js'
  import { cn } from '#components/utils.js'
  import { useModalLink, type LinkAttrs } from '#hooks/links/index.js'
  import { useSlotPaginatorScope } from '#hooks/modal-paginator.svelte.js'
  import { preloadData } from '$app/navigation'
  import {
    acquireScopedStore,
    createPaginatorStore,
    getClientStore,
    invalidatePaginator,
    releaseScopedStore,
  } from '#lib/paginate/index.js'
  import { PaginatorScope, usePaginatorState } from '#lib/paginate/svelte/index.js'
  import { currentPathname, currentSearch } from '#lib/paginate/sveltekit/router.js'
  import { vault } from '../vault.svelte.js'
  import type { AuthErrorCode } from '../error.js'
  import type { SeedUserView } from '../types.js'
  import type { UserSurfaceVariant } from './Acl.svelte'
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
    /** Данные `load` роута от носителя (страница/модалка): своего запроса не будет. */
    initial?: SeedUsersRouteData | null
    /**
     * Явный ключ изолированной области пагинатора (для немодальных стендов).
     * Внутри модалки область и URL-префикс (`m<k>.*`) выделяются автоматически
     * через `useSlotPaginatorScope`.
     */
    scope?: string | null
    /** Синхронизировать состояние пагинатора с адресной строкой (`false` для `user.picker`). */
    url?: boolean
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
    scope = null,
    url: urlProp,
    onAcl,
    rowAttrs,
    isSelected = (_id: string) => false,
    variant = 'plain',
    class: className,
  }: Props = $props()

  $effect(() => {
    const current = vault.principal
    if (lastPrincipal === undefined) { lastPrincipal = current; return }
    if (lastPrincipal !== current) {
      lastPrincipal = current
      untrack(() => { void invalidatePaginator(SEED_USERS_NAME) })
    }
  })

  // Регистрация — на стороне компонента, в том же бандле, что и хост пагинатора.
  ensureSeedUsersPaginator()

  const slotScope = useSlotPaginatorScope(
    SEED_USERS_NAME,
    untrack(() => (urlProp === false ? { url: false } : undefined)),
  )
  const effectivePaginatorUrl = $derived(urlProp !== undefined ? urlProp : slotScope.paginatorUrl)

  const asModalLink = useModalLink()
  const attrsOf = (user: SeedUserView): LinkAttrs =>
    rowAttrs?.(user) ?? { ...asModalLink('user.profile', { id: user.id }), title: 'Открыть профиль' }

  let data = $state<SeedUsersRouteData | null>(untrack(() => initial))
  const sliceIds = $derived(
    effectivePaginatorUrl === false
      ? ''
      : String(currentSearch()[`${SEED_USERS_PAGE_PARAM}.ids`] ?? ''),
  )
  let askedFor: string | null = null

  $effect(() => {
    if (initial) {
      data = initial
      if (initial.fact) onAcl?.(initial.fact)
      return
    }
    const key = sliceIds
    if (askedFor === key) return
    askedFor = key
    const sp = new URLSearchParams()
    if (effectivePaginatorUrl !== false) {
      for (const [k, v] of Object.entries(currentSearch())) {
        if (k === SEED_USERS_PAGE_PARAM || k.startsWith(`${SEED_USERS_PAGE_PARAM}.`)) sp.set(k, String(v))
      }
    }
    const target = sp.size ? `/users?${sp.toString()}` : '/users'
    void (async () => {
      const r = await preloadData(target)
      if (r.type !== 'loaded') {
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

  // Область пагинатора: в модалке — слотовый `ScopedStore`, с ручным `scope` —
  // отдельное хранилище, на странице — клиентский стор.
  const scopeKey = untrack(() => (slotScope.store ? null : scope))
  const store = untrack(() =>
    slotScope.store
      ? slotScope.store
      : scopeKey
        ? acquireScopedStore(scopeKey)
        : typeof window === 'undefined'
          ? createPaginatorStore()
          : getClientStore(),
  )
  if (scopeKey) onDestroy(() => releaseScopedStore(scopeKey))

  const pagState = usePaginatorState<SeedUserView>(SEED_USERS_NAME, store)
  const hasLivePages = $derived(
    Object.keys(pagState().pages).length > 0 || pagState().status !== 'idle' || pagState().reqId > 0,
  )
  const liveExtra = $derived(hasLivePages ? pagState().extra : (snapshot?.extra ?? pagState().extra))
  const livePageSize = $derived(
    hasLivePages ? pagState().pageSize : (snapshot?.pageSize ?? pagState().pageSize),
  )

  const query = $derived(
    typeof liveExtra?.q === 'string' ? (liveExtra.q as string) : '',
  )
  const activeFilters = $derived(
    SEED_USERS_FILTER_KEYS.filter((k) => {
      const v = liveExtra?.[k]
      const fallback = (SEED_USERS_EXTRA_DEFAULTS as Record<string, string>)[k]
      return typeof v === 'string' && v !== '' && v !== fallback
    }).length + (livePageSize !== SEED_USERS_PAGE_SIZE ? 1 : 0),
  )
  const nickOn = $derived(liveExtra?.nick === '1')
  const totalItems = $derived(hasLivePages ? (pagState().totalItems ?? snapshot?.totalItems) : snapshot?.totalItems)
  const filtersHref = $derived.by(() => {
    const qs = new URLSearchParams(
      Object.entries(currentSearch()).map(([k, v]) => [k, String(v)] as [string, string]),
    )
    const from = currentPathname() + (qs.size ? `?${qs}` : '')
    return `/users/filters?from=${encodeURIComponent(from)}`
  })
</script>

{#snippet seedTitle()}
  <h2 class="text-lg font-semibold leading-tight tracking-tight">Seed-юзеры</h2>
  <span class="text-xs text-muted-foreground">всего: {totalItems ?? '—'}</span>
{/snippet}

{#snippet seedControls()}
  <Button
    {...asModalLink('user.list.filters', {}, { href: filtersHref })}
    variant="outline"
    size="sm"
    data-testid="seed-users-filters-open"
  >
    Фильтры{#if activeFilters}&nbsp;({activeFilters}){/if}
  </Button>
{/snippet}

{#if snapshot}
  <PaginatorScope {store} snapshots={{ [SEED_USERS_NAME]: snapshot }}>
  <Surface {variant} class={cn('min-h-0', className)} title={seedTitle} controls={seedControls}>
    <SearchBar
      name={SEED_USERS_NAME}
      {query}
      label={nickOn ? 'Поиск по seed, id и никнейму' : 'Поиск по seed и id'}
      placeholder={nickOn ? 'Подстрока seed, id или никнейма…' : 'Подстрока seed или id…'}
    />
    <Paginator
      name={SEED_USERS_NAME}
      ariaLabel="Список seed-юзеров"
      {snapshot}
      url={effectivePaginatorUrl}
      mode="accumulate"
      topTrigger="direction"
      bottomTrigger="direction"
      topZone="40%"
      bottomZone="40%"
      renderDivider={null}
      class={variant === 'plain' && slotScope.store !== null ? 'min-h-0 flex-1' : 'max-h-[420px]'}
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
  </Surface>
  </PaginatorScope>
{:else}
  <!-- Собственное ожидание компонента: носителю скелет списка не положен. -->
  <Surface {variant} class={className} data-testid="seed-users-pending" aria-busy="true">
    {#snippet title()}
      <h2 class="text-lg font-semibold leading-tight tracking-tight">Seed-юзеры</h2>
      <span class="text-xs text-muted-foreground">всего: —</span>
    {/snippet}
    <div class="flex flex-col gap-2">
      {#each [0, 1, 2] as i (i)}
        <Skeleton class="h-9 w-full" />
      {/each}
    </div>
  </Surface>
{/if}
