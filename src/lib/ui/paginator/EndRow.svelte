<script lang="ts">
  import { untrack } from 'svelte'
  import type { Snippet } from 'svelte'
  import { usePaginatorState } from '#lib/paginate/svelte/index.js'

  interface Props {
    name?: string
    text?: string
    children?: Snippet
  }

  let { name: nameProp, text = 'Конец — всё загружено', children }: Props = $props()
  // Имя пагинатора — идентичность экземпляра: читается один раз при монтировании.
  // Другое имя = другой пагинатор; пересоздаёт компонент родитель (`{#key}`).
  const name = untrack(() => nameProp)
  const pagState = usePaginatorState(name)
  const isEnd = $derived(
    pagState().status === 'idle' &&
      pagState().hasNext === false &&
      pagState().loadedPages.length > 0
  )
</script>

{#if isEnd}
  {#if children}
    {@render children()}
  {:else}
    <div
      data-testid="end-row"
      class="my-3 py-2 text-center text-xs text-muted-foreground/80"
    >
      {text}
    </div>
  {/if}
{/if}
