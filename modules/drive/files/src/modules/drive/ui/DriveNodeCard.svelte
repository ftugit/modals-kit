<script lang="ts">
  /**
   * Строка узла «Диска»: имя, вид, размер, дата, звёздочка и корзина.
   *
   * Карточка только показывает узел и передаёт действия ссылками
   * (`DriveNodeLinks`). Внутри `<a>` вложенного интерактива нет
   * (`docs/design/lists.md` §8): ссылка — сама строка, кнопки — рядом.
   */
  import { formatBytes, type DriveEntry } from '#core/lib/drive/index.js'
  import { Badge } from '#core/ui/index.js'
  import { driveFolderRoute, driveNodeRoute, driveRootRoute } from '../routes.js'
  import DriveNodeLinks from './DriveNodeLinks.svelte'

  interface Props {
    entry: DriveEntry
    /** `row` — список, `detail` — карточка узла. */
    variant?: 'row' | 'detail'
    trashed?: boolean
    /** Адрес страницы, на которую вернётся операция. */
    returnTo?: string
    /** GET-ссылка на байты файла. */
    downloadHref?: string | null
    /** В глобальном списке папка открывает карточку, а не навигацию. */
    folderAsCard?: boolean
  }

  let {
    entry,
    variant = 'row',
    trashed = false,
    returnTo = driveRootRoute.href(),
    downloadHref = null,
    folderAsCard = false,
  }: Props = $props()

  const node = $derived(entry.node)
  const href = $derived(
    node.kind === 'folder' && !folderAsCard
      ? driveFolderRoute.href({ folderId: node.id })
      : driveNodeRoute.href({ id: node.id }),
  )
  const size = $derived(node.kind === 'folder' ? 'Папка' : formatBytes(node.size))
  const updated = $derived(
    new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(node.updatedAt),
  )
</script>

{#snippet body()}
  <span class="flex min-w-0 flex-1 items-center gap-2">
    <span class="min-w-0 truncate font-medium" title={node.name}>{node.name}</span>
    {#if node.starred}<Badge variant="secondary">важное</Badge>{/if}
    {#if node.trashedAt}<Badge variant="outline">в корзине</Badge>{/if}
  </span>
  <span class="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
    <span>{size}</span>
    <time datetime={node.updatedAt.toISOString()}>{updated}</time>
  </span>
{/snippet}

{#if variant === 'detail'}
  <div class="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-4" data-testid="drive-node-card">
    <div class="flex items-center gap-2">
      {@render body()}
    </div>
    <dl class="grid grid-cols-1 gap-x-3 gap-y-1 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
      <dt class="text-muted-foreground">Вид</dt>
      <dd class="min-w-0 break-words">{node.kind === 'folder' ? 'Папка' : (node.contentType ?? 'Файл')}</dd>
      <dt class="text-muted-foreground">Создан</dt>
      <dd class="min-w-0 break-words">{new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long' }).format(node.createdAt)}</dd>
    </dl>
    <DriveNodeLinks {node} caps={entry.caps} {returnTo} {trashed} {downloadHref} />
  </div>
{:else}
  <div
    class="flex min-w-0 flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2 hover:bg-muted/50"
    data-testid="drive-row"
  >
    <a {href} class="flex min-w-0 flex-1 basis-56 items-center gap-3 no-underline">
      {@render body()}
    </a>
    <DriveNodeLinks {node} caps={entry.caps} {returnTo} {trashed} {downloadHref} />
  </div>
{/if}
