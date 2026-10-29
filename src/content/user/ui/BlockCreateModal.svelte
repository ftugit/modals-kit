<script lang="ts">
  /**
   * Модалка создания блокировки (`user.blocks.create`): носитель + ACL-гейт.
   */
  import { useLoader, useModal, useModals } from '#lib/modals/svelte/index.js'
  import Acl from './Acl.svelte'
  import BlockForm from './block-form/BlockForm.svelte'
  import type { AuthErrorCode } from '../error.js'
  import type { BlockCreateRouteData } from '../types.js'

  const m = useModals()
  const modal = useModal<{ uid?: string }>()
  const ldr = useLoader<BlockCreateRouteData>()
  const uid = $derived(modal.params?.uid ? String(modal.params.uid) : null)
  let acl = $state<AuthErrorCode | null>(null)
  const effectiveAcl = $derived(acl ?? ldr.data?.fact ?? null)
</script>

{#if effectiveAcl === 'auth.forbidden'}
  <Acl model="forbidden" backHref="/" class="p-5" />
{:else if effectiveAcl === 'auth.identity-unknown'}
  <Acl model="not_found" backHref="/" class="p-5" />
{:else if effectiveAcl}
  <Acl status={effectiveAcl} backHref="/" class="p-5" />
{:else}
  <BlockForm
    mode="create"
    {uid}
    initialCreate={ldr.data ?? null}
    onAcl={(fact) => (acl = fact)}
    onDone={() => m.modals.close()}
    class="p-5"
  />
{/if}
