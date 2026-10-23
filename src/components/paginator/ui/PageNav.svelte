<script lang="ts">
  import { untrack } from 'svelte'
  import type { Snippet } from 'svelte'
  import { pageWindow } from '#lib/paginate/index.js'
  import { usePaginatorState } from '#lib/paginate/svelte/index.js'
  import type { LinkIndicatorMode } from '#hooks/links/index.js'
  import { ButtonGroup, buttonVariants } from '#components/ui/index.js'
  import PageLink from './PageLink.svelte'

  export interface PageNavRenderProps {
    page: number
    totalPages: number | null
    canPrev: boolean
    canNext: boolean
    window: readonly (number | 'gap')[]
  }

  interface Props {
    name?: string
    around?: number
    /** Режим спиннера на ссылках страниц (`false` по умолчанию, `'click'` или `true`). */
    indicator?: LinkIndicatorMode
    class?: string
    counter?: boolean | Snippet<[{ page: number; total: number | null }]>
    children?: Snippet
    renderNav?: Snippet<[PageNavRenderProps]>
  }

  let {
    name: nameProp,
    around = 2,
    indicator = false,
    class: className,
    counter,
    children,
    renderNav,
  }: Props = $props()
  // Имя пагинатора — идентичность экземпляра: читается один раз при монтировании.
  // Другое имя = другой пагинатор; пересоздаёт компонент родитель (`{#key}`).
  const name = untrack(() => nameProp)

  const pagState = usePaginatorState(name)
  const total = $derived(pagState().totalPages)
  const current = $derived(pagState().page)
  const win = $derived(
    total != null && total > 0 ? pageWindow(total, current, around) : []
  )
  const canPrev = $derived(current > 1)
  const canNext = $derived(
    total != null ? current < total : pagState().hasNext !== false
  )
</script>

{#if renderNav}
  {@render renderNav({
    page: current,
    totalPages: total,
    canPrev,
    canNext,
    window: win,
  })}
{:else}
  <nav
    aria-label="Навигация по страницам"
    data-testid="page-nav"
    class={className ??
      'sticky bottom-0 mt-2 flex items-center justify-center gap-3 bg-background/90 px-2 py-2 backdrop-blur'}
  >
    <ButtonGroup>
      <PageLink
        {name}
        page={current - 1}
        disabled={!canPrev}
        {indicator}
        label="Назад"
      >
        ←
      </PageLink>

      {#if total != null}
        {#each win as entry, i (i + '-' + entry)}
          {#if entry === 'gap'}
            <span
              class={buttonVariants({
                variant: 'outline',
                size: 'sm',
                class: 'cursor-default',
              })}
            >
              …
            </span>
          {:else}
            <PageLink {name} page={entry} current={entry === current} {indicator}>
              {entry}
            </PageLink>
          {/if}
        {/each}
      {/if}

      <PageLink
        {name}
        page={current + 1}
        disabled={!canNext}
        {indicator}
        label="Вперёд"
      >
        →
      </PageLink>
    </ButtonGroup>

    {#if counter !== false && total != null && total > 0}
      {#if typeof counter === 'function'}
        {@render counter({ page: current, total })}
      {:else}
        <span class="text-xs tabular-nums text-muted-foreground">
          {`СТР ${current} из ${total}`}
        </span>
      {/if}
    {/if}

    {#if children}
      {@render children()}
    {/if}
  </nav>
{/if}
