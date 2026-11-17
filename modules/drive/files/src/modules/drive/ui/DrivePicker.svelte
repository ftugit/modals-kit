<script lang="ts">
  /**
   * Пикер файлов (4g): тот же список диска, но строка не открывает карточку,
   * а возвращает id вызывающему экрану.
   *
   * Контракт адреса: `from` (локальный адрес возврата), `param` (какой
   * query-параметр заполнить), `kind` (`folder` — только папки), `folder`
   * (текущая папка пикера). Выбор одиночный: набор `drive.ids` — отдельный шаг.
   */
  import { formatBytes } from '#core/lib/drive/index.js'
  import { Button, Surface } from '#core/ui/index.js'
  import type { DrivePageData } from '../types.js'
  import { driveMessage } from '../messages.js'
  import { drivePickerRoute } from '../routes.js'

  interface Props {
    initial: DrivePageData
    /** Локальный адрес вызывающего экрана. */
    from: string
    /** Имя query-параметра, который заполняется id выбранного узла. */
    param: string
    /** `folder` — выбор только папок (перенос/копия), файлы не показываются. */
    kind?: 'any' | 'folder'
    /** Текущая папка пикера; `null` — корень. */
    folderId?: string | null
  }

  let { initial, from, param, kind = 'any', folderId = null }: Props = $props()

  const items = $derived(
    kind === 'folder' ? initial.items.filter((entry) => entry.node.kind === 'folder') : initial.items,
  )
  const browseHere = (id: string | null) => {
    const next = new URLSearchParams({ from, param, ...(kind === 'folder' ? { kind } : {}) })
    if (id) next.set('folder', id)
    return `${drivePickerRoute.href()}?${next.toString()}`
  }
  const pickHref = (id: string) => {
    const url = new URL(from, 'http://local')
    url.searchParams.set(param, id)
    return `${url.pathname}?${url.searchParams.toString()}`
  }
</script>

<Surface
  variant="plain"
  class="flex min-h-0 flex-1 flex-col"
  title={kind === 'folder' ? 'Выбрать папку' : 'Выбрать из диска'}
  description={kind === 'folder'
    ? 'Показываются только папки: перенести или скопировать можно в папку.'
    : 'Файл или папку можно выбрать сразу либо сначала открыть папку.'}
>
  {#if initial.notice}
    <p class="mb-3 text-sm text-destructive" role="alert">{driveMessage(initial.notice)}</p>
  {/if}

  <nav class="mb-3 flex flex-wrap items-center gap-1 text-sm" aria-label="Папка пикера">
    <a class="text-muted-foreground hover:underline" href={browseHere(null)}>Диск</a>
    {#each initial.breadcrumbs as crumb (crumb.id)}
      <span class="text-muted-foreground">/</span>
      <a class="hover:underline" href={browseHere(crumb.id)}>{crumb.name}</a>
    {/each}
  </nav>

  <div class="flex min-h-0 flex-1 flex-col gap-2" data-testid="drive-picker-list">
    {#if items.length === 0}
      <p class="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
        {kind === 'folder'
          ? 'Вложенных папок нет. Поднимитесь выше или выберите эту папку.'
          : 'Здесь пусто. Поднимитесь выше или выберите эту папку.'}
      </p>
    {:else}
      {#each items as entry (entry.node.id)}
        <div class="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
          {#if entry.node.kind === 'folder'}
            <a class="min-w-0 flex-1 truncate font-medium hover:underline" href={browseHere(entry.node.id)}>
              {entry.node.name}
            </a>
          {:else}
            <span class="min-w-0 flex-1 truncate font-medium">{entry.node.name}</span>
          {/if}
          <span class="text-xs text-muted-foreground">
            {entry.node.kind === 'folder' ? 'папка' : formatBytes(entry.node.size)}
          </span>
          <Button href={pickHref(entry.node.id)} size="sm" variant="outline">Выбрать</Button>
        </div>
      {/each}
    {/if}
  </div>

  <div class="mt-3 flex items-center justify-between gap-2">
    <div class="flex flex-wrap items-center gap-2">
      {#if initial.folder}
        <Button href={pickHref(initial.folder.id)} size="sm">Выбрать эту папку</Button>
      {/if}
      <Button href={pickHref('')} variant="outline" size="sm">Выбрать корень диска</Button>
    </div>
    <Button href={from} variant="ghost" size="sm">Отмена</Button>
  </div>
</Surface>
