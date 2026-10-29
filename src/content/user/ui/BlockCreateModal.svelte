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
    {initialSubjects}
    initialCreate={ldr.data ?? null}
    onAcl={(fact) => (acl = fact)}
    onDone={() => m.modals.close()}
    class="p-5"
  />
{/if}
