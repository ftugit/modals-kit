<script lang="ts">
  /**
   * Фильтры списка seed-юзеров в модалке (`user.list.filters`; страница-
   * fallback без JS — `/users/filters`, форма общая `SeedUsersFiltersForm`).
   *
   * Значения сеются из текущего набора пагинатора при открытии; применение
   * пишет набор `setExtra` и закрывает модалку, список перезапрашивается
   * с первой порции тем же `load`, что кормит SSR (одна точка данных).
   * Доступность блока удалённых решает параметр открытия `canSeeDeleted`
   * (его посчитал домен), а не сам компонент.
   */
  import { untrack } from 'svelte'
  import { grants } from '#lib/db/index.js'
  import { getState, setExtra } from '#lib/paginate/index.js'
  import { useOwnerPaginatorStore } from '#hooks/modal-paginator.svelte.js'
  import { useLoader, useModals } from '#lib/modals/svelte/index.js'
  import type { AuthErrorCode } from '../error.js'
  import { useGrants } from '../grants.svelte.js'
  import { auth as authResource, profile as profileResource } from '../schema.js'
  import { vault } from '../vault.svelte.js'
  import Acl from './Acl.svelte'
  import { SEED_USERS_NAME, SEED_USERS_PAGE_SIZE } from './seed-users/source.js'
  import SeedUsersFiltersForm, { type SeedUsersFilterValues } from './SeedUsersFiltersForm.svelte'
  import { Surface } from '#components/ui/index.js'

  interface FiltersLoaderData {
    canSeeDeleted: boolean
    canSeeNickname: boolean
    fact?: AuthErrorCode | null
    enabled?: boolean
  }

  const m = useModals()
  const ldr = useLoader<FiltersLoaderData>()
  const seedFilterCaps = useGrants({
    canSeeDeleted: grants(authResource).selectDeleted,
    canSeeNickname: grants(profileResource).select,
  })
  const canSeeDeleted = $derived(
    vault.principal !== null ? seedFilterCaps.canSeeDeleted : ldr.data?.canSeeDeleted === true,
  )
  const canSeeNickname = $derived(
    vault.principal !== null ? seedFilterCaps.canSeeNickname : ldr.data?.canSeeNickname === true,
  )

  const store = useOwnerPaginatorStore(SEED_USERS_NAME)
  const pagState = () => getState(store, SEED_USERS_NAME)
  const initial: SeedUsersFilterValues = untrack(() => {
    const e = (pagState().extra ?? {}) as Record<string, unknown>
    const s = (k: string) => (typeof e[k] === 'string' ? (e[k] as string) : '')
    return {
      ord: s('ord') || 'created-desc',
      state: s('state') || 'active',
      cfrom: s('cfrom'),
      cto: s('cto'),
      dfrom: s('dfrom'),
      dto: s('dto'),
      nick: s('nick') === '1',
      size: pagState().pageSize,
    }
  })

  async function apply(patch: Record<string, string | undefined>, pageSize: number) {
    await setExtra(store, SEED_USERS_NAME, patch, { pageSize })
    m.modals.close()
  }

  async function reset() {
    await setExtra(
      store,
      SEED_USERS_NAME,
      {
        ord: undefined,
        state: undefined,
        cfrom: undefined,
        cto: undefined,
        dfrom: undefined,
        dto: undefined,
        nick: undefined,
      },
      { pageSize: SEED_USERS_PAGE_SIZE },
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
    title="Фильтры списка"
    description="Параметры выборки и сортировки аккаунтов."
  >
    {#key `${canSeeDeleted}:${canSeeNickname}`}
      <SeedUsersFiltersForm {canSeeDeleted} {canSeeNickname} {initial} onApply={apply} onReset={reset} />
    {/key}
  </Surface>
{/if}
