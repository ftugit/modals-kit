<script lang="ts">
  /**
   * Модалка удаления блокировки (`user.blocks.delete`): носитель + ACL-гейт.
   * После удаления закрывает саму модалку удаления и, если прямо под ней
   * в стопке открыта карточка этой же блокировки (`user.blocks.edit`),
   * закрывает и её, возвращая пользователя к списку.
   */
  import { entryLabel } from '#lib/modals/index.js'
  import { useLoader, useModal, useModals } from '#lib/modals/svelte/index.js'
  import Acl from './Acl.svelte'
  import BlockDelete from './block-delete/BlockDelete.svelte'
  import type { AuthErrorCode } from '../error.js'
  import type { BlockDeleteRouteData } from '../types.js'

  const m = useModals()
  const modal = useModal<{ blockId: string; uid?: string }>()
  const ldr = useLoader<BlockDeleteRouteData>()
  const blockId = $derived(String(modal.params?.blockId ?? ''))
  const uid = $derived(modal.params?.uid ? String(modal.params.uid) : null)
  let acl = $state<AuthErrorCode | null>(null)
  const effectiveAcl = $derived(
    acl ??
      ldr.data?.fact ??
      (ldr.data && !ldr.data.detail?.canDelete ? ('auth.forbidden' as AuthErrorCode) : null),
  )

  function handleDone() {
    const chain = m.view.chain
    const prev = chain.length >= 2 ? chain[chain.length - 2] : undefined
    m.modals.close()
    if (
      prev &&
      entryLabel(prev) === 'user.blocks.edit' &&
      prev.kind === 'registered' &&
      String(prev.params?.blockId ?? '') === blockId
    ) {
      m.modals.close()
    }
  }
</script>

{#if !blockId || effectiveAcl === 'auth.identity-unknown'}
  <Acl model="not_found" backHref="/" class="p-5" />
{:else if effectiveAcl === 'auth.forbidden'}
  <Acl model="forbidden" backHref="/" class="p-5" />
{:else if effectiveAcl}
  <Acl status={effectiveAcl} backHref="/" class="p-5" />
{:else}
  <BlockDelete
    {blockId}
    {uid}
    initial={ldr.data ?? null}
    onAcl={(fact) => (acl = fact)}
    onDone={handleDone}
    class="p-5"
  />
{/if}
