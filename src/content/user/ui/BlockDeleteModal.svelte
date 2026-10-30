<script lang="ts">
  /**
   * Модалка удаления блокировки (`user.blocks.delete`): носитель + ACL-гейт.
   * После удаления закрывает саму модалку удаления и, если прямо под ней
   * в стопке открыта карточка этой же блокировки (`user.blocks.edit`),
   * закрывает и её, возвращая пользователя к списку.
   */
  import { grants } from '#lib/db/index.js'
  import { entryLabel } from '#lib/modals/index.js'
  import { useLoader, useModal, useModals } from '#lib/modals/svelte/index.js'
  import Acl from './Acl.svelte'
  import BlockDelete from './block-delete/BlockDelete.svelte'
  import type { AuthErrorCode } from '../error.js'
  import { useGrants } from '../grants.svelte.js'
  import { block as blockResource } from '../schema.js'
  import type { BlockDeleteRouteData } from '../types.js'
  import { vault } from '../vault.svelte.js'

  const gBlock = grants(blockResource)
  const m = useModals()
  const modal = useModal<{ blockId: string; uid?: string }>()
  const ldr = useLoader<BlockDeleteRouteData>()
  const blockId = $derived(String(modal.params?.blockId ?? ''))
  const uid = $derived(modal.params?.uid ? String(modal.params.uid) : null)
  const delCaps = useGrants({
    canSoftDelete: gBlock.delete,
    canHardDelete: gBlock.hardDelete,
  })
  const canDeleteLiveOrHard = $derived.by(() => {
    const det = ldr.data?.detail
    if (!det) return true
    if (vault.principal === null) return det.canDelete
    return det.block.deletedAt != null ? delCaps.canHardDelete : delCaps.canSoftDelete
  })
  let acl = $state<AuthErrorCode | null>(null)
  const effectiveAcl = $derived(
    acl ??
      ldr.data?.fact ??
      (ldr.data && !canDeleteLiveOrHard ? ('auth.forbidden' as AuthErrorCode) : null),
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

<div class="my-auto w-full p-6">
  {#if !blockId || effectiveAcl === 'auth.identity-unknown'}
    <Acl model="not_found" backHref="/" variant="plain" />
  {:else if effectiveAcl === 'auth.forbidden'}
    <Acl model="forbidden" backHref="/" variant="plain" />
  {:else if effectiveAcl}
    <Acl status={effectiveAcl} backHref="/" variant="plain" />
  {:else}
    <BlockDelete
      {blockId}
      {uid}
      initial={ldr.data ?? null}
      variant="plain"
      onAcl={(fact) => (acl = fact)}
      onDone={handleDone}
    />
  {/if}
</div>
