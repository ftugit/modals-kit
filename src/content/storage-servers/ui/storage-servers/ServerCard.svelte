<script lang="ts">
  /**
   * Строка пула серверов (S20): только оформление, без механики.
   *
   * Что строка делает и какие кнопки у неё есть — решает хост: кнопки приходят
   * сниппетом `actions`. Так экран остаётся хостом оболочки, а не наоборот.
   */
  import type { Snippet } from 'svelte'
  import { Badge } from '#components/ui/index.js'
  import type { StorageServerView } from '../../types.js'

  interface Props {
    srv: StorageServerView
    actions?: Snippet
  }

  let { srv, actions }: Props = $props()
</script>

<div
  class="flex flex-col gap-2 rounded-lg border border-border p-3"
  data-testid={`storage-server-card-${srv.slot}`}
>
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div class="flex flex-wrap items-center gap-1.5">
      <span class="font-mono text-sm font-semibold">{srv.slot}</span>
      <Badge variant="outline">{srv.meta.protocol.toUpperCase()}</Badge>
      <Badge variant="outline">Приоритет {srv.priority}</Badge>
      {#if srv.meta.encrypted}
        <Badge variant="secondary">AES-256-GCM</Badge>
      {/if}
      {#if srv.meta.readOnly}
        <Badge variant="outline">Только чтение</Badge>
      {/if}
      {#if !srv.meta.allowSplit}
        <Badge variant="outline">Без split</Badge>
      {/if}
    </div>
    {#if actions}
      <div class="flex items-center gap-1.5">
        {@render actions()}
      </div>
    {/if}
  </div>
  <p class="truncate font-mono text-xs text-muted-foreground">{srv.meta.summary}</p>
  <p class="text-xs text-muted-foreground">
    Квота: {srv.meta.storageMb} МБ · Макс. файл: {srv.meta.fileMb} МБ
  </p>
</div>
