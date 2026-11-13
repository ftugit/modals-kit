<script lang="ts">
  /**
   * Список своих устройств поверх `Listing`.
   *
   * Данные — один `load` роута `/user/sessions`. Страница отдаёт его пропсом
   * `initial`; модалка ничего не приносит — оболочка сама зовёт тот же роут.
   * Отказ (`fact`) уходит носителю через `onAcl`, `Acl` рисует он.
   *
   * Строка — ссылка на карточку устройства (`user.session`, без JS —
   * `/user/sessions/<id>`). Отзыв и переименование живут в карточке: форма
   * внутри ссылки сделала бы разметку невалидной. «Заблокировать остальные» —
   * кнопка списка в той же правой зоне, что и «Фильтры».
   */
  import { onDestroy, onMount, untrack } from 'svelte'
  import { browser } from '$app/env'
  import { visibleAddress } from '#lib/address/sveltekit.js'
  import type { SidebarPlace } from '#components/shell/index.js'
  import { Listing, ListingRow } from '#components/listing/index.js'
  import { useSteps } from '#components/steps/index.js'
  import { Button } from '#components/ui/index.js'
  import { acquireScopedStore, getClientStore, getState, releaseScopedStore, setExtra } from '#lib/paginate/index.js'
  import { useModalLink, type LinkAttrs } from '#hooks/links/index.js'
  import { useSlotPaginatorScope } from '#hooks/modal-paginator.svelte.js'
  import type { AuthErrorCode } from '../error.js'
  import {
    sessionsJournalRoute,
    userAccountSessionsRoute,
    userSessionsFiltersRoute,
    userSessionsRoute,
  } from '../routes.js'
  import { vault } from '../vault.svelte.js'
  import type { SessionDeviceView, SessionsRouteData, SessionsTarget } from '../types.js'
  import type { UserSurfaceVariant } from './Acl.svelte'
  import SessionRow from './SessionRow.svelte'
  import ExitSteps from './sessions-list/ExitSteps.svelte'
  import SessionsFiltersForm, { type SessionsFilterValues } from './SessionsFiltersForm.svelte'
  import { sessionsFilterLabels, sessionsFilterText } from './sessions-list/filters-form.js'
  import {
    ensureSessionsPaginator,
    SESSIONS_EXTRA_DEFAULTS,
    SESSIONS_FILTER_KEYS,
    SESSIONS_NAME,
    SESSIONS_PAGE_PARAM,
    SESSIONS_PAGE_SIZE,
  } from './sessions-list/source.js'

  interface Props {
    /** Цель списка: свои устройства, аккаунт или общий журнал. Один источник истины. */
    target?: SessionsTarget
    /** Носитель: страница — шаг в URL, модалка — локальный хост шагов. */
    mode?: 'page' | 'modal'
    /** Данные `load` роута от носителя (страница/модалка). */
    initial?: SessionsRouteData | null
    /** Явный ключ изолированной области пагинатора (для немодальных стендов). */
    scope?: string | null
    /** Синхронизировать состояние пагинатора с адресом. */
    url?: boolean
    /** Отказ из собственного запроса: ACL рисует носитель. */
    onAcl?: (fact: AuthErrorCode) => void
    variant?: UserSurfaceVariant
    class?: string
    /** Зона sidebar. Страница передаёт, модалка — нет. */
    sidebar?: SidebarPlace
  }

  let {
    target = { kind: 'own' },
    mode = 'page',
    initial = null,
    scope = null,
    url = undefined,
    onAcl,
    variant = 'plain',
    class: className,
    sidebar,
  }: Props = $props()

  // Регистрация — в том же бандле, что и хост пагинатора внутри `Listing`.
  ensureSessionsPaginator()

  // Цель списка: адрес `load` и адрес экшенов собираются из пропа, а не из
  // query. `_uid` для догрузки порций едет в `extra` снапшота (см. `source.ts`).
  const fixedUid = $derived(target.kind === 'account' ? target.uid : null)
  const journal = $derived(target.kind === 'journal')
  const route = $derived(
    journal
      ? sessionsJournalRoute.href()
      : fixedUid
        ? userAccountSessionsRoute.href({ id: fixedUid })
        : userSessionsRoute.href(),
  )

  const asModalLink = useModalLink()
  // Цель аккаунта едет в карточку строки: иначе `user.session` дал бы
  // fallback на свой путь `/user/sessions/<id>` и строка чужого списка
  // потеряла бы цель (без JS и при открытии модалки как страницы).
  const attrsOf = (item: SessionDeviceView): LinkAttrs => ({
    ...asModalLink('user.session', fixedUid ? { id: item.id, uid: fixedUid } : { id: item.id }),
    title: 'Открыть устройство',
  })

  let now = $state(Date.now())
  onMount(() => {
    const timer = setInterval(() => (now = Date.now()), 30_000)
    return () => clearInterval(timer)
  })

  const sidebarZone = untrack(() => sidebar)
  const filterSlot = sidebarZone
    ? useSlotPaginatorScope(SESSIONS_NAME, untrack(() => (url === false ? { url: false } : undefined)))
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
    const current = visibleAddress().url
    return `${current.pathname}${current.search}`
  })

  function valuesFrom(extra: Record<string, unknown>, pageSize: number): SessionsFilterValues {
    const s = (key: string) => (typeof extra[key] === 'string' ? (extra[key] as string) : '')
    return {
      state: s('state') || 'active',
      net: s('net') === '1',
      country: s('country') ? s('country').split(',').filter(Boolean) : [],
      cfrom: s('cfrom'),
      cto: s('cto'),
      sfrom: s('sfrom'),
      sto: s('sto'),
      size: pageSize || SESSIONS_PAGE_SIZE,
    }
  }

  let appliedValues = $state<SessionsFilterValues | null>(
    untrack(() =>
      initial?.snapshot
        ? valuesFrom((initial.snapshot.extra ?? {}) as Record<string, unknown>, initial.snapshot.pageSize)
        : null,
    ),
  )
  let appliedKey = $state('')

  $effect(() => {
    if (!filterStore) return
    const sync = () => {
      const state = getState<SessionDeviceView>(filterStore, SESSIONS_NAME)
      const extra = (state.extra ?? {}) as Record<string, unknown>
      const pageSize = state.pageSize || SESSIONS_PAGE_SIZE
      appliedValues = valuesFrom(extra, pageSize)
      appliedKey = SESSIONS_FILTER_KEYS.map((key) => String(extra[key] ?? '')).join('|') + '|' + pageSize
    }
    sync()
    const unsub = filterStore.subscribe?.(SESSIONS_NAME, sync)
    return () => unsub?.()
  })

  function applyFilters(patch: Record<string, string | undefined>, pageSize: number) {
    if (!filterStore) return
    void setExtra(filterStore, SESSIONS_NAME, patch, { pageSize })
  }

  function resetFilters() {
    if (!filterStore) return
    void setExtra(
      filterStore,
      SESSIONS_NAME,
      {
        state: undefined,
        net: undefined,
        country: undefined,
        cfrom: undefined,
        cto: undefined,
        sfrom: undefined,
        sto: undefined,
      },
      { pageSize: SESSIONS_PAGE_SIZE },
    )
  }

  // Набор массового выхода — строки, которые список уже показал: иначе
  // «закрыть всё, что в списке после фильтрации» выразить нечем, потому что
  // фильтр живёт в `extra` пагинатора и в домен не попадает. Накопленные
  // страницы берутся из стора пагинатора; без стора (модалка без sidebar) —
  // первая порция снапшота.
  const exitRows = $derived.by(() => {
    if (filterStore) {
      const state = getState<SessionDeviceView>(filterStore, SESSIONS_NAME)
      return Object.values(state.pages).flat()
    }
    return Object.values(initial?.snapshot?.pages ?? {}).flat()
  })
  const exitIds = $derived(exitRows.map((row) => row.id))
  const currentId = $derived(exitRows.find((row) => row.current)?.id ?? null)

  // Шаг подтверждения: на странице — URL-ключ (без JS «Далее» обычная ссылка),
  // в модалке — локальный хост шагов. Адрес носителя в модалке не читается и не
  // пишется: закрытие слоя не оставляет ключ, следующая карточка стартует со сводки.
  const stepsMode = untrack(() => mode)
  const exitKey = 'sessions-exit'
  const exitHost = useSteps({
    owner: 'user-sessions-exit',
    key: exitKey,
    mode: stepsMode === 'modal' ? 'local' : 'url',
    steps: () => [
      { key: 'summary', label: 'Сводка', filled: true },
      { key: 'confirm', label: 'Подтверждение', filled: true },
    ],
    current: () =>
      stepsMode === 'modal'
        ? 'summary'
        : visibleAddress().url.searchParams.get(exitKey) === 'confirm'
          ? 'confirm'
          : 'summary',
  })
  const exitStep = $derived(exitHost.currentKey === 'confirm' ? 'confirm' : 'summary')
  // Fallback без JS ведёт на страницу той же единицы, а не на адрес носителя.
  const exitNextHref = $derived(stepsMode === 'modal' ? `${route}?${exitKey}=confirm` : exitHost.href('confirm'))
  const exitBackHref = $derived(stepsMode === 'modal' ? route : exitHost.blankHref())
  function toggleExit() {
    exitHost.set(exitStep === 'confirm' ? 'summary' : 'confirm')
  }

  function othersOf(data: SessionsRouteData): boolean {
    const snap = data.snapshot
    if (!snap) return false
    if ((snap.totalItems ?? 0) > 1) return true
    const items = Object.values(snap.pages).flat()
    return items.some((item) => !item.current)
  }
</script>

  {#if exitStep === 'confirm' && !journal}
    <ExitSteps
      ids={exitIds}
      pick="only"
      {currentId}
      total={exitRows.length}
      step="confirm"
      backHref={exitBackHref}
      onBack={stepsMode === 'modal' ? () => exitHost.set('summary') : undefined}
      action={`${route}?/others`}
      heading="Завершение сессий"
      summary="Будут завершены все устройства, показанные в этом списке — с учётом фильтра."
      confirmLabel="Завершить сессии"
      testId="bulk-exit"
    />
  {/if}

<Listing
  name={SESSIONS_NAME}
  pageParam={SESSIONS_PAGE_PARAM}
  {route}
  loadError="auth.expired"
  ariaLabel="Список устройств"
  title={journal ? 'Все сессии' : fixedUid ? 'Сессии аккаунта' : 'Сессии'}
  {variant}
  class={className}
  {scope}
  {url}
  {initial}
  onAcl={onAcl ? (fact) => onAcl(fact as AuthErrorCode) : undefined}

  pendingTestId="sessions-pending"
  actor={vault.principal}
  {sidebar}
  filters={{
    modal: 'user.sessions.filters',
    path: userSessionsFiltersRoute.href(),
    // Цель среза — параметром: в модалке `from` равен адресу страницы-
    // носителя (`/user/<uuid>`), из него цель не разобрать.
    query: fixedUid ? { uid: fixedUid } : journal ? { journal: '1' } : undefined,
    params: fixedUid ? { uid: fixedUid } : journal ? { journal: '1' } : {},
    keys: SESSIONS_FILTER_KEYS,
    defaults: SESSIONS_EXTRA_DEFAULTS,
    pageSize: SESSIONS_PAGE_SIZE,
    labels: sessionsFilterLabels(),
    text: sessionsFilterText,
    testId: 'sessions-filters-open',
  }}
>
  {#snippet filtersForm()}
    {#if appliedValues}
      <div class="flex flex-col gap-3" data-testid="sessions-filters-sidebar">
        <h2 class="text-sm font-medium">Фильтры</h2>
        {#key `${appliedKey}:${initial?.canSeeDeleted}:${(initial?.countries ?? []).join(',')}`}
          <SessionsFiltersForm
            canSeeDeleted={initial?.canSeeDeleted === true}
            countries={initial?.countries ?? []}
            initial={appliedValues}
            from={listFrom}
            onApply={applyFilters}
            onReset={resetFilters}
          />
        {/key}
      </div>
    {/if}
  {/snippet}
  {#snippet controls({ payload })}
    {@const view = payload as unknown as SessionsRouteData}
    {#if !journal && !fixedUid && view.canReadOthers}
      <!-- Журнал — своя пара `user.sessions.journal`: вход слоем, а не переходом.
           Адрес без JS приходит из реестра через пару, не из разметки. -->
      <Button
        {...asModalLink('user.sessions.journal')}
        variant="outline"
        size="sm"
        data-testid="sessions-journal-open"
      >
        Все сессии
      </Button>
    {/if}
    {#if journal}
      <!-- Обратно к своим — той же механикой: слой `user.sessions` поверх журнала. -->
      <Button
        {...asModalLink('user.sessions')}
        variant="outline"
        size="sm"
        data-testid="sessions-own-open"
      >
        Свои устройства
      </Button>
    {/if}
    {#if !journal && view.canRevoke && othersOf(view)}
      {#if stepsMode === 'modal'}
        <Button type="button" onclick={toggleExit} variant="outline" size="sm" data-testid="sessions-revoke-others">
          {exitStep === 'confirm' ? 'Отменить' : 'Заблокировать остальные'}
        </Button>
      {:else}
        <Button href={exitStep === 'confirm' ? exitBackHref : exitNextHref} variant="outline" size="sm" data-testid="sessions-revoke-others">
          {exitStep === 'confirm' ? 'Отменить' : 'Заблокировать остальные'}
        </Button>
      {/if}
    {/if}
  {/snippet}
  {#snippet row(item)}
    <ListingRow attrs={attrsOf(item)} id={item.id} testId="session-row">
      <SessionRow item={item} {now} />
    </ListingRow>
  {/snippet}
  {#snippet skeleton()}
    <div class="flex w-full flex-col gap-1 px-2 py-2" data-testid="session-skeleton">
      <div class="flex items-center gap-2">
        <span class="h-4 min-w-0 flex-1 basis-0 rounded bg-muted" style="max-width: 9rem"></span>
        <span class="h-3 w-16 rounded bg-muted"></span>
      </div>
      <span class="h-3 w-2/3 rounded bg-muted"></span>
    </div>
  {/snippet}
</Listing>
