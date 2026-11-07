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
  import { Surface } from '#components/ui/index.js'

  const m = useModals()
  const ldr = useLoader<StorageServersRouteData>()
  let acl = $state<AuthErrorCode | null>(null)
  const effectiveAcl = $derived(acl ?? ldr.data?.fact ?? null)
</script>

<Surface variant="plain" scroll={false} class="flex min-h-0 flex-1 flex-col w-full p-6">
  {#if effectiveAcl === 'auth.forbidden'}
    <Acl model="forbidden" backHref="/" variant="plain" />
  {:else if effectiveAcl}
    <Acl status={effectiveAcl} backHref="/" variant="plain" />
  {:else if ldr.data}
    <StorageServersView
      class="min-h-0 flex-1"
      initial={ldr.data}
      enabled={ldr.data.enabled}
      doneHref="/"
      variant="plain"
      onAcl={(fact) => (acl = fact)}
      onChange={() => {
        void invalidateAll()
      }}
      onDone={() => {
        void invalidateAll()
        m.modals.close()
        m.modals.invalidateLoader('storage.servers')
      }}
    />
  {/if}
</Surface>
