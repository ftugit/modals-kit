<script lang="ts">
  /**
   * Строка списка seed-юзеров — только просмотр: действий у строки нет.
   * Показывает ровно поля проекции, которую отдала DB после ACL
   * (`SeedUserView`): seed, права, блокировки, времена.
   *
   * Блоки строки делят ширину родителя поровну (`flex-1 basis-0`), а
   * содержимое блока при сжатии не урезается троеточием, а прокручивается
   * внутри своего блока (`overflow-x-auto`): значение целиком доступно
   * скроллом блока и в `title`.
   */
  import { TimeAgo } from '#components/ui/index.js'
  import type { SeedUserView } from '../../types.js'

  interface Props {
    item: SeedUserView
  }

  let { item }: Props = $props()

  const grants = $derived(item.permissions.length ? item.permissions.join(', ') : 'без прав')
  const blocks = $derived(item.blocked.map((b) => b.scope).join(', '))

  // Блок строки: равная доля ширины + собственный горизонтальный скролл.
  const cell = 'min-w-0 flex-1 basis-0 overflow-x-auto whitespace-nowrap [scrollbar-width:thin]'
</script>

<div
  class="flex w-full items-baseline gap-3 px-2 py-2"
  data-testid="seed-user-row"
  data-id={item.id}
>
  {#if item.seed}
    <code class="{cell} text-sm" title={item.seed} data-testid="seed-user-cell">{item.seed}</code>
  {:else}
    <span class="{cell} text-sm text-muted-foreground" data-testid="seed-user-cell">seed стёрт (аккаунт-надгробие)</span>
  {/if}
  {#if item.nickname !== undefined}
    <!-- Столбец никнейма (этап 2): поле есть в выдаче только при включённом
         параметре и правах; нет ника/профиля — литеральный NULL. -->
    <span
      class="{cell} text-xs text-muted-foreground"
      title={item.nickname ?? undefined}
      data-testid="seed-user-nickname"
    >
      {item.nickname ?? 'NULL'}
    </span>
  {/if}
  <span class="{cell} text-xs text-muted-foreground" title={grants} data-testid="seed-user-cell">{grants}</span>
  {#if blocks}
    <span class="{cell} text-xs text-destructive" title={`Блокировки: ${blocks}`} data-testid="seed-user-cell">блок: {blocks}</span>
  {/if}
  {#if item.deletedAt}
    <span class="{cell} text-xs text-destructive" data-testid="seed-user-cell">на удалении</span>
  {/if}
  <span class="{cell} text-xs text-muted-foreground" data-testid="seed-user-cell">
    <TimeAgo value={item.createdAt} />
  </span>
  <code class="{cell} text-xs text-muted-foreground" title={item.id} data-testid="seed-user-cell">{item.id.slice(0, 8)}</code>
</div>
