<script lang="ts">
  /**
   * Модальный носитель куки-сейфа хранилищ (`storage.vault`; страница-фолбэк без JS — `/upload-demo/vault`).
   * Читает снимок из `load` того же роута через `preloadData`, а при изменениях
   * вызывает `invalidateAll()`, чтобы список серверов в `DemoPanel` обновился на лету.
   */
  import { invalidateAll, preloadData } from '$app/navigation'
  import { Skeleton } from '#components/paginator/index.js'
  import type { CookieVaultSnapshot } from '#hooks/cookie-vault/index.js'
  import { storageVaultSchema, type StorageVaultMeta } from '../schema.js'
  import StorageVaultView from './StorageVaultView.svelte'

  const VAULT_ROUTE = '/upload-demo/vault'

  let snapshot = $state<CookieVaultSnapshot<StorageVaultMeta> | null>(null)
  let loadFailed = $state(false)

  $effect(() => {
    let cancelled = false
    void preloadData(VAULT_ROUTE)
      .then((res) => {
        if (cancelled) return
        if (res.type === 'loaded' && res.data?.vaultSnapshot) {
          snapshot = res.data.vaultSnapshot as CookieVaultSnapshot<StorageVaultMeta>
        } else {
          snapshot = {
            scope: storageVaultSchema.scope,
            hasKey: false,
            maxEntries: storageVaultSchema.maxEntries,
            items: [],
          }
        }
      })
      .catch(() => {
        if (!cancelled) loadFailed = true
      })
    return () => {
      cancelled = true
    }
  })

  function handleChanged(next: CookieVaultSnapshot<StorageVaultMeta>) {
    snapshot = next
    void invalidateAll()
  }
</script>

<div class="flex min-h-0 flex-auto flex-col p-5" data-testid="storage-vault-modal">
  {#if loadFailed}
    <p class="text-sm text-destructive">Не удалось загрузить состояние куки-сейфа.</p>
  {:else if !snapshot}
    <div class="space-y-3">
      <Skeleton class="h-5 w-48" />
      <Skeleton class="h-20 w-full" />
      <Skeleton class="h-32 w-full" />
    </div>
  {:else}
    <StorageVaultView {snapshot} onChanged={handleChanged} />
  {/if}
</div>
