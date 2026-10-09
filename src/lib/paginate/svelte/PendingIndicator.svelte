<script lang="ts">
  import { usePaginatorState } from './context.svelte'
  import type { Snippet } from 'svelte'

  export interface PendingIndicatorRender {
    page: number
    dir: 1 | -1
  }

  interface Props {
    name?: string
    class?: string
    children: Snippet<[PendingIndicatorRender]>
  }

  let { name, class: className = '', children }: Props = $props()

  const state = usePaginatorState<unknown>(name)

  const current = $derived.by((): PendingIndicatorRender | null => {
    const s = state()
    if (s.pending) return { page: s.pending.page, dir: s.pending.mode === 'prepend' ? -1 : 1 }
    if (s.status === 'loading') return { page: s.page, dir: 1 }
    return null
  })
</script>

{#if current}
  <div
    data-pag-pending-indicator={current.dir}
    style="position: sticky; top: 0; height: 0; z-index: 10;"
  >
    <div class={className} style="position: absolute; left: 0; right: 0; top: 0;">
      {@render children(current)}
    </div>
  </div>
{/if}
