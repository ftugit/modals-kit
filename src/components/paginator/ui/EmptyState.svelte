<script lang="ts">
  import { untrack } from 'svelte'
  import type { Snippet } from 'svelte'
  import { cn } from '#components/utils.js'
  import { usePaginatorState } from '#lib/paginate/svelte/index.js'

  interface Props {
    name?: string
    /** Классы корневого элемента умолчательной разметки (свои `children` стилизует сам потребитель). */
    class?: string
    children?: Snippet
  }

  let { name: nameProp, class: className, children }: Props = $props()
  // Имя пагинатора — идентичность экземпляра: читается один раз при монтировании.
  // Другое имя = другой пагинатор; пересоздаёт компонент родитель (`{#key}`).
  const name = untrack(() => nameProp)
  const pagState = usePaginatorState(name)
  const isReadyAndEmpty = $derived(
    pagState().status === 'idle' &&
      pagState().loadedPages.length > 0 &&
      Object.values(pagState().pages).every((p) => p.length === 0)
  )
</script>

{#if isReadyAndEmpty}
  {#if children}
    {@render children()}
  {:else}
    <div
      data-testid="empty-state"
      class={cn('flex h-32 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground', className)}
    >
      Ничего не найдено
    </div>
  {/if}
{/if}
