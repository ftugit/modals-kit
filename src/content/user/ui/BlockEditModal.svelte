<script lang="ts">
  /**
   * Модалка редактирования / просмотра блокировки (`user.blocks.edit`):
   * носитель + ACL-гейт. Если у зрителя нет прав записи, `BlockForm`
   * открывается без возможности отправки (`canSubmit = false`).
   */
  import { useLoader, useModal, useModals } from '#lib/modals/svelte/index.js'
  import Acl from './Acl.svelte'
  import BlockForm from './block-form/BlockForm.svelte'
  import type { AuthErrorCode } from '../error.js'
  import type { BlockEditRouteData } from '../types.js'

  const m = useModals()
  const modal = useModal<{ blockId: string; uid?: string }>()
  const ldr = useLoader<BlockEditRouteData>()
  const blockId = $derived(String(modal.params?.blockId ?? ''))
  const uid = $derived(modal.params?.uid ? String(modal.params.uid) : null)
  let acl = $state<AuthErrorCode | null>(null)
  const effectiveAcl = $derived(acl ?? ldr.data?.fact ?? null)
</script>

<div class="my-auto w-full p-6">
  {#if !blockId || effectiveAcl === 'auth.identity-unknown'}
    <Acl model="not_found" backHref="/" variant="plain" />
  {:else if effectiveAcl === 'auth.forbidden'}
    <Acl model="forbidden" backHref="/" variant="plain" />
  {:else if effectiveAcl}
    <Acl status={effectiveAcl} backHref="/" variant="plain" />
  {:else}
    <BlockForm
      mode="edit"
      {uid}
      {blockId}
      initialEdit={ldr.data ?? null}
      variant="plain"
      onAcl={(fact) => (acl = fact)}
      onDone={() => m.modals.close()}
    />
  {/if}
</div>
