<script lang="ts">
  import type { Snippet } from 'svelte'
  import { buttonVariants } from '$lib/ui/primitives'
  import { usePaginatorActions, usePaginatorState } from '$lib/paginate/svelte'

  interface Props {
    name?: string
    retryLabel?: string
    children?: Snippet<[{ error: string | null; retry: () => void }]>
  }

  let { name, retryLabel = 'Повторить', children }: Props = $props()
  const pagState = usePaginatorState(name)
  const { retry } = usePaginatorActions(name)
</script>

{#if pagState().status === 'error'}
  {#if children}
    {@render children({ error: pagState().error, retry })}
  {:else}
    <div
      role="alert"
      data-testid="error-row"
      class="my-2 flex items-center justify-between rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
    >
      <span>Ошибка загрузки: {pagState().error ?? 'неизвестная ошибка'}</span>
      <button
        type="button"
        class={buttonVariants({ variant: 'outline', size: 'sm' })}
        onclick={() => retry()}
      >
        {retryLabel}
      </button>
    </div>
  {/if}
{/if}
