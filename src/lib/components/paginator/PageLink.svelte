<script lang="ts">
  import { untrack } from 'svelte'
  import type { Snippet } from 'svelte'
  import { asLink, taskAttrs } from '#lib/components/links/index.js'
  import { buttonVariants } from '#lib/components/ui/index.js'
  import { paginatorTask, usePageHref, usePaginatorActions, usePaginatorState } from '#lib/paginate/svelte/index.js'

  interface Props {
    page: number
    name?: string
    current?: boolean
    disabled?: boolean
    label?: string
    class?: string
    children?: Snippet
  }

  let {
    page,
    name: nameProp,
    current = false,
    disabled = false,
    label,
    class: className,
    children,
  }: Props = $props()
  // Имя пагинатора — идентичность экземпляра: читается один раз при монтировании.
  // Другое имя = другой пагинатор; пересоздаёт компонент родитель (`{#key}`).
  const name = untrack(() => nameProp)

  const hrefGetter = usePageHref(() => page, name)
  const href = $derived(hrefGetter())
  const { goPage, prefetchPage } = usePaginatorActions(name)
  // Спиннер у страницы, которая грузится (тот же вид, что у ссылок).
  const pagState = usePaginatorState(name)
  const task = () => paginatorTask(pagState(), page)

  const cls = $derived(
    className ??
      buttonVariants({
        variant: current ? 'default' : 'outline',
        size: 'sm',
      })
  )
</script>

{#if href !== null && !current && !disabled}
  <a {...asLink(href, { task })}
    class={cls}
    aria-label={label}
    aria-current={current ? 'page' : undefined}
    onmouseenter={() => prefetchPage(page)}
    onfocus={() => prefetchPage(page)}
    onclick={(e) => {
      e.preventDefault()
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
  <!-- Текущая страница, пока грузится, — со спиннером: нажатая ссылка
       сразу становится текущей, и задача видна здесь. -->
  <span
    {...taskAttrs(task)}
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
    class={cls}
    disabled={current || disabled}
    aria-label={label}
    aria-current={current ? 'page' : undefined}
    onclick={() => goPage(page)}
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
