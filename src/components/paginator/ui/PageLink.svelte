<script lang="ts">
  import { untrack } from 'svelte'
  import type { Snippet } from 'svelte'
  import { asLink, taskAttrs, type LinkIndicatorMode } from '#hooks/links/index.js'
  import { buttonVariants } from '#components/ui/index.js'
  import { paginatorTask, usePageHref, usePaginatorActions, usePaginatorState } from '#lib/paginate/svelte/index.js'

  interface Props {
    page: number
    name?: string
    current?: boolean
    disabled?: boolean
    label?: string
    /**
     * Отображение спиннера загрузки на элементе страницы:
     *   - `false` (по умолчанию) — отключено (скролл и переходы не мигают на номерах);
     *   - `'click'` — только если нажатие произошло по этому самому элементу;
     *   - `true` — всегда, пока грузится эта страница.
     */
    indicator?: LinkIndicatorMode
    class?: string
    children?: Snippet
  }

  let {
    page,
    name: nameProp,
    current = false,
    disabled = false,
    label,
    indicator = false,
    class: className,
    children,
  }: Props = $props()
  // Имя пагинатора — идентичность экземпляра: читается один раз при монтировании.
  // Другое имя = другой пагинатор; пересоздаёт компонент родитель (`{#key}`).
  const name = untrack(() => nameProp)

  const hrefGetter = usePageHref(() => page, name)
  const href = $derived(hrefGetter())
  const { goPage, prefetchPage } = usePaginatorActions(name)
  const pagState = usePaginatorState(name)
  const task = () => paginatorTask(pagState(), page)

  // Собственный факт клика сохраняется на экземпляре `PageLink`, потому что
  // при клике по `<a>` страница сразу становится `current`, и в DOM рендерится `<span>`.
  let clicked = $state(false)
  $effect(() => {
    if (task().status !== 'pending') clicked = false
  })

  const showIndicator = () => indicator === true || (indicator === 'click' && clicked)

  const cls = $derived(
    className ??
      buttonVariants({
        variant: current ? 'default' : 'outline',
        size: 'sm',
      }),
  )
</script>

{#if href !== null && !current && !disabled}
  <a
    {...asLink(href, { task, indicator: showIndicator() })}
    class={cls}
    aria-label={label}
    aria-current={current ? 'page' : undefined}
    onmouseenter={() => prefetchPage(page)}
    onfocus={() => prefetchPage(page)}
    onclick={(e) => {
      e.preventDefault()
      clicked = true
      goPage(page)
    }}
  >
    {#if children}
      {@render children()}
    {:else}
      {page}
    {/if}
  </a>
{:else if href !== null}
  <span
    {...taskAttrs(task, { indicator: showIndicator })}
    class={cls}
    aria-label={label}
    aria-current={current ? 'page' : undefined}
  >
    {#if children}
      {@render children()}
    {:else}
      {page}
    {/if}
  </span>
{:else}
  <button
    type="button"
    {...(indicator ? taskAttrs(task, { indicator: showIndicator }) : {})}
    class={cls}
    disabled={current || disabled}
    aria-label={label}
    aria-current={current ? 'page' : undefined}
    onclick={() => {
      clicked = true
      goPage(page)
    }}
    onmouseenter={() => {
      if (!current && !disabled) prefetchPage(page)
    }}
  >
    {#if children}
      {@render children()}
    {:else}
      {page}
    {/if}
  </button>
{/if}
