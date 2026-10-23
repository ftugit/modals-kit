<script lang="ts">
  import { untrack } from 'svelte'
  import type { Snippet } from 'svelte'
  import { usePaginatorState } from '#lib/paginate/svelte/index.js'

  interface Props {
    name?: string
    children?: Snippet
  }

  let { name: nameProp, children }: Props = $props()
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
      class="flex h-32 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground"
    >
      Ничего не найдено
    </div>
  {/if}
{/if}
