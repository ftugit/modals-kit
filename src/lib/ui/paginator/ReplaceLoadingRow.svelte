<script lang="ts">
  import type { Snippet } from 'svelte'
  import { usePaginatorState } from '$lib/paginate/svelte'
  import Spinner from './Spinner.svelte'

  interface Props {
    name?: string
    when?: boolean
    children?: Snippet
  }

  let { name, when = true, children }: Props = $props()
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
      class="my-2 flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground"
    >
      <Spinner size={14} />
      <span>Загрузка…</span>
    </div>
  {/if}
{/if}
