<script lang="ts">
  /**
   * Список seed-юзеров в модалке (`?modal=user.list`) — только носитель:
   * максимум ACL-гейт. Данные модалка не запрашивает: их приносит загрузчик
   * записи (тот же `load` роута `/users`) и передаёт списку пропсом
   * `initial` — как страница свой серверный результат. Отказ список сообщает
   * наверх, его, как на странице, рисует носитель экраном `Acl`.
   */
  import { useLoader } from '#lib/modals/svelte/index.js'
  import Acl from './Acl.svelte'
  import SeedUsersList from './SeedUsersList.svelte'
  import type { AuthErrorCode } from '../error.js'
  import type { SeedUsersRouteData } from './seed-users/source.js'
  import { Surface } from '#components/ui/index.js'

  const ldr = useLoader<SeedUsersRouteData>()
  let acl = $state<AuthErrorCode | null>(null)
  const effectiveAcl = $derived(acl ?? ldr.data?.fact ?? null)
</script>

<Surface variant="plain" scroll={false} class="flex min-h-0 flex-1 flex-col w-full p-6">
  {#if ldr.data?.enabled === false || effectiveAcl}
    <Acl status={effectiveAcl} enabled={ldr.data?.enabled} backHref="/" variant="plain" />
  {:else}
    <SeedUsersList
      initial={ldr.data}
      variant="plain"
      class="min-h-0 flex-1"
      onAcl={(fact) => (acl = fact)}
    />
  {/if}
</Surface>
