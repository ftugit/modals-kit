<script lang="ts">
  /**
   * Список seed-юзеров в модалке (`?modal=user.list`) — только носитель:
   * максимум ACL-гейт. Данные модалка не приносит: компонент списка сам
   * запрашивает их у `load` роута `/users` при показе (он же живёт на
   * странице и в шаге админки), сюда он сообщает только отказ — его, как
   * на странице, рисует носитель экраном `Acl`.
   */
  import Acl from './Acl.svelte'
  import SeedUsersList from './SeedUsersList.svelte'
  import type { AuthErrorCode } from '../error.js'

  let acl = $state<AuthErrorCode | null>(null)
</script>

<div class="flex min-h-0 flex-auto flex-col p-6">
  {#if acl === 'auth.forbidden'}
    <Acl model="forbidden" backHref="/" variant="plain" />
  {:else if acl}
    <Acl status={acl} backHref="/" variant="plain" />
  {:else}
    <SeedUsersList variant="plain" onAcl={(fact) => (acl = fact)} />
  {/if}
</div>
