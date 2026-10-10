<script lang="ts">
  /**
   * Оптимистичная карточка: строка, которой ещё нет в источнике.
   *
   * Отдельная компонента, а не `{#snippet}` внутри списка, по прозаической
   * причине: snippet, объявленный в детях `<PaginatorHost>`, был бы ещё и
   * пропом хосту — «лишнее поле» в контракте страницы. Здесь же контракт явный:
   * карточка + опциональный хранилище, из которого берутся `retry`/`drop`.
   *
   * Разметку строки не дублируем: `DbPostRow` знает про `pending` (полупрозрачность
   * и «назначит сервер» вместо `created_at`) и про кнопки. Поэтому вид карточки и
   * вид пришедшей с сервера строки отличается РОВНО степенью уверенности — иначе
   * демо проверяло бы две разные вёрстки, а не «та же строка до ответа».
   */
  import type { Optimistic, OptimisticCard } from './optimistic.svelte'
  import DbPostRow from './DbPostRow.svelte'

  interface Props {
    card: OptimisticCard
    /** Без хранилища карточка читается, но кнопок нет (например, в SSR-снапшоте). */
    optimistic?: Optimistic | null
  }

  let { card, optimistic = null }: Props = $props()
</script>

<DbPostRow
  item={card.row ?? { id: card.tmpId, title: card.title }}
  pending={card.state !== 'settled'}
  testid="pending-row"
  full
>
  {#snippet renderActions()}
    {#if card.state === 'failed'}
      <span class="text-xs text-destructive" data-testid="pending-error">{card.error}</span>
      {#if optimistic}
        <button class="text-xs underline" data-testid="pending-retry"
          onclick={() => optimistic?.retry(card.tmpId)}>повторить</button>
        <button class="text-xs text-muted-foreground underline" data-testid="pending-drop"
          onclick={() => optimistic?.drop(card.tmpId)}>убрать</button>
      {/if}
    {:else if card.state === 'pending'}
      <span class="text-xs text-muted-foreground" data-testid="pending-note">ждём сервер</span>
    {/if}
  {/snippet}
</DbPostRow>
