<script lang="ts">
  import { untrack } from 'svelte'
  import { buttonVariants } from '$lib/ui/primitives'
  import { usePaginatorActions } from '$lib/paginate/svelte'
  import type { Snippet } from 'svelte'

  interface Props {
    name?: string
    class?: string
    children?: Snippet
  }

  let { name: nameProp, class: className, children }: Props = $props()
  // Имя пагинатора — идентичность экземпляра: читается один раз при монтировании.
  // Другое имя = другой пагинатор; пересоздаёт компонент родитель (`{#key}`).
  const name = untrack(() => nameProp)
  const { reset } = usePaginatorActions(name)
</script>

<button
  type="button"
  class={className ?? buttonVariants({ variant: 'ghost', size: 'xs' })}
  onclick={() => reset()}
>
  {#if children}
    {@render children()}
  {:else}
    Сброс
  {/if}
</button>
