<script lang="ts">
  /**
   * Список seed-юзеров в модалке (`?modal=user.list`) — только носитель:
   * максимум ACL-гейт. Данные модалка не запрашивает: их приносит загрузчик
   * записи (тот же `load` роута `/users`) и передаёт списку пропсом
   * `initial` — как страница свой серверный результат. Отказ список сообщает
   * наверх, его, как на странице, рисует носитель экраном `Acl`.
   */
  import { useLoader, useRuntimeKey } from '#lib/modals/svelte/index.js'
  import Acl from './Acl.svelte'
  import SeedUsersList from './SeedUsersList.svelte'
  import type { AuthErrorCode } from '../error.js'
  import type { SeedUsersRouteData } from './seed-users/source.js'

  const ldr = useLoader<SeedUsersRouteData>()
  // Область пагинатора этой записи: ключ стабилен, пока запись в стопке.
  const scope = useRuntimeKey()
  let acl = $state<AuthErrorCode | null>(null)
</script>

<div class="flex min-h-0 flex-auto flex-col p-6">
  {#if acl === 'auth.forbidden'}
    <Acl model="forbidden" backHref="/" variant="plain" />
  {:else if acl}
    <Acl status={acl} backHref="/" variant="plain" />
  {:else}
    <SeedUsersList
      {scope}
      initial={ldr.data}
      variant="plain"
      onAcl={(fact) => (acl = fact)}
    />
  {/if}
</div>
