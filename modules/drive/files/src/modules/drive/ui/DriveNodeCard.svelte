<script lang="ts">
  /**
   * Строка узла «Диска»: имя, вид, размер, дата, звёздочка и корзина.
   *
   * Карточка только показывает узел и передаёт действия ссылками
   * (`DriveNodeLinks`). Внутри `<a>` вложенного интерактива нет
   * (`docs/design/lists.md` §8): ссылка — сама строка, кнопки — рядом.
   */
  import { formatBytes, type DriveEntry } from '#core/lib/drive/index.js'
  import {
    Attachment,
    Badge,
    Item,
    ItemActions,
    ItemContent,
    ItemDescription,
    ItemTitle,
  } from '#core/ui/index.js'
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

{#if variant === 'detail'}
  <div class="flex min-w-0 flex-col gap-2" data-testid="drive-node-card">
    <Item as="div" variant="outline" size="lg" class="items-start">
      <ItemContent>
        <ItemTitle class="flex flex-wrap items-center gap-2">
          <span class="min-w-0 truncate" title={node.name}>{node.name}</span>
          {#if node.starred}<Badge variant="secondary">важное</Badge>{/if}
          {#if node.trashedAt}<Badge variant="outline">в корзине</Badge>{/if}
        </ItemTitle>
        <ItemDescription>{size} · {updated}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <DriveNodeLinks {node} caps={entry.caps} {returnTo} {trashed} {downloadHref} />
      </ItemActions>
    </Item>
    <dl class="grid grid-cols-1 gap-x-3 gap-y-1 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
      <dt class="text-muted-foreground">Вид</dt>
      <dd class="min-w-0 break-words">{node.kind === 'folder' ? 'Папка' : (node.contentType ?? 'Файл')}</dd>
      <dt class="text-muted-foreground">Создан</dt>
      <dd class="min-w-0 break-words">{new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long' }).format(node.createdAt)}</dd>
    </dl>
  </div>
{:else}
  <Item
    as="div"
    variant="default"
    size="sm"
    class="min-w-0 p-0"
    data-testid="drive-row"
  >
    <a {href} class="flex min-w-0 flex-1 items-center gap-3 no-underline" title={node.name}>
      <Attachment
        item={{
          id: node.id,
          filename: node.name,
          kind: node.kind,
          byteSize: node.size,
          description: `${size} · ${updated}`,
          badges: [...(node.starred ? ['важное'] : []), ...(node.trashedAt ? ['в корзине'] : [])],
        }}
        layout="row"
        size="sm"
        media="icon"
        selection="none"
        class="min-h-0 flex-1 border-0 bg-transparent px-0 py-0"
      />
    </a>
    <ItemActions>
      <DriveNodeLinks {node} caps={entry.caps} {returnTo} {trashed} {downloadHref} />
    </ItemActions>
  </Item>
{/if}
