<script lang="ts">
  import { createPaginatorStore, getClientStore, type Store } from '../store'
  import type { PaginatorState } from '../types'
  import { setScopeStore } from './context.svelte'
  import type { Snippet } from 'svelte'

  interface Props {
    snapshots?: Record<string, PaginatorState<unknown> | null | undefined>
    store?: Store
    children?: Snippet
  }

  let { snapshots, store: customStore, children }: Props = $props()

  const store = customStore ?? (typeof window === 'undefined' ? createPaginatorStore() : getClientStore())

  if (snapshots) {
    for (const [name, snap] of Object.entries(snapshots)) {
      if (snap) store.hydrate(name, snap)
    }
  }

  setScopeStore(store)
</script>

{#if children}
  {@render children()}
{/if}
