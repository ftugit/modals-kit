<script lang="ts">
  /**
   * Модалка фильтров списка блокировок (`user.blocks.filters`).
   * Значения сеются из текущего состояния пагинатора `BLOCKS_NAME`;
   * если родительский `BlocksList` открыт с `uid`, кнопка выбора
   * пользователей в форме блокируется.
   */
  import { untrack } from 'svelte'
  import { grants } from '#lib/db/index.js'
  import { findScopedStore, getClientStore, getState, setExtra, setPageSize } from '#lib/paginate/index.js'
  import { useLoader, useModal, useModals } from '#lib/modals/svelte/index.js'
  import { useGrants } from '../grants.svelte.js'
  import { auth as authResource, block as blockResource } from '../schema.js'
  import { vault } from '../vault.svelte.js'
  import { BLOCKS_NAME, BLOCKS_PAGE_SIZE } from './blocks-list/source.js'
  import BlocksFiltersForm, { type BlocksFilterValues } from './BlocksFiltersForm.svelte'
  import { Surface } from '#components/ui/index.js'

  const gBlock = grants(blockResource)
  const gAuth = grants(authResource)

  const m = useModals()
  const modal = useModal<{ uid?: string; scope?: string }>()
  const uid = $derived(modal.params?.uid ? String(modal.params.uid) : null)

  const ldr = useLoader<{
    canSeeDeleted: boolean
    canSeeLive: boolean
    canPickUsers: boolean
  }>()
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

  // Стор владельца списка: ключ области приходит в параметрах модалки. Без
  // ключа (страница, старая ссылка) — общий клиентский, как раньше.
  const store = findScopedStore(untrack(() => modal.params?.scope ?? null)) ?? getClientStore()
  const pagState = () => getState(store, BLOCKS_NAME)
  const initial: BlocksFilterValues = untrack(() => {
    const e = (pagState().extra ?? {}) as Record<string, unknown>
    const s = (k: string) => (typeof e[k] === 'string' ? (e[k] as string) : '')
    return {
      ord: s('ord') || 'created-desc',
      state: s('state') || 'all',
      scopes: s('scopes')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
      uids: s('uids')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
      size: pagState().pageSize,
    }
  })

  async function apply(patch: Record<string, string | undefined>, pageSize: number) {
    await setExtra(store, BLOCKS_NAME, patch)
    await setPageSize(store, BLOCKS_NAME, pageSize)
    m.modals.close()
  }

  async function reset() {
    await setExtra(store, BLOCKS_NAME, {
      ord: undefined,
      state: undefined,
      scopes: undefined,
      uids: undefined,
    })
    await setPageSize(store, BLOCKS_NAME, BLOCKS_PAGE_SIZE)
    m.modals.close()
  }
</script>

<Surface
  variant="plain"
  class="w-full p-6"
  title="Фильтры блокировок"
  description="Срез журнала по статусу, сферам и пользователям."
>
  <BlocksFiltersForm
    {uid}
    {canSeeDeleted}
    {canSeeLive}
    {canPickUsers}
    {initial}
    onApply={apply}
    onReset={reset}
  />
</Surface>
