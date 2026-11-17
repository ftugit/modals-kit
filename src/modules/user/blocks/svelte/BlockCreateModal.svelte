<script lang="ts">
  /**
   * Модалка создания блокировки (`user.blocks.create`): носитель + ACL-гейт.
   */
  import { untrack } from 'svelte'
  import { grants } from '#core/lib/db/index.js'
  import { useLoader, useModal, useModals } from '#core/lib/modals/svelte/index.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import BlockForm from './block-form/BlockForm.svelte'
  import type { AuthErrorCode } from '#modules/user/base/model/error.js'
  import { useGrants } from '#modules/user/base/svelte/grants.svelte.js'
  import { block as blockResource } from '#modules/user/base/model/schema.js'
  import type { BlockCreateRouteData } from '#modules/user/base/model/types.js'
  import { vault } from '#modules/user/base/svelte/vault.svelte.js'
  import { Surface } from '#core/ui/index.js'

  const m = useModals()
  const modal = useModal<{ uid?: string; uids?: string }>()
  const ldr = useLoader<BlockCreateRouteData>()
  const uid = $derived(modal.params?.uid ? String(modal.params.uid) : null)
  const initialSubjects = untrack(() =>
    modal.params?.uids
      ? String(modal.params.uids)
          .split(',')
          .map((s) => s.trim())
          // Правило цели (S1): набор не правится молча. Своя цель остаётся в списке —
          // сервер отказывает внятным кодом, а человек видит, что выбрал себя.
          .filter((s) => Boolean(s))
      : undefined,
  )

  function syncSubjectsToModalUrl(ids: string[]) {
    if (uid) return
    modal.setParams(
      { uids: ids.filter(Boolean).join(',') || undefined },
      { reload: false },
    )
  }
  const canCreateGrant = useGrants(grants(blockResource).insert)
  let acl = $state<AuthErrorCode | null>(null)
  const effectiveAcl = $derived(
    acl ??
      ldr.data?.fact ??
      (vault.principal !== null && !canCreateGrant.current ? ('auth.forbidden' as AuthErrorCode) : null),
  )

  /**
   * Создание: блокировка появляется в общем списке и в разделе профиля,
   * поэтому их кеш сбрасывается ДО закрытия — нижняя запись при повторной
   * активации перезапросится.
   */
  function done() {
    m.modals.invalidateLoader('user.blocks')
    m.modals.invalidateLoader('user.profile')
    m.modals.close()
  }
</script>

<Surface variant="plain" scroll={false} class="flex min-h-0 flex-1 flex-col w-full p-6">
  {#if ldr.data?.enabled === false || effectiveAcl}
    <Acl status={effectiveAcl} enabled={ldr.data?.enabled} backHref="/" variant="plain" />
  {:else}
    <BlockForm
      class="min-h-0 flex-1"
      mode="create"
      {uid}
      {initialSubjects}
      initialCreate={ldr.data ?? null}
      variant="plain"
      onSubjectsChange={syncSubjectsToModalUrl}
      onAcl={(fact) => (acl = fact)}
      onDone={done}
    />
  {/if}
</Surface>
