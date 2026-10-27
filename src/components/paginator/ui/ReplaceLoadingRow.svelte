<script lang="ts">
  import { untrack } from 'svelte'
  import type { Snippet } from 'svelte'
  import { usePaginatorState } from '#lib/paginate/svelte/index.js'
  import { cn } from '#components/utils.js'
  import { Spinner } from '../../ui/index.js'

  interface Props {
    name?: string
    when?: boolean
    /** Классы корневого элемента (через `cn` к базовым, как у `Acl`). */
    class?: string
    children?: Snippet
  }

  let { name: nameProp, when = true, class: className, children }: Props = $props()
  // Имя пагинатора — идентичность экземпляра: читается один раз при монтировании.
  // Другое имя = другой пагинатор; пересоздаёт компонент родитель (`{#key}`).
  const name = untrack(() => nameProp)
  const pagState = usePaginatorState(name)
  const isReplacing = $derived(
    when && pagState().status === 'loading' && pagState().pending?.mode === 'replace'
  )
</script>

{#if isReplacing}
  {#if children}
    {@render children()}
  {:else}
    <div
      data-testid="replace-loading"
      class={cn('my-2 flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground', className)}
    >
      <Spinner size={14} class="text-muted-foreground" />
      <span>Загрузка…</span>
    </div>
  {/if}
{/if}
