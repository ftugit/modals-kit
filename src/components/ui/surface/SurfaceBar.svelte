<script lang="ts">
  /**
   * Верхний ряд поверхности: три зоны `leading` / `center` / `end`.
   *
   * Механика повторяет `shell/HeaderRowView.svelte`, но зоны здесь равноправны
   * и ведут себя одинаково: каждая скроллится по горизонтали независимо
   * (`overflow-x-auto` + скрытый скроллбар) и переносится на новую строку,
   * когда места не хватает (`flex-wrap` у контейнера). `center` забирает
   * свободное место — поэтому `title` стоит по центру, пока соседи не
   * упрутся, и уезжает вниз первым при тесноте.
   *
   * Пустая зона не рендерится: без `center` ряд схлопывается в привычную
   * пару «слева / справа».
   */
  import type { Snippet } from 'svelte'
  import { cn } from '#components/utils.js'

  interface Props {
    /** Левая зона: навигация назад, контекст экрана. */
    leading?: Snippet
    /** Центральная зона: заголовок и его бейджи. */
    center?: Snippet
    /** Правая зона: действия экрана, прижимается вправо (`ml-auto`). */
    end?: Snippet
    /** Дополнительные классы ряда (например, `border-b`). */
    class?: string
  }

  let { leading, center, end, class: cls }: Props = $props()

  // Общий вид одной зоны: не даём содержимому распирать ряд и прячем
  // скроллбар — прокрутка остаётся, полоса нет.
  const zone = 'flex min-w-0 items-center gap-2 overflow-x-auto whitespace-nowrap [scrollbar-width:none]'
</script>

<div class={cn('flex w-full flex-wrap items-center gap-x-3 gap-y-2', cls)}>
  {#if leading}
    <div class={zone} data-surface-zone="leading">
      {@render leading()}
    </div>
  {/if}

  {#if center}
    <div class={cn(zone, 'flex-1')} data-surface-zone="center">
      {@render center()}
    </div>
  {/if}

  {#if end}
    <div class={cn(zone, 'ml-auto justify-end')} data-surface-zone="end">
      {@render end()}
    </div>
  {/if}
</div>
