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

{#if effectiveAcl === 'auth.forbidden'}
  <Acl model="forbidden" backHref="/" class="p-5" />
{:else if effectiveAcl}
  <Acl status={effectiveAcl} backHref="/" class="p-5" />
{:else if ldr.data}
  <div class="p-5">
    <StorageServersView
      initial={ldr.data}
      enabled={ldr.data.enabled}
      doneHref="/"
      onAcl={(fact) => (acl = fact)}
      onDone={() => {
        void invalidateAll()
        m.modals.close()
      }}
    />
  </div>
{/if}
