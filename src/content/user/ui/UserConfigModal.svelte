<script lang="ts">
  /**
   * Модалка настроек пользователя (`user.config.edit`):
   * тонкий носитель + ACL-гейт по данным загрузчика пары (`/user/config` или `/user/[id]/config`).
   */
  import { invalidateAll } from '$app/navigation'
  import { useLoader, useModal, useModals } from '#lib/modals/svelte/index.js'
  import Acl from './Acl.svelte'
  import UserConfig from './user-config/UserConfig.svelte'
  import type { AuthErrorCode } from '../error.js'
  import type { UserConfigRouteData } from '../types.js'

  const m = useModals()
  const modal = useModal<{ id?: string }>()
  const ldr = useLoader<UserConfigRouteData>()
  const uid = $derived(modal.params?.id ? String(modal.params.id) : null)
  let acl = $state<AuthErrorCode | null>(null)
  const effectiveAcl = $derived(acl ?? ldr.data?.fact ?? null)
</script>

{#if effectiveAcl === 'auth.identity-unknown'}
  <Acl model="not_found" backHref="/" class="p-5" />
{:else if effectiveAcl === 'auth.forbidden'}
  <Acl model="forbidden" backHref="/" class="p-5" />
{:else if effectiveAcl}
  <Acl status={effectiveAcl} backHref="/" class="p-5" />
{:else if ldr.data}
  <div class="p-5">
    <UserConfig
      {uid}
      initial={ldr.data}
      enabled={ldr.data.enabled}
      doneHref={uid ? `/user/${uid}` : '/'}
      onAcl={(fact) => (acl = fact)}
      onDone={() => {
        void invalidateAll()
        m.modals.close()
      }}
    />
  </div>
{/if}
