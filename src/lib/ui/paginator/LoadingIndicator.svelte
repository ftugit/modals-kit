<script lang="ts">
  import type { Snippet } from 'svelte'
  import { usePaginatorState } from '$lib/paginate/svelte'
  import Spinner from './Spinner.svelte'

  interface Props {
    name?: string
    text?: string
    children?: Snippet
  }

  let { name, text = 'Загрузка…', children }: Props = $props()
  const pagState = usePaginatorState(name)
  const isBusy = $derived(pagState().status === 'loading')
</script>

{#if isBusy}
  <div
    role="status"
    aria-live="polite"
    data-testid="loading-indicator"
    class="pointer-events-none sticky top-2 z-10 flex justify-center"
  >
    {#if children}
      {@render children()}
    {:else}
      <div class="flex items-center gap-2 rounded-full border border-border bg-popover/90 px-3 py-1 text-xs text-popover-foreground shadow-md backdrop-blur-xs">
        <Spinner size={13} />
        <span>{text}</span>
      </div>
    {/if}
  </div>
{/if}
