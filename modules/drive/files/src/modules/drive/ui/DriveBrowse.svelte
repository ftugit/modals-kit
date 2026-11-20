<script lang="ts">
  /**
   * Проводник «Диска» поверх нативного `Listing` (`plan-drive-repair.md` §4.4).
   *
   * Данные — один `load` списка: страница отдаёт снапшот, модалка и догрузка
   * зовут тот же маршрут через `preloadData`. Карточка строки остаётся
   * Drive-специфичной, оболочка `Listing` — общей.
   */
  import { browser } from '$app/env'
  import { onDestroy, untrack } from 'svelte'
  import { Listing } from '#core/ui/listing/index.js'
  import type { SidebarPlace } from '#core/ui/shell/index.js'
  import { asLink, useModalLink } from '#core/hooks/links/index.js'
  import { tryUseModals } from '#core/lib/modals/svelte/index.js'
  import { visibleAddress } from '#core/lib/address/sveltekit.js'
  import {
    acquireScopedStore,
    getClientStore,
    getState,
    releaseScopedStore,
    setExtra,
  } from '#core/lib/paginate/index.js'
  import { useSlotPaginatorScope } from '#core/hooks/modal-paginator.svelte.js'
  import { Badge, Button } from '#core/ui/index.js'
  import { formatBytes, type DriveSort } from '#core/lib/drive/index.js'
  import { vault } from '#modules/user/base/svelte/vault.svelte.js'
  import type { DriveListItem, DriveListRouteData } from '../types.js'
  import {
    DRIVE_EXTRA_DEFAULTS,
    DRIVE_FILTER_KEYS,
    DRIVE_IDENTITY_KEY,
    DRIVE_NAME,
    DRIVE_PAGE_DEFAULT,
    DRIVE_PAGE_PARAM,
    driveListHref,
    ensureDrivePaginator,
    parseDriveIds,
    type DriveListFilters,
  } from '../source.js'
  import {
    driveFolderRoute,
    driveFiltersRoute,
    driveNodeRoute,
    drivePickerRoute,
    driveRootRoute,
    driveStarredRoute,
    driveTrashRoute,
  } from '../routes.js'
  import { driveFilterLabels, driveFilterText, driveFilterValues, type DriveFilterValues } from '../filters-form.js'
  import { driveMessage } from '../messages.js'
  import { driveOperationHref, type DriveOperationName, type DriveOperationParams } from '../operations.js'
  import DriveFilters from './filters/DriveFilters.svelte'
  import DriveNodeCard from './DriveNodeCard.svelte'

  // Регистрация пагинатора — в том же бандле, где рендерится `Listing`: иначе
  // SSR/гидрация падают на `Unknown paginator "drive-list"`. Идемпотентно.
  ensureDrivePaginator()

  // Ссылки операций: с хостом модалок — модалка, без него — fallback route.
  const asModalLink = tryUseModals() ? useModalLink() : null
  const opLink = (op: DriveOperationName, extra: DriveOperationParams = {}) => {
    const params = { returnTo, ...extra }
    return asModalLink ? asModalLink(`drive.${op}`, params) : asLink(driveOperationHref(op, params))
  }

  interface Props {
    initial: DriveListRouteData
    variant?: 'card' | 'plain'
    scope?: string | null
    url?: boolean
    sidebar?: SidebarPlace
    onDone?: () => void
    /** Режим пикера: строка возвращает id вызывающему экрану. */
    picker?: {
      readonly from: string
      readonly param: string
      readonly kind: 'any' | 'folder'
      readonly folderId: string | null
      readonly mode?: 'single' | 'multiple'
      readonly step?: 'pick' | 'chosen'
      readonly picked?: readonly string[]
      readonly href?: (patch: { folderId?: string | null; picked?: readonly string[] }) => string
    } | null
    /** В модалке выбор отдаётся вызывающему экрану, а не переходом. */
    onPick?: ((id: string | null, label: string) => void) | null
    onCancel?: (() => void) | null
    /** Ссылка отметки строки в `multiple`; `null` — режим без набора. */
    toggle?: ((id: string) => string) | null
  }

  let {
    initial,
    variant = 'card',
    scope = null,
    url = undefined,
    sidebar,
    onDone,
    picker = null,
    onPick = null,
    onCancel = null,
    toggle = null,
  }: Props = $props()

  const multi = $derived(picker?.mode === 'multiple')
  const pickedSet = $derived(new Set(picker?.picked ?? []))

  // Sidebar-фильтры живут в том же сторе, что и список: на странице это
  // scoped/клиентский стор, в модалке — слот `useSlotPaginatorScope`.
  const sidebarZone = untrack(() => sidebar)
  const filterSlot = sidebarZone
    ? useSlotPaginatorScope(DRIVE_NAME, untrack(() => (url === false ? { url: false } : undefined)))
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

  function valuesOf(data: DriveListRouteData): DriveFilterValues | null {
    const snap = data.snapshot
    if (!snap) return null
    return driveFilterValues(
      (snap.extra ?? {}) as Record<string, unknown>,
      snap.pageSize || DRIVE_PAGE_DEFAULT,
    )
  }

  let appliedValues = $state<DriveFilterValues | null>(valuesOf(untrack(() => initial)))
  let appliedExtra = $state<Record<string, unknown> | null>(null)
  let appliedKey = $state('')

  $effect(() => {
    if (!filterStore) return
    const sync = () => {
      const state = getState<DriveListItem>(filterStore, DRIVE_NAME)
      const next = driveFilterValues(
        (state.extra ?? {}) as Record<string, unknown>,
        state.pageSize || DRIVE_PAGE_DEFAULT,
      )
      appliedValues = next
      appliedExtra = (state.extra ?? {}) as Record<string, unknown>
      appliedKey = [next.ord, next.type, next.scope, next.size, next.from_date, next.to_date].join('|')
    }
    sync()
    const unsub = filterStore.subscribe?.(DRIVE_NAME, sync)
    return () => unsub?.()
  })

  function applyFilters(patch: Record<string, string | undefined>, pageSize: number) {
    if (!filterStore) return
    void setExtra(filterStore, DRIVE_NAME, patch, { pageSize })
  }

  function resetFilters() {
    if (!filterStore) return
    void setExtra(
      filterStore,
      DRIVE_NAME,
      {
        ord: undefined,
        type: undefined,
        scope: undefined,
        from: undefined,
        to: undefined,
      },
      { pageSize: DRIVE_PAGE_DEFAULT },
    )
  }

  const listFrom = $derived.by(() => {
    const url = visibleAddress().url
    return `${url.pathname}${url.search}`
  })

  const listingFilters = $derived({
    modal: 'drive.filters',
    path: driveFiltersRoute.href(),
    keys: DRIVE_FILTER_KEYS,
    defaults: DRIVE_EXTRA_DEFAULTS,
    pageSize: DRIVE_PAGE_DEFAULT,
    labels: driveFilterLabels(),
    text: driveFilterText,
    testId: 'drive-filters-open',
  })

  const snapshot = $derived(initial.snapshot)
  const extra = $derived(
    appliedExtra ?? ((snapshot?.extra ?? {}) as Record<string, unknown>),
  )
  const text = (key: string) => (typeof extra[key] === 'string' ? String(extra[key]) : '')
  const filters = $derived<DriveListFilters>({
    search: text('q') || null,
    sort: appliedValues?.ord === 'updated' || appliedValues?.ord === 'size'
      ? (appliedValues.ord as DriveSort)
      : 'name',
    type: appliedValues?.type === 'file' || appliedValues?.type === 'folder'
      ? appliedValues.type
      : 'all',
    scope: appliedValues?.scope === 'global' ? 'global' : 'folder',
    pageSize: appliedValues?.size ?? snapshot?.pageSize ?? DRIVE_PAGE_DEFAULT,
    from: appliedValues?.from_date || null,
    to: appliedValues?.to_date || null,
  })
  const ids = $derived(parseDriveIds(text('ids') || null))
  const initialListing = $derived(snapshot ? { snapshot, fact: null } : null)
  const scopeLocked = $derived(
    initial.trashed || Boolean(initial.folder && initial.folder.ownerId !== vault.principal),
  )
  const returnTo = $derived(
    driveListHref(initial.pathname, filters, snapshot?.page ?? 1, ids),
  )
  const title = $derived(
    initial.trashed
      ? 'Корзина'
      : initial.identity === 'starred'
        ? 'Важное'
        : (initial.folder?.name ?? 'Диск'),
  )
  const quota = $derived(initial.quota)
  const percent = $derived(
    quota.limit > 0 ? Math.min(100, Math.round((quota.used / quota.limit) * 100)) : 0,
  )

  const hrefOf = (item: DriveListItem): string =>
    item.node.kind === 'folder'
      ? driveFolderRoute.href({ folderId: item.node.id })
      : driveNodeRoute.href({ id: item.node.id })

  const pickHref = (id: string | null): string => {
    if (!picker) return driveRootRoute.href()
    const url = new URL(picker.from, 'http://local')
    if (id) url.searchParams.set(picker.param, id)
    else url.searchParams.delete(picker.param)
    const query = url.searchParams.toString()
    return query ? `${url.pathname}?${query}` : url.pathname
  }

  const pickerBrowseHref = (id: string | null): string => {
    if (!picker) return driveRootRoute.href()
    if (picker.href) return picker.href({ folderId: id })
    const query = new URLSearchParams({ from: picker.from, param: picker.param })
    if (picker.kind === 'folder') query.set('kind', 'folder')
    if (id) query.set('folder', id)
    return `${drivePickerRoute.href()}?${query.toString()}`
  }
</script>

<div class="flex min-h-0 flex-1 flex-col gap-3">
  {#if !initial.trashed && snapshot && initial.caps.canRead}
    <nav class="flex flex-wrap items-center gap-1 text-sm" aria-label="Хлебные крошки">
      <a class="text-muted-foreground hover:underline" href={picker ? pickerBrowseHref(null) : driveRootRoute.href()}>Диск</a>
      {#each initial.breadcrumbs as crumb (crumb.id)}
        <span class="text-muted-foreground">/</span>
        <a
          class="min-w-0 max-w-48 truncate hover:underline"
          title={crumb.name}
          href={picker ? pickerBrowseHref(crumb.id) : driveFolderRoute.href({ folderId: crumb.id })}
        >
          {crumb.name}
        </a>
      {/each}
    </nav>
  {/if}

  {#if initial.fact}
    <p class="rounded-lg border border-border p-4 text-sm text-muted-foreground">
      Список недоступен: {driveMessage(initial.fact)}
    </p>
  {:else}
    <Listing
      name={DRIVE_NAME}
      pageParam={DRIVE_PAGE_PARAM}
      route={initial.pathname}
      watch={DRIVE_IDENTITY_KEY}
      identityKey={DRIVE_IDENTITY_KEY}
      ariaLabel={picker ? 'Выбор из диска' : 'Список файлов диска'}
      {title}
      {variant}
      {scope}
      {url}
      {sidebar}
      filters={picker || initial.trashed ? undefined : listingFilters}
      actor={vault.principal}
      initial={initialListing}
      loadError="auth.expired"
      listTestId="drive-list"
      pendingTestId="drive-pending"
      search={{
        label: () => 'Поиск по имени',
        placeholder: () => 'Подстрока имени файла или папки…',
      }}
    >
      {#snippet filtersForm()}
        {#if appliedValues && !picker && !initial.trashed}
          <div class="flex flex-col gap-3" data-testid="drive-filters-sidebar">
            <h2 class="text-sm font-medium">Фильтры</h2>
            {#key appliedKey}
              <DriveFilters
                initial={appliedValues}
                from={listFrom}
                scopeLocked={scopeLocked}
                onApply={applyFilters}
                onReset={resetFilters}
              />
            {/key}
          </div>
        {/if}
      {/snippet}

      {#snippet controls()}
        {#if initial.caps.canWrite && !initial.trashed && !picker}
          <Button {...opLink('mkdir', { parentId: initial.folder?.id ?? '' })} size="sm">
            Создать папку
          </Button>
          <Button
            {...opLink('upload', { parentId: initial.folder?.id ?? '' })}
            variant="outline"
            size="sm"
          >
            Загрузить
          </Button>
        {/if}
        <Badge variant="outline" data-testid="drive-quota">
          {formatBytes(quota.used)} из {formatBytes(quota.limit)}
        </Badge>
        {#if !initial.trashed && !picker}
          <Button
            {...asLink(driveStarredRoute.href())}
            variant={initial.identity === 'starred' ? 'secondary' : 'ghost'}
            size="sm"
            aria-current={initial.identity === 'starred' ? 'page' : undefined}
          >Важное</Button>
          <Button {...asLink('/user/config/dav')} variant="outline" size="sm">
            Подключить по WebDAV
          </Button>
          <Button {...asLink(driveTrashRoute.href())} variant="ghost" size="sm">Корзина</Button>
        {/if}
        {#if onDone}
          <Button type="button" variant="ghost" size="sm" onclick={() => onDone?.()}>Закрыть</Button>
        {/if}
      {/snippet}

      {#snippet row(item, ctx)}
        {#if picker}
          <div class="flex flex-wrap items-center gap-2" data-testid="drive-picker-row">
            {#if multi && toggle}
              <Button
                href={toggle(item.node.id)}
                size="sm"
                variant={pickedSet.has(item.node.id) ? 'default' : 'outline'}
                aria-pressed={pickedSet.has(item.node.id)}
                data-testid="drive-pick-toggle"
              >{pickedSet.has(item.node.id) ? 'Отмечено' : 'Отметить'}</Button>
            {/if}
            {#if item.node.kind === 'folder'}
              <a class="min-w-0 flex-1 truncate font-medium hover:underline" href={pickerBrowseHref(item.node.id)}>
                {item.node.name}
              </a>
            {:else}
              <span class="min-w-0 flex-1 truncate font-medium">{item.node.name}</span>
            {/if}
            <span class="text-xs text-muted-foreground">
              {item.node.kind === 'folder' ? 'папка' : formatBytes(item.node.size)}
            </span>
            {#if !multi && (item.node.kind === 'folder' || picker.kind === 'any')}
              {#if onPick}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onclick={() => onPick?.(item.node.id, item.node.name)}
                >Выбрать</Button>
              {:else}
                <Button href={pickHref(item.node.id)} size="sm" variant="outline">Выбрать</Button>
              {/if}
            {/if}
          </div>
        {:else}
          <!-- Своя оболочка строки: в карточке уже есть ссылка на имя, а ссылки
               операций не могут жить внутри `<a>` (ListingRow обернул бы всё). -->
          <div
            class="flex flex-wrap items-center gap-2 rounded-md px-1 py-1"
            data-testid="drive-row"
            data-id={item.id}
            data-selected={ctx.selected || undefined}
          >
            <DriveNodeCard
              entry={item}
              {returnTo}
              trashed={initial.trashed}
              folderAsCard={filters.scope === 'global'}
            />
          </div>
        {/if}
      {/snippet}
    </Listing>

    {#if picker && !multi}
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-wrap items-center gap-2">
          {#if initial.folder}
            {#if onPick}
              <Button
                type="button"
                size="sm"
                onclick={() => onPick?.(initial.folder?.id ?? null, initial.folder?.name ?? '')}
              >Выбрать эту папку</Button>
            {:else}
              <Button href={pickHref(initial.folder.id)} size="sm">Выбрать эту папку</Button>
            {/if}
          {/if}
          {#if onPick}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onclick={() => onPick?.(null, 'Корень диска')}
            >Выбрать корень диска</Button>
          {:else}
            <Button href={pickHref(null)} variant="outline" size="sm">Выбрать корень диска</Button>
          {/if}
        </div>
        {#if onCancel}
          <Button type="button" variant="ghost" size="sm" onclick={() => onCancel?.()}>Отмена</Button>
        {:else}
          <Button href={picker.from} variant="ghost" size="sm">Отмена</Button>
        {/if}
      </div>
    {/if}
  {/if}

  {#if !initial.caps.canWrite && !initial.trashed && !picker}
    <p class="text-xs text-muted-foreground" data-testid="drive-readonly">
      Доступ только для просмотра: менять содержимое может владелец.
    </p>
  {/if}

  <div class="mt-1 flex items-center gap-2">
    <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" role="presentation">
      <div class="h-full bg-primary" style:width={`${percent}%`}></div>
    </div>
    <span class="text-xs text-muted-foreground">
      Свободно {formatBytes(quota.remaining)}
    </span>
  </div>
</div>
