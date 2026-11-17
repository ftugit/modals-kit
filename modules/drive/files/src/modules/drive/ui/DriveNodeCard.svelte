<script lang="ts">
  /**
   * Строка узла «Диска»: имя, вид, размер, дата, звёздочка и корзина.
   *
   * Нажатие не зашито внутрь: `ListingRow`-ссылка рисуется носителем,
   * вложенный интерактив в `<a>` запрещён (`docs/design/lists.md` §8).
   */
  import { formatBytes, type DriveEntry } from '#core/lib/drive/index.js'
  import { Badge } from '#core/ui/index.js'
  import { driveFolderRoute, driveNodeRoute, driveRootRoute } from '../routes.js'
  import DriveNodeActions from './DriveNodeActions.svelte'
  import type { DriveFolderOption } from '../form.js'
  import type { DrivePick } from '../types.js'

  interface Props {
    entry: DriveEntry
    /** `row` — список, `detail` — карточка узла. */
    variant?: 'row' | 'detail'
    folders?: readonly DriveFolderOption[]
    trashed?: boolean
    /** Адрес страницы, на которую вернётся POST действия. */
    returnTo?: string
    pick?: DrivePick | null
    folderId?: string | null
  }

  let {
    entry,
    variant = 'row',
    folders = [],
    trashed = false,
    returnTo = driveRootRoute.href(),
    pick = null,
    folderId = null,
  }: Props = $props()

  const node = $derived(entry.node)
  const href = $derived(
    node.kind === 'folder' ? driveFolderRoute.href({ folderId: node.id }) : driveNodeRoute.href({ id: node.id }),
  )
  const size = $derived(node.kind === 'folder' ? 'Папка' : formatBytes(node.size))
  const updated = $derived(
    new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(node.updatedAt),
  )
</script>

{#snippet body()}
  <span class="flex min-w-0 flex-1 items-center gap-2">
    <span class="truncate font-medium">{node.name}</span>
    {#if node.starred}<Badge variant="secondary">важное</Badge>{/if}
    {#if node.trashedAt}<Badge variant="outline">в корзине</Badge>{/if}
  </span>
  <span class="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
    <span>{size}</span>
    <time datetime={node.updatedAt.toISOString()}>{updated}</time>
  </span>
{/snippet}

{#if variant === 'detail'}
  <div class="flex flex-col gap-2 rounded-lg border border-border p-4" data-testid="drive-node-card">
    <div class="flex items-center gap-2">
      {@render body()}
    </div>
    <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      <dt class="text-muted-foreground">Вид</dt>
      <dd>{node.kind === 'folder' ? 'Папка' : (node.contentType ?? 'Файл')}</dd>
      <dt class="text-muted-foreground">Создан</dt>
      <dd>{new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long' }).format(node.createdAt)}</dd>
    </dl>
  </div>
{:else}
  <div
    class="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2 hover:bg-muted/50"
    data-testid="drive-row"
  >
    <a {href} class="flex min-w-0 flex-1 items-center gap-3 no-underline">
      {@render body()}
    </a>
    <DriveNodeActions
      nodeId={node.id}
      name={node.name}
      starred={node.starred}
      canWrite={entry.caps.canWrite}
      canShare={entry.caps.canShare}
      {trashed}
      {folders}
      {returnTo}
      {pick}
      {folderId}
    />
  </div>
{/if}
