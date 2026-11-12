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
  import Field from '#components/form/Field.svelte'
  import { forms } from '#components/form/forms.config.js'
  import { Button } from '#components/ui/index.js'
  import HoldButton from '#components/ui/button/HoldButton.svelte'
  import { bind, Form } from '#lib/form/svelte/index.js'
  import { acquireScopedStore, getClientStore, getState, releaseScopedStore, setExtra } from '#lib/paginate/index.js'
  import { useModalLink, type LinkAttrs } from '#hooks/links/index.js'
  import { useSlotPaginatorScope } from '#hooks/modal-paginator.svelte.js'
  import type { AuthErrorCode } from '../error.js'
  import { sessionRevokeOthersForm } from '../sessions.form.js'
  import { vault } from '../vault.svelte.js'
  import type { SessionDeviceView, SessionsRouteData } from '../types.js'
  import type { UserSurfaceVariant } from './Acl.svelte'
  import SessionRow from './SessionRow.svelte'
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
    /**
     * Целевой аккаунт — отдельный проп, как у `BlocksList`: `null` — свои
     * устройства (`/user/sessions`), uuid — чужие (`/user/<uuid>/sessions`).
     */
    uid?: string | null
    /** Общий журнал (`/sessions`): без аккаунта, все читаемые сессии. */
    journal?: boolean
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
    uid = null,
    journal = false,
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
  const fixedUid = $derived(uid?.trim() || null)
  const route = $derived(
    journal
      ? '/sessions'
      : fixedUid
        ? `/user/${encodeURIComponent(fixedUid)}/sessions`
        : '/user/sessions',
  )

  const asModalLink = useModalLink()
  const attrsOf = (item: SessionDeviceView): LinkAttrs => ({
    ...asModalLink('user.session', { id: item.id }),
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

  // Экшен лежит на том же пути, что и список: цель отзыва берёт из параметра
  // пути сервер, а не скрытое поле формы.
  const othersForm = bind(forms, sessionRevokeOthersForm(), {
    action: `${untrack(() => (fixedUid ? `/user/${encodeURIComponent(fixedUid)}/sessions` : '/user/sessions'))}?/others`,
    intercept: false,
  })

  function othersOf(data: SessionsRouteData): boolean {
    const snap = data.snapshot
    if (!snap) return false
    if ((snap.totalItems ?? 0) > 1) return true
    const items = Object.values(snap.pages).flat()
    return items.some((item) => !item.current)
  }
</script>

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
    path: '/user/sessions/filters',
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
      <Button href="/sessions" variant="outline" size="sm" data-testid="sessions-journal-open">
        Все сессии
      </Button>
    {/if}
    {#if journal}
      <Button href="/user/sessions" variant="outline" size="sm" data-testid="sessions-own-open">
        Свои устройства
      </Button>
    {/if}
    {#if !journal && view.canRevoke && othersOf(view)}
      <Form form={othersForm} hiddenFields={othersForm.hidden()} class="inline-flex">
        <div hidden>
          <Field of={othersForm.f.scope} />
        </div>
        <HoldButton type="submit" variant="outline" size="sm" seconds={2} data-testid="sessions-revoke-others">
          Заблокировать остальные
        </HoldButton>
      </Form>
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
