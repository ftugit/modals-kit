<script lang="ts">
  /**
   * Модалка фильтров списка блокировок (`user.blocks.filters`).
   * Значения сеются из текущего состояния пагинатора `BLOCKS_NAME`;
   * если родительский `BlocksList` открыт с `uid`, кнопка выбора
   * пользователей в форме блокируется.
   */
  import { untrack } from 'svelte'
  import { grants } from '#lib/db/index.js'
  import { getState, setExtra } from '#lib/paginate/index.js'
  import { useOwnerPaginatorStore } from '#hooks/modal-paginator.svelte.js'
  import { useLoader, useModal, useModals } from '#lib/modals/svelte/index.js'
  import type { AuthErrorCode } from '../error.js'
  import { useGrants } from '../grants.svelte.js'
  import { auth as authResource, block as blockResource } from '../schema.js'
  import { vault } from '../vault.svelte.js'
  import Acl from './Acl.svelte'
  import { BLOCKS_NAME, BLOCKS_PAGE_SIZE } from './blocks-list/source.js'
  import BlocksFiltersForm, { type BlocksFilterValues } from './BlocksFiltersForm.svelte'
  import { Surface } from '#components/ui/index.js'

  interface BlocksFiltersLoaderData {
    canSeeDeleted: boolean
    canSeeLive: boolean
    canPickUsers: boolean
    fact?: AuthErrorCode | null
    enabled?: boolean
  }

  const gBlock = grants(blockResource)
  const gAuth = grants(authResource)

  const m = useModals()
  const modal = useModal<{ uid?: string; uids?: string }>()
  const uid = $derived(modal.params?.uid ? String(modal.params.uid) : null)

  const ldr = useLoader<BlocksFiltersLoaderData>()
  const filterCaps = useGrants(
    {
      canSeeDeleted: gBlock.selectDeleted,
      canSeeLive: gBlock.select,
      canPickUsers: gAuth.select,
    },
    { ownerId: () => uid },
  )
  const canSeeDeleted = $derived(
    vault.principal !== null ? filterCaps.canSeeDeleted : ldr.data?.canSeeDeleted === true,
  )
  const canSeeLive = $derived(
    vault.principal !== null ? filterCaps.canSeeLive : ldr.data?.canSeeLive !== false,
  )
  const canPickUsers = $derived(
    !uid && (vault.principal !== null ? filterCaps.canPickUsers : ldr.data?.canPickUsers === true),
  )

  const store = useOwnerPaginatorStore(BLOCKS_NAME)
  const pagState = () => getState(store, BLOCKS_NAME)
  const initial: BlocksFilterValues = untrack(() => {
    const e = (pagState().extra ?? {}) as Record<string, unknown>
    const s = (k: string) => (typeof e[k] === 'string' ? (e[k] as string) : '')
    const rawEntry = m.view.chain[modal.index]
    const hasExplicitModalUids =
      rawEntry?.kind === 'registered' &&
      rawEntry.params !== undefined &&
      Object.prototype.hasOwnProperty.call(rawEntry.params, 'uids')
    const uidsCsv = hasExplicitModalUids ? String(modal.params?.uids ?? '') : s('uids')
    return {
      ord: s('ord') || 'created-desc',
      state: s('state') || 'all',
      scopes: s('scopes')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
      uids: uidsCsv
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
      size: pagState().pageSize,
    }
  })

  function syncUidsToModalUrl(nextUids: string[]) {
    if (uid) return
    modal.setParams(
      { uids: nextUids.filter(Boolean).join(',') || undefined },
      { reload: false },
    )
  }

  async function apply(patch: Record<string, string | undefined>, pageSize: number) {
    await setExtra(store, BLOCKS_NAME, patch, { pageSize })
    m.modals.close()
  }

  async function reset() {
    await setExtra(
      store,
      BLOCKS_NAME,
      {
        ord: undefined,
        state: undefined,
        scopes: undefined,
        uids: undefined,
      },
      { pageSize: BLOCKS_PAGE_SIZE },
    )
    m.modals.close()
  }
</script>

{#if ldr.data?.enabled === false || ldr.data?.fact}
  <Surface variant="plain" class="w-full p-6">
    <Acl status={ldr.data?.fact} enabled={ldr.data?.enabled} backHref="/" variant="plain" />
  </Surface>
{:else}
  <Surface
    variant="plain"
    class="w-full p-6"
    title="Фильтры блокировок"
    description="Срез журнала по статусу, сферам и пользователям."
  >
    {#key `${canSeeDeleted}:${canSeeLive}`}
      <BlocksFiltersForm
        {uid}
        {canSeeDeleted}
        {canSeeLive}
        {canPickUsers}
        {initial}
        onUidsChange={syncUidsToModalUrl}
        onApply={apply}
        onReset={reset}
      />
    {/key}
  </Surface>
{/if}
