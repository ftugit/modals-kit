<script lang="ts">
  /**
   * Модалка создания блокировки (`user.blocks.create`): носитель + ACL-гейт.
   */
  import { grants } from '#lib/db/index.js'
  import { useLoader, useModal, useModals } from '#lib/modals/svelte/index.js'
  import Acl from './Acl.svelte'
  import BlockForm from './block-form/BlockForm.svelte'
  import type { AuthErrorCode } from '../error.js'
  import { useGrants } from '../grants.svelte.js'
  import { block as blockResource } from '../schema.js'
  import type { BlockCreateRouteData } from '../types.js'
  import { vault } from '../vault.svelte.js'

  const m = useModals()
  const modal = useModal<{ uid?: string; uids?: string }>()
  const ldr = useLoader<BlockCreateRouteData>()
  const uid = $derived(modal.params?.uid ? String(modal.params.uid) : null)
  const initialSubjects = $derived(
    modal.params?.uids
      ? String(modal.params.uids)
          .split(',')
          .map((s) => s.trim())
          .filter((s) => Boolean(s) && s !== vault.principal)
      : undefined,
  )
  const canCreateGrant = useGrants(grants(blockResource).insert)
  let acl = $state<AuthErrorCode | null>(null)
  const effectiveAcl = $derived(
    acl ??
      ldr.data?.fact ??
      (vault.principal !== null && !canCreateGrant.current ? ('auth.forbidden' as AuthErrorCode) : null),
  )
</script>

<div class="my-auto w-full p-6">
  {#if effectiveAcl === 'auth.forbidden'}
    <Acl model="forbidden" backHref="/" variant="plain" />
  {:else if effectiveAcl === 'auth.identity-unknown'}
    <Acl model="not_found" backHref="/" variant="plain" />
  {:else if effectiveAcl}
    <Acl status={effectiveAcl} backHref="/" variant="plain" />
  {:else}
    <BlockForm
      mode="create"
      {uid}
      {initialSubjects}
      initialCreate={ldr.data ?? null}
      variant="plain"
      onAcl={(fact) => (acl = fact)}
      onDone={() => m.modals.close()}
    />
  {/if}
</div>
