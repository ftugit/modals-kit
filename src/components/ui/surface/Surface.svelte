<script lang="ts" module>
  import { variants } from '#components/utils.js'

  /**
   * Оформление поверхности. `card` — самостоятельный экран на странице:
   * рамка и отступ `p-6` живут на корне. `plain` — экран внутри модалки:
   * ни рамки, ни отступа (их даёт сама модалка), зато корень тянется на всю
   * высоту и умеет честно скроллить тело.
   */
  export const surfaceVariants = variants(
    '',
    {
      variant: {
        card: 'rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm',
        plain: '',
      },
    },
    { variant: 'card' },
  )

  export type SurfaceVariant = 'card' | 'plain'
</script>

<script lang="ts">
  /**
   * Экранный блок, одинаковый на странице и в модалке.
   *
   * Задача — убрать расхождение, из-за которого в модалках контент обрезался
   * по высоте: шапка (`title` + `controls`) закреплена сверху (`shrink-0`),
   * тело получает `min-h-0 flex-auto overflow-y-auto` и скроллится само.
   * На странице (`variant="card"`) тело не скроллится — там скроллится
   * документ, и второй скроллбар был бы лишним.
   *
   * Шапка собирается из `SurfaceBar`: левая зона (`leading`), центр
   * (`title`) и правая (`controls`). Каждая зона независимо скроллится по
   * горизонтали и переносится на новую строку, когда места мало.
   *
   * Отступ `p-6` — только на корне варианта `card`. В `plain` его нет:
   * модалка уже дала свой, второй дал бы двойную рамку отступа.
   */
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { cn } from '#components/utils.js'
  import SurfaceBar from './SurfaceBar.svelte'

  interface Props extends Omit<HTMLAttributes<HTMLElement>, 'title' | 'children'> {
    /** `card` — страница роута, `plain` — внутри модалки. */
    variant?: SurfaceVariant
    /** Заголовок: строка или снипет с бейджем/счётчиком. */
    title?: string | Snippet
    /** Краткое описание под заголовком (строка или снипет). */
    description?: string | Snippet
    /** Левая зона шапки: навигация, контекст. */
    leading?: Snippet
    /** Правая зона шапки: действия экрана. */
    controls?: Snippet
    /** Тело экрана. `children` — то же самое через стандартный проп. */
    render?: Snippet
    children?: Snippet
    /** Скроллить тело. По умолчанию — только в `plain`. */
    scroll?: boolean
    /** Дополнительные классы корня. */
    class?: string
  }

  let {
    variant = 'card',
    title,
    description,
    leading,
    controls,
    render,
    children,
    scroll,
    class: cls,
    ...rest
  }: Props = $props()

  const body = $derived(render ?? children)
  const scrollBody = $derived(scroll ?? variant === 'plain')
  const hasHeader = $derived(Boolean(leading || title || controls))

  // Титул-снипет рисуется в центре ряда, строка — как `h2`.
  const titleIsSnippet = $derived(typeof title !== 'string' && title !== undefined)
</script>

<section
  {...rest}
  class={cn('flex min-h-0 flex-col', variant === 'plain' && 'flex-auto', surfaceVariants({ variant }), cls)}
  data-surface-variant={variant}
>
  {#if hasHeader}
    <SurfaceBar
      {leading}
      class={cn('shrink-0', body && 'border-b border-border pb-4')}
    >
      {#snippet center()}
        <div class="flex min-w-0 flex-col gap-1">
          {#if title !== undefined}
            <div class="flex flex-wrap items-center gap-2">
              {#if titleIsSnippet}
                {@render (title as Snippet)()}
              {:else}
                <h2 class="truncate text-lg font-semibold leading-tight tracking-tight">
                  {title}
                </h2>
              {/if}
            </div>
          {/if}
          {#if description !== undefined}
            {#if typeof description === 'string'}
              <p class="text-sm text-muted-foreground">{description}</p>
            {:else}
              {@render (description as Snippet)()}
            {/if}
          {/if}
        </div>
      {/snippet}
      {#snippet end()}
        {#if controls}{@render controls()}{/if}
      {/snippet}
    </SurfaceBar>
  {/if}

  {#if body}
    <div
      class={cn(
        'flex min-h-0 flex-col gap-4',
        hasHeader && (scrollBody ? 'pt-4' : 'pt-5'),
        scrollBody && 'flex-auto overflow-y-auto overscroll-contain',
      )}
      data-surface-body=""
    >
      {@render body()}
    </div>
  {/if}
</section>
