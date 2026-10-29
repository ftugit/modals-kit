<script lang="ts">
  /**
   * Модалка фильтров списка блокировок (`user.blocks.filters`).
   * Значения сеются из текущего состояния пагинатора `BLOCKS_NAME`;
   * если родительский `BlocksList` открыт с `uid`, кнопка выбора
   * пользователей в форме блокируется.
   */
  import { untrack } from 'svelte'
  import { getClientStore, setExtra, setPageSize } from '#lib/paginate/index.js'
  import { usePaginatorState } from '#lib/paginate/svelte/index.js'
  import { useLoader, useModal, useModals } from '#lib/modals/svelte/index.js'
  import { BLOCKS_NAME, BLOCKS_PAGE_SIZE } from './blocks-list/source.js'
  import BlocksFiltersForm, { type BlocksFilterValues } from './BlocksFiltersForm.svelte'

  const m = useModals()
  const modal = useModal<{ uid?: string }>()
  const uid = $derived(modal.params?.uid ? String(modal.params.uid) : null)

  const ldr = useLoader<{
    canSeeDeleted: boolean
    canSeeLive: boolean
    canPickUsers: boolean
  }>()
  const canSeeDeleted = $derived(ldr.data?.canSeeDeleted === true)
  const canSeeLive = $derived(ldr.data?.canSeeLive !== false)
  const canPickUsers = $derived(!uid && ldr.data?.canPickUsers === true)

  const pagState = usePaginatorState(BLOCKS_NAME)
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
    await setExtra(getClientStore(), BLOCKS_NAME, patch)
    await setPageSize(getClientStore(), BLOCKS_NAME, pageSize)
    m.modals.close()
  }

  async function reset() {
    await setExtra(getClientStore(), BLOCKS_NAME, {
      ord: undefined,
      state: undefined,
      scopes: undefined,
      uids: undefined,
    })
    await setPageSize(getClientStore(), BLOCKS_NAME, BLOCKS_PAGE_SIZE)
    m.modals.close()
  }
</script>

<div class="p-5">
  <h2 class="mb-4 text-base font-semibold">Фильтры блокировок</h2>
  <BlocksFiltersForm
    {uid}
    {canSeeDeleted}
    {canSeeLive}
    {canPickUsers}
    {initial}
    onApply={apply}
    onReset={reset}
  />
</div>
