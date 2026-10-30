<script lang="ts">
  /**
   * Модалка управления серверами боевого хранилища (`storage.servers`):
   * тонкий носитель + ACL-гейт по данным загрузчика `/storage-servers`.
   */
  import { invalidateAll } from '$app/navigation'
  import { useLoader, useModals } from '#lib/modals/svelte/index.js'
  import type { AuthErrorCode } from '#content/user/error.js'
  import Acl from '#content/user/ui/Acl.svelte'
  import type { StorageServersRouteData } from '../types.js'
  import StorageServersView from './StorageServersView.svelte'

  const m = useModals()
  const ldr = useLoader<StorageServersRouteData>()
  let acl = $state<AuthErrorCode | null>(null)
  const effectiveAcl = $derived(acl ?? ldr.data?.fact ?? null)
</script>

<div class="my-auto w-full p-6">
  {#if effectiveAcl === 'auth.forbidden'}
    <Acl model="forbidden" backHref="/" variant="plain" />
  {:else if effectiveAcl}
    <Acl status={effectiveAcl} backHref="/" variant="plain" />
  {:else if ldr.data}
    <StorageServersView
      initial={ldr.data}
      enabled={ldr.data.enabled}
      doneHref="/"
      variant="plain"
      onAcl={(fact) => (acl = fact)}
      onChange={() => {
        m.modals.invalidateLoader('storage.servers')
        void invalidateAll()
      }}
      onDone={() => {
        m.modals.invalidateLoader('storage.servers')
        void invalidateAll()
        m.modals.close()
      }}
    />
  {/if}
</div>
