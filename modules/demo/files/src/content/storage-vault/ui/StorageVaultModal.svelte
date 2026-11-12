<script lang="ts">
  /** Модальный носитель куки-сейфа; снимок принадлежит загрузчику записи. */
  import { refreshAll } from '$app/navigation'
  import { onDestroy } from 'svelte'
  import { useLoader, useModals } from '#lib/modals/svelte/index.js'
  import { Skeleton, Surface } from '#components/ui/index.js'
  import type { CookieVaultSnapshot } from '#hooks/cookie-vault/index.js'
  import type { StorageVaultMeta } from '../schema.js'
  import StorageVaultView from './StorageVaultView.svelte'

  const ldr = useLoader<{ vaultSnapshot?: CookieVaultSnapshot<StorageVaultMeta> }>()
  const m = useModals()
  let localSnapshot = $state<CookieVaultSnapshot<StorageVaultMeta> | null>(null)
  let dirty = false
  const snapshot = $derived(localSnapshot ?? ldr.data?.vaultSnapshot ?? null)

  $effect(() => {
    ldr.data
    localSnapshot = null
  })

  function handleChanged(next: CookieVaultSnapshot<StorageVaultMeta>) {
    localSnapshot = next
    dirty = true
    void refreshAll()
  }
  onDestroy(() => {
    if (dirty) m.modals.invalidateLoader('storage.vault')
  })
</script>

<Surface variant="plain" class="flex min-h-0 flex-auto flex-col p-6" data-testid="storage-vault-modal">
  {#if !snapshot}
    <div class="flex flex-col gap-3">
      <Skeleton class="h-5 w-48" />
      <Skeleton class="h-20 w-full" />
      <Skeleton class="h-32 w-full" />
    </div>
  {:else}
    <StorageVaultView {snapshot} onChanged={handleChanged} />
  {/if}
</Surface>
