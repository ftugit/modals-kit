<script lang="ts">
  import { untrack } from 'svelte'
  import type { Snippet } from 'svelte'
  import { paginatorTask, usePaginatorState } from '#lib/paginate/svelte/index.js'
  import { taskPercent } from '#lib/task/index.js'
  import { trackTask } from '#hooks/loader.svelte.js'
  import { Spinner } from '../../ui/index.js'

  interface Props {
    name?: string
    text?: string
    children?: Snippet
  }

  let { name: nameProp, text = 'Загрузка…', children }: Props = $props()
  // Имя пагинатора — идентичность экземпляра: читается один раз при монтировании.
  // Другое имя = другой пагинатор; пересоздаёт компонент родитель (`{#key}`).
  const name = untrack(() => nameProp)
  const pagState = usePaginatorState(name)
  const task = $derived(paginatorTask(pagState()))
  const isBusy = $derived(pagState().status === 'loading')
  const percent = $derived(taskPercent(task))

  $effect(() => trackTask(() => task))
</script>

{#if isBusy}
  <div
    role="status"
    aria-live="polite"
    data-testid="loading-indicator"
    data-task-percent={percent !== null ? String(percent) : undefined}
    class="pointer-events-none sticky top-2 z-10 flex justify-center"
  >
    {#if children}
      {@render children()}
    {:else}
      <div class="flex items-center gap-2 rounded-full border border-border bg-popover/90 px-3 py-1 text-xs text-popover-foreground shadow-md backdrop-blur-xs">
        <Spinner size={13} class="text-muted-foreground" />
        <span>{percent !== null ? `${text} ${percent}%` : text}</span>
      </div>
    {/if}
  </div>
{/if}
