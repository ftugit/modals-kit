<script lang="ts">
  /**
   * Read-only проводник «Диска»: крошки, квота, список узлов.
   *
   * Права приходят готовыми (`DrivePageData.caps`), компонент их не считает:
   * читателю формы создания и действий строк не рисуются, редактору — рисуются.
   */
  import { formatBytes } from '#core/lib/drive/index.js'
  import { Badge, Button, Surface } from '#core/ui/index.js'
  import type { DrivePageData } from '../types.js'
  import { driveMessage } from '../messages.js'
  import { driveFolderRoute, driveRootRoute, driveTrashRoute } from '../routes.js'
  import { driveListHref } from '../source.js'
  import DriveNodeCard from './DriveNodeCard.svelte'
  import DriveCreate from './DriveCreate.svelte'
  import DriveFilters from './DriveFilters.svelte'
  import DrivePager from './DrivePager.svelte'

  interface Props {
    initial: DrivePageData
    variant?: 'card' | 'plain'
    onDone?: () => void
  }

  let { initial, variant = 'card', onDone }: Props = $props()

  const crumbs = $derived(initial.breadcrumbs)
  const quota = $derived(initial.quota)
  const pathname = $derived(
    initial.trashed
      ? driveTrashRoute.href()
      : initial.folder
        ? driveFolderRoute.href({ folderId: initial.folder.id })
        : driveRootRoute.href(),
  )
  const filters = $derived({
    search: initial.search,
    sort: initial.sort,
    type: initial.type,
    starred: initial.starred,
    pageSize: initial.pageSize,
    from: initial.from,
    to: initial.to,
  })
  /** Фильтры без курсора: с ними возвращаются экшены и «Сбросить». */
  const returnTo = $derived(driveListHref(pathname, filters))
  const nextHref = $derived(
    initial.nextCursor ? driveListHref(pathname, filters, initial.nextCursor) : null,
  )
  const percent = $derived(quota.limit > 0 ? Math.min(100, Math.round((quota.used / quota.limit) * 100)) : 0)
</script>

{#snippet controls()}
  <Badge variant="outline" data-testid="drive-quota">
    {formatBytes(quota.used)} из {formatBytes(quota.limit)}
  </Badge>
  {#if !initial.trashed}
    <Button href={driveTrashRoute.href()} variant="ghost" size="sm">Корзина</Button>
  {/if}
  {#if onDone}
    <Button type="button" variant="ghost" size="sm" onclick={() => onDone?.()}>Закрыть</Button>
  {/if}
{/snippet}

<Surface
  {variant}
  class="flex min-h-0 flex-1 flex-col"
  title={initial.trashed ? 'Корзина' : (initial.folder?.name ?? 'Диск')}
  {controls}
  data-testid="drive-browse"
>
  {#if initial.notice}
    <p class="mb-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm" role="alert" data-testid="drive-notice">
      {driveMessage(initial.notice)}
    </p>
  {/if}

  {#if !initial.trashed}
    <nav class="mb-3 flex flex-wrap items-center gap-1 text-sm" aria-label="Хлебные крошки">
      <a class="text-muted-foreground hover:underline" href={driveRootRoute.href()}>Диск</a>
      {#each crumbs as crumb (crumb.id)}
        <span class="text-muted-foreground">/</span>
        <a class="hover:underline" href={driveFolderRoute.href({ folderId: crumb.id })}>{crumb.name}</a>
      {/each}
    </nav>
  {/if}

  <div class="mb-4 flex flex-col gap-1">
    <div class="h-1.5 overflow-hidden rounded-full bg-muted" role="presentation">
      <div class="h-full bg-primary" style:width={`${percent}%`}></div>
    </div>
    <p class="text-xs text-muted-foreground">
      Свободно {formatBytes(quota.remaining)}. Квота считается по логическому размеру файлов.
    </p>
  </div>

  <DriveFilters
    pathname={pathname}
    search={initial.search}
    type={initial.type}
    sort={initial.sort}
    starred={initial.starred}
    pageSize={initial.pageSize}
    from={initial.from}
    to={initial.to}
  />

  {#if !initial.trashed && initial.caps.canWrite}
    <DriveCreate parentId={initial.folder?.id ?? null} {returnTo} />
  {/if}

  <div class="flex min-h-0 flex-1 flex-col gap-2" data-testid="drive-list">
    {#if initial.items.length === 0}
      <p class="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
        {initial.trashed ? 'Корзина пуста.' : 'В этой папке пока ничего нет.'}
      </p>
    {:else}
      {#each initial.items as entry (entry.node.id)}
        <DriveNodeCard
          {entry}
          folders={initial.folders}
          trashed={initial.trashed}
          {returnTo}
          pick={initial.pick}
          folderId={initial.folder?.id ?? null}
        />
      {/each}
    {/if}
  </div>

  <DrivePager
    total={initial.total}
    shown={initial.items.length}
    {nextHref}
    firstHref={returnTo}
    paged={initial.paged}
  />

  {#if !initial.caps.canWrite}
    <p class="mt-3 text-xs text-muted-foreground" data-testid="drive-readonly">
      Доступ только для просмотра: менять содержимое может владелец.
    </p>
  {/if}
</Surface>
