<script lang="ts">
  import type { Snippet } from 'svelte'
  import { LoadMoreSlot, type LoadMoreSlotRender } from '$lib/paginate/svelte'
  import { buttonVariants } from '$lib/ui/primitives'
  import Spinner from './Spinner.svelte'

  interface Props {
    dir: 1 | -1
    name?: string
    action?: 'auto' | 'load' | 'go'
    always?: boolean
    label?: (p: LoadMoreSlotRender) => string
    class?: string
    children?: Snippet<[LoadMoreSlotRender]>
  }

  let {
    dir,
    name,
    action = 'auto',
    always = false,
    label,
    class: className,
    children,
  }: Props = $props()

  function defaultText(p: LoadMoreSlotRender): string {
    if (label) return label(p)
    return p.dir === -1
      ? `↑ показать предыдущую страницу (${p.page})`
      : `↓ показать следующую страницу (${p.page})`
  }
</script>

<LoadMoreSlot {dir} {name} {action} {always}>
  {#snippet children(p)}
    {#if children}
      {@render children(p)}
    {:else}
      <div class="flex justify-center py-1">
        {#if p.href !== null}
          <a
            href={p.href}
            data-testid={p.dir === -1 ? 'load-prev' : 'load-next'}
            class={className ?? buttonVariants({ variant: 'ghost', size: 'xs' })}
            aria-busy={p.loading}
            onclick={p.onClick}
          >
            {#if p.loading}
              <Spinner />
            {/if}
            {defaultText(p)}
          </a>
        {:else}
          <button
            type="button"
            data-testid={p.dir === -1 ? 'load-prev' : 'load-next'}
            class={className ?? buttonVariants({ variant: 'ghost', size: 'xs' })}
            disabled={p.loading}
            onclick={() => p.load()}
          >
            {#if p.loading}
              <Spinner />
            {/if}
            {defaultText(p)}
          </button>
        {/if}
      </div>
    {/if}
  {/snippet}
</LoadMoreSlot>
