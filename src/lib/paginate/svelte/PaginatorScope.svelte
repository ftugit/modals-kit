<script lang="ts">
  import { createPaginatorStore, getClientStore, type Store } from '../store'
  import type { PaginatorState } from '../types'
  import { setScopeStore } from './context.svelte'
  import { untrack, type Snippet } from 'svelte'

  interface Props {
    snapshots?: Record<string, PaginatorState<unknown> | null | undefined>
    store?: Store
    children?: Snippet
  }

  let { snapshots, store: customStore, children }: Props = $props()

  // Скоуп создаётся один раз: стор и SSR-снапшоты берутся при монтировании
  // (повторная гидрация живого стора перетёрла бы состояние пользователя).
  const initial = untrack(() => ({ customStore, snapshots }))
  const store =
    initial.customStore ?? (typeof window === 'undefined' ? createPaginatorStore() : getClientStore())

  if (initial.snapshots) {
    for (const [name, snap] of Object.entries(initial.snapshots)) {
      if (snap) store.hydrate(name, snap)
    }
  }

  setScopeStore(store)
</script>

{#if children}
  {@render children()}
{/if}
