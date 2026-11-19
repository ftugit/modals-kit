<script lang="ts">
  /**
   * Фильтры списка «Диска» в модалке (`drive.filters`; страница-fallback без JS —
   * `/drive/filters`). Одна форма с sidebar/страницей (`DriveFilters.svelte`).
   *
   * Значения сеются из owner-стора пагинатора; применение пишет набор `setExtra`
   * и закрывает только эту модалку. Список перезапрашивается тем же `load`.
   */
  import { untrack } from 'svelte'
  import { getState, setExtra } from '#core/lib/paginate/index.js'
  import { useOwnerPaginatorStore } from '#core/hooks/modal-paginator.svelte.js'
  import { useLoader, useModals } from '#core/lib/modals/svelte/index.js'
  import { Surface } from '#core/ui/index.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import type { DriveFiltersPageData } from '../../types.js'
  import {
    DRIVE_NAME,
    DRIVE_PAGE_DEFAULT,
  } from '../../source.js'
  import { driveFilterValues } from '../../filters-form.js'
  import { driveRootRoute } from '../../routes.js'
  import DriveFilters from './DriveFilters.svelte'

  const m = useModals()
  const ldr = useLoader<DriveFiltersPageData>()
  const store = useOwnerPaginatorStore(DRIVE_NAME)
  const pagState = () => getState(store, DRIVE_NAME)

  const initial = untrack(() =>
    driveFilterValues(
      (pagState().extra ?? {}) as Record<string, unknown>,
      pagState().pageSize || DRIVE_PAGE_DEFAULT,
    ),
  )
  const from = $derived(ldr.data?.backHref ?? driveRootRoute.href())

  async function apply(patch: Record<string, string | undefined>, pageSize: number) {
    await setExtra(store, DRIVE_NAME, patch, { pageSize })
    m.modals.close()
  }

  async function reset() {
    await setExtra(
      store,
      DRIVE_NAME,
      {
        ord: undefined,
        type: undefined,
        scope: undefined,
        from: undefined,
        to: undefined,
      },
      { pageSize: DRIVE_PAGE_DEFAULT },
    )
    m.modals.close()
  }
</script>

{#if ldr.data?.fact}
  <Surface variant="plain" class="w-full p-6">
    <Acl status={ldr.data.fact} enabled={ldr.data.enabled} backHref={from} variant="plain" />
  </Surface>
{:else}
  <Surface
    variant="plain"
    class="w-full p-6"
    title="Фильтры списка"
    description="Параметры выборки и сортировки файлов и папок."
  >
    <DriveFilters
      {initial}
      {from}
      scopeLocked={ldr.data?.scopeLocked ?? false}
      onApply={apply}
      onReset={reset}
    />
  </Surface>
{/if}
