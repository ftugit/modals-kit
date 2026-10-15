<script lang="ts">
  import { untrack } from 'svelte'
  import { buttonVariants } from '#lib/components/ui/index.js'
  import { usePaginatorActions } from '#lib/paginate/svelte/index.js'
  import { taskAttrs } from '#lib/components/links/index.js'
  import { useActionTask } from './action-task.svelte.js'
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
  // Спиннер — пока грузится список, сброшенный ЭТОЙ кнопкой.
  const action = useActionTask(name)
</script>

<button
  type="button"
  {...taskAttrs(action.task)}
  class={className ?? buttonVariants({ variant: 'ghost', size: 'xs' })}
  onclick={() => {
    action.fire()
    reset()
  }}
>
  {#if children}
    {@render children()}
  {:else}
    Сброс
  {/if}
</button>
