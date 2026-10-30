<script lang="ts">
  /**
   * Карточка seed-юзера — только рисунок: показывает ровно поля проекции,
   * которую отдала DB после ACL (`SeedUserView`): seed, никнейм (если
   * столбец включён), права, блокировки, времена. О нажатии карточка не
   * знает ничего: механика строки (профиль, другой компонент, выбор в
   * параметр) — атрибуты, которые список надевает на обёртку снаружи;
   * снаружи карточку не рисует никто, она живёт только внутри списка.
   *
   * Блоки делят ширину родителя поровну (`flex-1 basis-0`), а содержимое
   * при сжатии не урезается троеточием, а прокручивается внутри своего
   * блока (`overflow-x-auto`): значение целиком доступно скроллом блока
   * и в `title`.
   */
  import { TimeAgo } from '#components/ui/index.js'
  import { specProfile } from '../../spec-profile.js'
  import type { SeedUserView } from '../../types.js'

  interface Props {
    item: SeedUserView
    /** Выбранность (оформление): галочка и подсветка; смысл выбора — у механики снаружи. */
    selected?: boolean
  }

  let { item, selected = false }: Props = $props()

  const grants = $derived(item.permissions.length ? item.permissions.join(', ') : 'без прав')
  const blocks = $derived(item.blocked.map((b) => b.scope).join(', '))

  // Блок строки: равная доля ширины + аккуратное усечение троеточием (полное значение в title).
  const cell = 'min-w-0 flex-1 basis-0 truncate'
</script>

<div
  class="flex w-full items-baseline gap-3 rounded-md px-2 py-2 text-left {selected
    ? 'bg-accent ring-2 ring-ring'
    : 'hover:bg-accent'}"
>
  {#if selected}
    <span class="shrink-0 text-sm" aria-hidden="true" data-testid="seed-user-selected-mark">✓</span>
  {/if}
  {#if item.seed}
    <code class="{cell} text-sm" title={item.seed} data-testid="seed-user-cell">{item.seed}</code>
  {:else}
    <span class="{cell} text-sm text-muted-foreground" data-testid="seed-user-cell">seed стёрт (аккаунт-надгробие)</span>
  {/if}
  {#if item.nickname !== undefined}
    <!-- Столбец никнейма (этап 2): поле есть в выдаче только при включённом
         параметре и правах; нет ника/профиля — заглушка единой спеки
         профиля (`specProfile`, этапы 3+4). -->
    <span
      class="{cell} text-xs text-muted-foreground"
      title={item.nickname ?? undefined}
      data-testid="seed-user-nickname"
    >
      {item.nickname ?? specProfile.nicknameMissing}
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
