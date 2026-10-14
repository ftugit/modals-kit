<script lang="ts">
  import { untrack } from 'svelte'
  import type { Snippet } from 'svelte'
  import { Alert, buttonVariants } from '#lib/ui/primitives/index.js'
  import { usePaginatorActions, usePaginatorState } from '#lib/paginate/svelte/index.js'

  interface Props {
    name?: string
    retryLabel?: string
    children?: Snippet<[{ error: string | null; retry: () => void }]>
  }

  let { name: nameProp, retryLabel = 'Повторить', children }: Props = $props()
  // Имя пагинатора — идентичность экземпляра: читается один раз при монтировании.
  // Другое имя = другой пагинатор; пересоздаёт компонент родитель (`{#key}`).
  const name = untrack(() => nameProp)
  const pagState = usePaginatorState(name)
  const { retry } = usePaginatorActions(name)
</script>

{#if pagState().status === 'error'}
  {#if children}
    {@render children({ error: pagState().error, retry })}
  {:else}
    <Alert variant="destructive" data-testid="error-row" class="my-2">
      <div class="flex items-center justify-between gap-3 justify-self-stretch">
        <span>Ошибка загрузки: {pagState().error ?? 'неизвестная ошибка'}</span>
        <button type="button" class={buttonVariants({ variant: 'outline', size: 'sm' })} onclick={() => retry()}>
          {retryLabel}
        </button>
      </div>
    </Alert>
  {/if}
{/if}
