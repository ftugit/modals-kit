<script lang="ts">
  /**
   * Список seed-юзеров поверх `Listing`.
   *
   * Данные — один `load` роута `/users`. Страница отдаёт его пропсом `initial`;
   * модалка и шаг без `load` ничего не приносят — оболочка сама зовёт тот же
   * роут. Отказ (`fact`) уходит носителю через `onAcl`, `Acl` рисует он.
   *
   * Нажатие задаёт носитель фабрикой `rowAttrs`. По умолчанию — профиль.
   * Выбор красит `isSelected`. Срез `users.ids` переспрашивает первую порцию.
   */
  import { onDestroy, untrack } from 'svelte'
  import { browser } from '$app/env'
  import { visibleAddress } from '#lib/address/sveltekit.js'
  import type { SidebarPlace } from '#components/shell/index.js'
  import { Listing, ListingRow } from '#components/listing/index.js'
  import { Skeleton } from '#components/paginator/index.js'
  import { grants } from '#lib/db/index.js'
  import { acquireScopedStore, getClientStore, getState, releaseScopedStore, setExtra } from '#lib/paginate/index.js'
    import { useModalLink, type LinkAttrs } from '#hooks/links/index.js'
  import { useSlotPaginatorScope } from '#hooks/modal-paginator.svelte.js'
  import { sessionsJournalRoute } from '../routes.js'
  import type { AuthErrorCode } from '../error.js'
  import { useGrants } from '../grants.svelte.js'
  import { auth as authResource, profile as profileResource } from '../schema.js'
  import type { SeedUserView } from '../types.js'
  import { vault } from '../vault.svelte.js'
  import { session as sessionResource } from '../schema.js'
  import { Button } from '#components/ui/index.js'
  import type { UserSurfaceVariant } from './Acl.svelte'
  import SeedUsersFiltersForm, { type SeedUsersFilterValues } from './SeedUsersFiltersForm.svelte'
  import { seedFilterLabels, seedFilterText } from './seed-users/filters-form.js'
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
     * Внутри модалки область выделяется автоматически.
     */
    scope?: string | null
    /** Синхронизировать состояние пагинатора с адресной строкой (`false` для `user.picker`). */
    url?: boolean
    /** Отказ из собственного запроса: ACL рисует носитель. */
    onAcl?: (fact: AuthErrorCode) => void
    /** Механика строки. По умолчанию — профиль (`user.profile`, без JS — роут). */
    rowAttrs?: (user: SeedUserView) => LinkAttrs
    /** Оформление выбранных строк: смысл выбора — у механики носителя. */
    isSelected?: (id: string) => boolean
    variant?: UserSurfaceVariant
    class?: string
    /** Зона sidebar. Страница передаёт, модалка — нет. */
    sidebar?: SidebarPlace
  }

  let {
    initial = null,
    scope = null,
    url = undefined,
    onAcl,
    rowAttrs,
    isSelected,
    variant = 'plain',
    class: className,
    sidebar,
  }: Props = $props()

  // Регистрация — в том же бандле, что и хост пагинатора внутри `Listing`.
  ensureSeedUsersPaginator()

  // Вход в журнал сессий — только тому, кто вправе читать чужие устройства
  // (круг журнала). Право смотрит та же модель, что и сам экран.
  const gSession = grants(sessionResource)
  const readSessionsGrant = useGrants(gSession.select)
  // Адрес журнала — из реестра: вшитая строка расходится с роутом при его правке.
  const journalHref = $derived(sessionsJournalRoute.href())

  const canReadSessions = $derived(readSessionsGrant.current)

  const asModalLink = useModalLink()
  const attrsOf = (user: SeedUserView): LinkAttrs =>
    rowAttrs?.(user) ?? { ...asModalLink('user.profile', { id: user.id }), title: 'Открыть профиль' }

  const nickOn = (extra: Record<string, unknown>) => extra.nick === '1'

  const sidebarZone = untrack(() => sidebar)
  const filterSlot = sidebarZone
    ? useSlotPaginatorScope(SEED_USERS_NAME, untrack(() => (url === false ? { url: false } : undefined)))
    : undefined
  const filterScope = sidebarZone ? untrack(() => scope) : null
  const ownedScope = Boolean(sidebarZone && filterScope && !filterSlot?.store && browser)
  const filterStore = sidebarZone
    ? (filterSlot?.store ??
      (ownedScope && filterScope
        ? acquireScopedStore(filterScope)
        : browser
          ? getClientStore()
          : undefined))
    : undefined
  if (ownedScope && filterScope) onDestroy(() => releaseScopedStore(filterScope))
  const listFrom = $derived.by(() => {
    const url = visibleAddress().url
    return `${url.pathname}${url.search}`
  })
  let appliedValues = $state<SeedUsersFilterValues | null>(seedFrom(untrack(() => initial)))
  let appliedKey = $state('')
  const seedCaps = useGrants({
    canSeeDeleted: grants(authResource).selectDeleted,
    canSeeNickname: grants(profileResource).select,
  })
  const canSeeDeleted = $derived(
    vault.principal !== null ? seedCaps.canSeeDeleted : initial?.canSeeDeleted === true,
  )
  const canSeeNickname = $derived(
    vault.principal !== null ? seedCaps.canSeeNickname : initial?.canSeeNickname === true,
  )

  function seedFrom(data: SeedUsersRouteData | null): SeedUsersFilterValues | null {
    const snap = data?.snapshot
    if (!snap) return null
    return seedValues((snap.extra ?? {}) as Record<string, unknown>, snap.pageSize || SEED_USERS_PAGE_SIZE)
  }

  function seedValues(extra: Record<string, unknown>, pageSize: number): SeedUsersFilterValues {
    const s = (key: string) => (typeof extra[key] === 'string' ? extra[key] : '')
    return {
      ord: s('ord') || 'created-desc',
      state: s('state') || 'active',
      cfrom: s('cfrom'),
      cto: s('cto'),
      dfrom: s('dfrom'),
      dto: s('dto'),
      nick: s('nick') === '1',
      size: pageSize || SEED_USERS_PAGE_SIZE,
    }
  }

  $effect(() => {
    if (!filterStore) return
    const sync = () => {
      const state = getState<SeedUserView>(filterStore, SEED_USERS_NAME)
      const extra = (state.extra ?? {}) as Record<string, unknown>
      const pageSize = state.pageSize || SEED_USERS_PAGE_SIZE
      appliedValues = seedValues(extra, pageSize)
      appliedKey = SEED_USERS_FILTER_KEYS.map((key) => String(extra[key] ?? '')).join('|') + '|' + pageSize
    }
    sync()
    const unsub = filterStore.subscribe?.(SEED_USERS_NAME, sync)
    return () => unsub?.()
  })

  function applyFilters(patch: Record<string, string | undefined>, pageSize: number) {
    if (!filterStore) return
    void setExtra(filterStore, SEED_USERS_NAME, patch, { pageSize })
  }

  function resetFilters() {
    if (!filterStore) return
    void setExtra(
      filterStore,
      SEED_USERS_NAME,
      {
        ord: undefined,
        state: undefined,
        cfrom: undefined,
        cto: undefined,
        dfrom: undefined,
        dto: undefined,
        nick: undefined,
      },
      { pageSize: SEED_USERS_PAGE_SIZE },
    )
  }
</script>

<Listing
  name={SEED_USERS_NAME}
  pageParam={SEED_USERS_PAGE_PARAM}
  route="/users"
  watch="ids"
  loadError="auth.expired"
  ariaLabel="Список seed-юзеров"
  title="Seed-юзеры"
  {variant}
  class={className}
  {scope}
  {url}
  {initial}
  onAcl={onAcl ? (fact) => onAcl(fact as AuthErrorCode) : undefined}
  {isSelected}
  pendingTestId="seed-users-pending"
  actor={vault.principal}
  {sidebar}
  filters={{
    modal: 'user.list.filters',
    path: '/users/filters',
    keys: SEED_USERS_FILTER_KEYS,
    defaults: SEED_USERS_EXTRA_DEFAULTS,
    pageSize: SEED_USERS_PAGE_SIZE,
    labels: seedFilterLabels(),
    text: seedFilterText,
    testId: 'seed-users-filters-open',
  }}
  search={{
    label: (extra) => (nickOn(extra) ? 'Поиск по seed, id и никнейму' : 'Поиск по seed и id'),
    placeholder: (extra) =>
      nickOn(extra) ? 'Подстрока seed, id или никнейма…' : 'Подстрока seed или id…',
  }}
>
  {#snippet filtersForm()}
    {#if appliedValues}
      <div class="flex flex-col gap-3" data-testid="seed-users-filters-sidebar">
        <h2 class="text-sm font-medium">Фильтры</h2>
        {#key `${appliedKey}:${canSeeDeleted}:${canSeeNickname}`}
          <SeedUsersFiltersForm
            {canSeeDeleted}
            {canSeeNickname}
            initial={appliedValues}
            from={listFrom}
            onApply={applyFilters}
            onReset={resetFilters}
          />
        {/key}
      </div>
    {/if}
  {/snippet}
  {#snippet controls()}
    {#if canReadSessions}
      <!-- Журнал всех сессий: у строки уже есть ссылка (профиль), вложенную
           ссылку ставить нельзя — вход живёт в правой зоне списка. -->
      <Button
        {...asModalLink('user.sessions.journal')}
        variant="outline"
        size="sm"
        data-testid="seed-users-sessions-open"
      >
        Все сессии
      </Button>
    {/if}
  {/snippet}
  {#snippet row(user, ctx)}
    <ListingRow attrs={attrsOf(user)} id={user.id} testId="seed-user-row" selected={ctx.selected}>
      <SeedUserCard item={user} selected={ctx.selected} />
    </ListingRow>
  {/snippet}
  {#snippet skeleton(extra)}
    <!--
      Скелетон повторяет геометрию строки, а не один серый блок.
      Блок никнейма — только при включённом параметре.
    -->
    <div class="flex w-full items-center gap-3 px-2 py-2" data-testid="seed-user-skeleton">
      <Skeleton class="h-4 min-w-0 flex-1 basis-0" />
      {#if nickOn(extra)}
        <span class="min-w-0 flex-1 basis-0" data-testid="seed-user-skeleton-nickname">
          <Skeleton class="h-3 w-full" />
        </span>
      {/if}
      <Skeleton class="h-3 min-w-0 flex-1 basis-0" />
      <Skeleton class="h-3 min-w-0 flex-1 basis-0" />
      <Skeleton class="h-3 min-w-0 flex-1 basis-0" />
    </div>
  {/snippet}
</Listing>
