<script lang="ts">
  /**
   * Строка списка seed-юзеров — только просмотр: действий у строки нет.
   * Показывает ровно поля проекции, которую отдала DB после ACL
   * (`SeedUserView`): seed, права, блокировки, времена. Полные значения живут
   * в `title` (копирование), в разметке строки урезаны по ширине.
   */
  import type { SeedUserView } from '../../types.js'

  interface Props {
    item: SeedUserView
  }

  let { item }: Props = $props()

  const created = $derived(new Date(item.createdAt).toLocaleString())
  const grants = $derived(item.permissions.length ? item.permissions.join(', ') : 'без прав')
  const blocks = $derived(item.blocked.map((b) => b.scope).join(', '))
</script>

<div
  class="flex items-baseline gap-3 px-2 py-2"
  data-testid="seed-user-row"
  data-id={item.id}
>
  {#if item.seed}
    <code class="min-w-0 flex-1 truncate text-sm" title={item.seed}>{item.seed}</code>
  {:else}
    <span class="min-w-0 flex-1 truncate text-sm text-muted-foreground">seed стёрт (аккаунт-надгробие)</span>
  {/if}
  {#if item.nickname !== undefined}
    <!-- Столбец никнейма (этап 2): поле есть в выдаче только при включённом
         параметре и правах; нет ника/профиля — литеральный NULL. -->
    <span
      class="max-w-40 truncate text-xs text-muted-foreground"
      title={item.nickname ?? undefined}
      data-testid="seed-user-nickname"
    >
      {item.nickname ?? 'NULL'}
    </span>
  {/if}
  <span class="max-w-44 truncate text-xs text-muted-foreground" title={grants}>{grants}</span>
  {#if blocks}
    <span class="max-w-32 truncate text-xs text-destructive" title={`Блокировки: ${blocks}`}>блок: {blocks}</span>
  {/if}
  {#if item.deletedAt}
    <span class="shrink-0 text-xs text-destructive">на удалении</span>
  {/if}
  <span class="max-w-32 truncate text-xs text-muted-foreground" title={created}>{created}</span>
  <code class="max-w-24 truncate text-xs text-muted-foreground" title={item.id}>{item.id.slice(0, 8)}</code>
</div>
