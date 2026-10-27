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
  import { getClientStore, setExtra } from '#lib/paginate/index.js'
  import { usePaginatorState } from '#lib/paginate/svelte/index.js'
  import { useLoader, useModals } from '#lib/modals/svelte/index.js'
  import { SEED_USERS_NAME } from './seed-users/source.js'
  import SeedUsersFiltersForm, { type SeedUsersFilterValues } from './SeedUsersFiltersForm.svelte'

  const m = useModals()
  // Доступность блока удалённых посчитал домен в `load` страницы-fallback
  // (`/users/filters`): модалка читает её оттуда же, откуда страница.
  const ldr = useLoader<{ canSeeDeleted: boolean; canSeeNickname: boolean }>()
  const canSeeDeleted = $derived(ldr.data?.canSeeDeleted === true)
  const canSeeNickname = $derived(ldr.data?.canSeeNickname === true)

  const pagState = usePaginatorState(SEED_USERS_NAME)
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
      nick: s('nick'),
    }
  })

  async function apply(patch: Record<string, string | undefined>) {
    await setExtra(getClientStore(), SEED_USERS_NAME, patch)
    m.modals.close()
  }

  async function reset() {
    await setExtra(getClientStore(), SEED_USERS_NAME, {
      ord: undefined,
      state: undefined,
      cfrom: undefined,
      cto: undefined,
      dfrom: undefined,
      dto: undefined,
      nick: undefined,
    })
    m.modals.close()
  }
</script>

<div class="p-5">
  <h2 class="mb-4 text-base font-semibold">Фильтры списка</h2>
  <SeedUsersFiltersForm {canSeeDeleted} {canSeeNickname} {initial} onApply={apply} onReset={reset} />
</div>
