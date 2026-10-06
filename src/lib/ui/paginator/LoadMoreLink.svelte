<script lang="ts">
  import type { Snippet } from 'svelte'
  import { canLoadMore } from '$lib/paginate'
  import {
    usePageHref,
    usePaginatorActions,
    usePaginatorOptions,
    usePaginatorState,
  } from '$lib/paginate/svelte'
  import Spinner from './Spinner.svelte'

  interface Props {
    dir: 1 | -1
    name?: string
    label?: string
    loadingLabel?: string
    class?: string
    children?: Snippet<[{ targetPage: number; loading: boolean; disabled: boolean }]>
  }

  let {
    dir,
    name,
    label,
    loadingLabel = 'Загрузка…',
    class: className,
    children,
  }: Props = $props()

  const pagState = usePaginatorState(name)
  const options = usePaginatorOptions(name)
  const actions = usePaginatorActions(name)

  const isManual = $derived(
    dir === 1 ? options().bottomTrigger === 'manual' : options().topTrigger === 'manual'
  )

  const minLoaded = $derived.by(() => {
    const pages = pagState().loadedPages
    return pages.length > 0 ? pages[0] : pagState().page
  })

  const maxLoaded = $derived.by(() => {
    const pages = pagState().loadedPages
    return pages.length > 0 ? pages[pages.length - 1] : pagState().page
  })

  const targetPage = $derived(dir === 1 ? maxLoaded + 1 : minLoaded - 1)
  const hrefGetter = usePageHref(() => targetPage, name)
  const href = $derived(hrefGetter())

  const loading = $derived.by(() => {
    const s = pagState()
    return s.status === 'loading' && s.pending?.page === targetPage
  })

  const disabled = $derived(loading || !canLoadMore(dir, pagState()))
  const defaultLabel = $derived(
    dir === 1 ? 'Показать ещё (следующие)' : 'Показать предыдущие'
  )
  const currentLabel = $derived(loading ? loadingLabel : label ?? defaultLabel)
</script>

{#if isManual && (canLoadMore(dir, pagState()) || loading)}
  {#if children}
    {@render children({ targetPage, loading, disabled })}
  {:else}
    <div class="my-2 flex justify-center">
      {#if disabled && !loading}
        <span
          class="inline-flex items-center gap-2 rounded-lg border border-border/50 px-4 py-2 text-sm text-muted-foreground/60 select-none"
          aria-disabled="true"
        >
          {currentLabel}
        </span>
      {:else}
        <a
          href={href ?? '#'}
          data-testid={`load-more-${dir === 1 ? 'bottom' : 'top'}`}
          aria-busy={loading ? 'true' : undefined}
          class={className ??
            'inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground shadow-xs transition hover:bg-accent hover:text-accent-foreground active:scale-[0.98]'}
          onclick={(e) => {
            e.preventDefault()
            if (!disabled) actions.loadMore(dir)
          }}
          onmouseenter={() => {
            if (!disabled && targetPage > 0) actions.prefetchPage(targetPage)
          }}
          onfocus={() => {
            if (!disabled && targetPage > 0) actions.prefetchPage(targetPage)
          }}
        >
          {#if loading}
            <Spinner size={14} />
          {/if}
          <span>{currentLabel}</span>
        </a>
      {/if}
    </div>
  {/if}
{/if}
