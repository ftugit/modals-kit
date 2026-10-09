<script lang="ts">
  import { buttonVariants } from '$lib/ui/primitives'
  import { usePaginatorActions } from '$lib/paginate/svelte'
  import type { Snippet } from 'svelte'

  interface Props {
    name?: string
    class?: string
    children?: Snippet
  }

  let { name, class: className, children }: Props = $props()
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
