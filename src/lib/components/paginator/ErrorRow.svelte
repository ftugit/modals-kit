<script lang="ts">
  import { untrack } from 'svelte'
  import type { Snippet } from 'svelte'
  import { Alert, buttonVariants } from '#lib/components/ui/index.js'
  import { usePaginatorActions, usePaginatorState } from '#lib/paginate/svelte/index.js'
  import ResetButton from './ResetButton.svelte'

  /**
   * Коды отказа, после которых повтор бессмыслен и помогает начало с первой страницы
   * (то же, что `ResetButton`): истёкший токен курсора. `validation` сюда не входит:
   * негодный фильтр сброс страницы сохраняет — отказ повторился бы и после него.
   */
  const RESTART_CODES: readonly string[] = ['cursor']

  interface Props {
    name?: string
    retryLabel?: string
    restartLabel?: string
    /** Коды `state.errorCode`, при которых вместо повтора — начало с первой страницы. */
    restartCodes?: readonly string[]
    children?: Snippet<[{
      error: string | null
      code: string | null
      /** Повтор бессмыслен: предложить `reset`, а не `retry`. */
      restart: boolean
      retry: () => void
      reset: () => void
    }]>
  }

  let {
    name: nameProp,
    retryLabel = 'Повторить',
    restartLabel = 'Начать сначала',
    restartCodes = RESTART_CODES,
    children,
  }: Props = $props()
  // Имя пагинатора — идентичность экземпляра: читается один раз при монтировании.
  // Другое имя = другой пагинатор; пересоздаёт компонент родитель (`{#key}`).
  const name = untrack(() => nameProp)
  const pagState = usePaginatorState(name)
  const { retry, reset } = usePaginatorActions(name)
  const code = $derived(pagState().errorCode ?? null)
  const restart = $derived(code !== null && restartCodes.includes(code))
</script>

{#if pagState().status === 'error'}
  {#if children}
    {@render children({ error: pagState().error, code, restart, retry, reset })}
  {:else}
    <Alert variant="destructive" data-testid="error-row" data-error-code={code} class="my-2">
      <div class="flex items-center justify-between gap-3 justify-self-stretch">
        <span>Ошибка загрузки: {pagState().error ?? 'неизвестная ошибка'}</span>
        {#if restart}
          <ResetButton {name} class={buttonVariants({ variant: 'outline', size: 'sm' })}>{restartLabel}</ResetButton>
        {:else}
          <button type="button" class={buttonVariants({ variant: 'outline', size: 'sm' })} onclick={() => retry()}>
            {retryLabel}
          </button>
        {/if}
      </div>
    </Alert>
  {/if}
{/if}
