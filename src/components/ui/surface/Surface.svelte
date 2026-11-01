<script lang="ts" module>
  import type { Snippet } from 'svelte'
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

  /**
   * Две группы верхней панели. `start` прижимается влево, `end` — вправо
   * (`ml-auto`); при нехватке места группы переносятся на новую строку.
   */
  export interface SurfaceControls {
    start?: Snippet
    end?: Snippet
  }
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
  // `Snippet` уже импортирован в module-скрипте: для проверки типов область
  // видимости общая, второй импорт даёт `Duplicate identifier`.
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
    /** Правая зона шапки: действия экрана, либо две группы `{ start, end }`. */
    controls?: Snippet | SurfaceControls
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

  // Титул-снипет рисуется в центре ряда, строка — как `h2`.
  const titleIsSnippet = $derived(typeof title !== 'string' && title !== undefined)

  // `controls` — либо один снипет (он уходит вправо), либо две группы.
  const controlGroups = $derived(
    controls !== undefined && typeof controls !== 'function'
      ? (controls as SurfaceControls)
      : undefined,
  )
  const controlSnippet = $derived(
    typeof controls === 'function' ? (controls as Snippet) : undefined,
  )

  const hasLeading = $derived(Boolean(leading || controlGroups?.start))
  const hasEnd = $derived(Boolean(controlSnippet || controlGroups?.end))

  const hasHeader = $derived(
    Boolean(hasLeading || title !== undefined || description !== undefined || hasEnd),
  )
</script>

{#snippet mergedLeading()}
  {#if leading}{@render leading()}{/if}
  {#if controlGroups?.start}{@render controlGroups.start()}{/if}
{/snippet}

{#snippet mergedEnd()}
  {#if controlSnippet}{@render controlSnippet()}{/if}
  {#if controlGroups?.end}{@render controlGroups.end()}{/if}
{/snippet}

<section
  {...rest}
  class={cn('flex min-h-0 flex-col', variant === 'plain' && 'flex-auto', surfaceVariants({ variant }), cls)}
  data-surface-variant={variant}
>
  {#if hasHeader}
    <SurfaceBar
      leading={hasLeading ? mergedLeading : undefined}
      end={hasEnd ? mergedEnd : undefined}
      class={cn('shrink-0', body && 'border-b border-border pb-4')}
    >
      {#snippet center()}
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          {#if title !== undefined}
            <div class="flex min-w-0 flex-wrap items-center gap-2">
              {#if titleIsSnippet}
                {@render (title as Snippet)()}
              {:else}
                <h2 class="min-w-0 flex-1 truncate text-lg font-semibold leading-tight tracking-tight">
                  {title}
                </h2>
              {/if}
            </div>
          {/if}
          {#if description !== undefined}
            {#if typeof description === 'string'}
              <p class="whitespace-normal break-words text-sm text-muted-foreground">{description}</p>
            {:else}
              {@render (description as Snippet)()}
            {/if}
          {/if}
        </div>
      {/snippet}
    </SurfaceBar>
  {/if}

  {#if body}
    <div
      class={cn(
        'flex min-h-0 flex-col gap-4',
        hasHeader && (scrollBody ? 'pt-4' : 'pt-5'),
        scrollBody && '-mx-1 flex-auto overflow-y-auto overscroll-contain px-1',
      )}
      data-surface-body=""
    >
      {@render body()}
    </div>
  {/if}
</section>
