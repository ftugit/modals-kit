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
  import {
    findScopedStore,
    getClientStore,
    getState,
    setExtra,
    setPageSize,
  } from '#lib/paginate/index.js'

  import { useLoader, useModal, useModals } from '#lib/modals/svelte/index.js'
  import { useGrants } from '../grants.svelte.js'
  import { auth as authResource, profile as profileResource } from '../schema.js'
  import { vault } from '../vault.svelte.js'
  import { SEED_USERS_NAME, SEED_USERS_PAGE_SIZE } from './seed-users/source.js'
  import SeedUsersFiltersForm, { type SeedUsersFilterValues } from './SeedUsersFiltersForm.svelte'
  import { Surface } from '#components/ui/index.js'

  const m = useModals()
  const modal = useModal<{ scope?: string }>()
  const ldr = useLoader<{ canSeeDeleted: boolean; canSeeNickname: boolean }>()
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

  // Стор владельца списка: ключ области приходит в параметрах модалки. Без
  // ключа (страница, старая ссылка) — общий клиентский, как раньше.
  const store = findScopedStore(untrack(() => modal.params?.scope ?? null)) ?? getClientStore()
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
    // Порядок важен: сначала новый срез (setExtra перезапрашивает с первой
    // порции прежним размером), затем размер — иначе промежуточный запрос
    // ушёл бы со старым срезом и новым размером.
    await setExtra(store, SEED_USERS_NAME, patch)
    await setPageSize(store, SEED_USERS_NAME, pageSize)
    m.modals.close()
  }

  async function reset() {
    await setExtra(store, SEED_USERS_NAME, {
      ord: undefined,
      state: undefined,
      cfrom: undefined,
      cto: undefined,
      dfrom: undefined,
      dto: undefined,
      nick: undefined,
    })
    await setPageSize(store, SEED_USERS_NAME, SEED_USERS_PAGE_SIZE)
    m.modals.close()
  }
</script>

<Surface
  variant="plain"
  class="w-full p-6"
  title="Фильтры списка"
  description="Параметры выборки и сортировки аккаунтов."
>
  <SeedUsersFiltersForm {canSeeDeleted} {canSeeNickname} {initial} onApply={apply} onReset={reset} />
</Surface>
