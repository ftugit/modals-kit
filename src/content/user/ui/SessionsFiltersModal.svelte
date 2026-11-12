<script lang="ts">
  /**
   * Фильтры списка устройств в модалке (`user.sessions.filters`; страница-
   * fallback без JS — `/user/sessions/filters`, форма общая).
   *
   * Значения сеются из текущего набора пагинатора при открытии; применение
   * пишет `setExtra` и закрывает модалку. Список перезапрашивается с первой
   * порции тем же `load`, что кормит SSR (одна дверь данных).
   */
  import { untrack } from 'svelte'
  import { Surface } from '#components/ui/index.js'
  import { getState, setExtra } from '#lib/paginate/index.js'
  import { useOwnerPaginatorStore } from '#hooks/modal-paginator.svelte.js'
  import { useLoader, useModals } from '#lib/modals/svelte/index.js'
  import type { AuthErrorCode } from '../error.js'
  import Acl from './Acl.svelte'
  import SessionsFiltersForm, { type SessionsFilterValues } from './SessionsFiltersForm.svelte'
  import { SESSIONS_NAME, SESSIONS_PAGE_SIZE } from './sessions-list/source.js'

  interface FiltersLoaderData {
    canSeeDeleted: boolean
    countries: readonly string[]
    fact?: AuthErrorCode | null
    enabled?: boolean
  }

  const m = useModals()
  const ldr = useLoader<FiltersLoaderData>()
  const store = useOwnerPaginatorStore(SESSIONS_NAME)
  const pagState = () => getState(store, SESSIONS_NAME)
  const initial: SessionsFilterValues = untrack(() => {
    const e = (pagState().extra ?? {}) as Record<string, unknown>
    const s = (k: string) => (typeof e[k] === 'string' ? (e[k] as string) : '')
    return {
      state: s('state') || 'active',
      net: s('net') === '1',
      country: s('country') ? s('country').split(',').filter(Boolean) : [],
      cfrom: s('cfrom'),
      cto: s('cto'),
      sfrom: s('sfrom'),
      sto: s('sto'),
      size: pagState().pageSize || SESSIONS_PAGE_SIZE,
    }
  })
  const countries = $derived(ldr.data?.countries ?? [])
  const canSeeDeleted = $derived(ldr.data?.canSeeDeleted === true)

  async function apply(patch: Record<string, string | undefined>, pageSize: number) {
    await setExtra(store, SESSIONS_NAME, patch, { pageSize })
    m.modals.close()
  }

  async function reset() {
    await setExtra(
      store,
      SESSIONS_NAME,
      {
        state: undefined,
        net: undefined,
        country: undefined,
        cfrom: undefined,
        cto: undefined,
        sfrom: undefined,
        sto: undefined,
      },
      { pageSize: SESSIONS_PAGE_SIZE },
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
    description="Состояние, смена сети, страна и время устройств."
  >
    {#key `${canSeeDeleted}:${countries.join(',')}`}
      <SessionsFiltersForm {canSeeDeleted} {countries} {initial} onApply={apply} onReset={reset} />
    {/key}
  </Surface>
{/if}
