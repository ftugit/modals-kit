<script lang="ts">
  /**
   * Проводник «Диска» поверх нативного `Listing` (`plan-drive-repair.md` §4.4).
   *
   * Данные — один `load` списка: страница отдаёт снапшот, модалка и догрузка
   * зовут тот же маршрут через `preloadData`. Карточка строки остаётся
   * Drive-специфичной, оболочка `Listing` — общей.
   */
  import { Listing } from '#core/ui/listing/index.js'
  import type { SidebarPlace } from '#core/ui/shell/index.js'
  import { asLink, useModalLink } from '#core/hooks/links/index.js'
  import { tryUseModals } from '#core/lib/modals/svelte/index.js'
  import { Badge, Button } from '#core/ui/index.js'
  import { formatBytes, type DriveSort } from '#core/lib/drive/index.js'
  import { vault } from '#modules/user/base/svelte/vault.svelte.js'
  import type { DriveListItem, DriveListRouteData } from '../types.js'
  import {
    DRIVE_IDENTITY_KEY,
    DRIVE_NAME,
    DRIVE_PAGE_DEFAULT,
    DRIVE_PAGE_PARAM,
    driveListHref,
    ensureDrivePaginator,
    parseDriveIds,
    type DriveListFilters,
  } from '../source.js'
  import { driveFolderRoute, driveNodeRoute, drivePickerRoute, driveRootRoute, driveTrashRoute } from '../routes.js'
  import { driveMessage } from '../messages.js'
  import { driveOperationHref, type DriveOperationName, type DriveOperationParams } from '../operations.js'
  import DriveFilters from './DriveFilters.svelte'
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
    } | null
  }

  let { initial, variant = 'card', scope = null, url = undefined, sidebar, onDone, picker = null }: Props = $props()

  const snapshot = $derived(initial.snapshot)
  const extra = $derived((snapshot?.extra ?? {}) as Record<string, unknown>)
  const text = (key: string) => (typeof extra[key] === 'string' ? String(extra[key]) : '')
  const sortRaw = $derived(text('ord'))
  const typeRaw = $derived(text('type'))
  const filters = $derived<DriveListFilters>({
    search: text('q') || null,
    sort: sortRaw === 'updated' || sortRaw === 'size' ? (sortRaw as DriveSort) : 'name',
    type: typeRaw === 'file' || typeRaw === 'folder' ? typeRaw : 'all',
    starred: text('starred') === '1',
    pageSize: snapshot?.pageSize ?? DRIVE_PAGE_DEFAULT,
    from: text('from') || null,
    to: text('to') || null,
  })
  const ids = $derived(parseDriveIds(text('ids') || null))
  const returnTo = $derived(
    driveListHref(initial.pathname, filters, snapshot?.page ?? 1, ids),
  )
  const title = $derived(initial.trashed ? 'Корзина' : (initial.folder?.name ?? 'Диск'))
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
    const query = new URLSearchParams({ from: picker.from, param: picker.param })
    if (picker.kind === 'folder') query.set('kind', 'folder')
    if (id) query.set('folder', id)
    return `${drivePickerRoute.href()}?${query.toString()}`
  }
</script>

<div class="flex min-h-0 flex-1 flex-col gap-3">
  {#if initial.notice}
    <p
      class="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
      role="alert"
      data-testid="drive-notice"
    >
      {driveMessage(initial.notice)}
    </p>
  {/if}

  {#if !initial.trashed && snapshot && initial.caps.canRead}
    <nav class="flex flex-wrap items-center gap-1 text-sm" aria-label="Хлебные крошки">
      <a class="text-muted-foreground hover:underline" href={picker ? pickerBrowseHref(null) : driveRootRoute.href()}>Диск</a>
      {#each initial.breadcrumbs as crumb (crumb.id)}
        <span class="text-muted-foreground">/</span>
        <a
          class="hover:underline"
          href={picker ? pickerBrowseHref(crumb.id) : driveFolderRoute.href({ folderId: crumb.id })}
        >
          {crumb.name}
        </a>
      {/each}
    </nav>
  {/if}

  {#if !initial.trashed && !picker && snapshot && initial.caps.canRead}
    <DriveFilters
      pathname={initial.pathname}
      search={filters.search}
      type={filters.type}
      sort={filters.sort}
      starred={filters.starred}
      pageSize={filters.pageSize}
      from={filters.from}
      to={filters.to}
    />
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
      actor={vault.principal}
      initial={{ snapshot, fact: null }}
      loadError="auth.expired"
      listTestId="drive-list"
      pendingTestId="drive-pending"
      search={{
        label: () => 'Поиск по имени',
        placeholder: () => 'Подстрока имени файла или папки…',
      }}
    >
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
          <Button {...asLink(driveTrashRoute.href())} variant="ghost" size="sm">Корзина</Button>
        {/if}
        {#if onDone}
          <Button type="button" variant="ghost" size="sm" onclick={() => onDone?.()}>Закрыть</Button>
        {/if}
      {/snippet}

      {#snippet row(item, ctx)}
        {#if picker}
          <div class="flex flex-wrap items-center gap-2" data-testid="drive-picker-row">
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
            {#if item.node.kind === 'folder' || picker.kind === 'any'}
              <Button href={pickHref(item.node.id)} size="sm" variant="outline">Выбрать</Button>
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
            <DriveNodeCard entry={item} {returnTo} trashed={initial.trashed} />
          </div>
        {/if}
      {/snippet}
    </Listing>

    {#if picker}
      <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-wrap items-center gap-2">
          {#if initial.folder}
            <Button href={pickHref(initial.folder.id)} size="sm">Выбрать эту папку</Button>
          {/if}
          <Button href={pickHref(null)} variant="outline" size="sm">Выбрать корень диска</Button>
        </div>
        <Button href={picker.from} variant="ghost" size="sm">Отмена</Button>
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
