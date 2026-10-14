<script lang="ts">
  import { untrack } from 'svelte'
  import type { Snippet } from 'svelte'
  import { buttonVariants, Link } from '#lib/ui/primitives/index.js'
  import { usePageHref, usePaginatorActions } from '#lib/paginate/svelte/index.js'

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

  const cls = $derived(
    className ??
      buttonVariants({
        variant: current ? 'default' : 'outline',
        size: 'sm',
      })
  )
</script>

{#if href !== null && !current && !disabled}
  <Link
    class={cls}
    {href}
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
  </Link>
{:else if href !== null}
  <span
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
