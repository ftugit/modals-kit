<script lang="ts">
  /**
   * Карточка одной записи блокировки в списке `BlocksList`: рисует сферу,
   * статус активности / снятия / мягкого удаления, причину, срок и (в глобальном
   * списке без фиксированного `uid`) короткий `id` целевого пользователя.
   * О механике нажатия карточка не знает — её навешивает список на внешнюю ссылку.
   */
  import { Badge, TimeAgo } from '#components/ui/index.js'
  import { describeBlockScope } from '../../spec-block.js'
  import type { BlockView } from '../../types.js'

  interface Props {
    item: BlockView
    /** Показывать столбец целевого пользователя (в глобальном списке без `uid`). */
    showTarget?: boolean
  }

  let { item, showTarget = false }: Props = $props()

  const scopeInfo = $derived(describeBlockScope(item.scope))
  const isDeleted = $derived(item.deletedAt != null)
  const isActive = $derived(!isDeleted && (item.until === null || item.until > Date.now()))

  const cell = 'min-w-0 flex-1 basis-0 overflow-x-auto whitespace-nowrap [scrollbar-width:thin]'
</script>

<div class="flex w-full items-baseline gap-3 rounded-md px-2 py-2 text-left hover:bg-accent">
  <span
    class="{cell} text-sm font-medium"
    title={`${scopeInfo.title} — ${scopeInfo.description} (${item.scope})`}
    data-testid="block-cell-scope"
  >
    {scopeInfo.title}
  </span>

  <span class="shrink-0" data-testid="block-cell-status">
    {#if isDeleted}
      <Badge variant="destructive">удалена</Badge>
    {:else if isActive}
      <Badge variant="destructive">активна</Badge>
    {:else}
      <Badge variant="outline">снята</Badge>
    {/if}
  </span>

  <span class="{cell} text-xs text-muted-foreground" title={item.reason} data-testid="block-cell-reason">
    {item.reason}
  </span>

  <span class="{cell} text-xs text-muted-foreground" data-testid="block-cell-until">
    {#if item.until === null}
      бессрочно
    {:else}
      до <time datetime={new Date(item.until).toISOString()}>
        {new Date(item.until).toLocaleString('ru-RU')}
      </time>
    {/if}
  </span>

  {#if showTarget}
    <code class="{cell} text-xs text-muted-foreground" title={item.authId} data-testid="block-cell-user">
      {item.authId.slice(0, 8)}
    </code>
  {/if}

  <span class="{cell} text-xs text-muted-foreground" data-testid="block-cell-created">
    <TimeAgo value={item.at} />
  </span>
</div>
