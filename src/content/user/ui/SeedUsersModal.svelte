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

{#if acl === 'auth.forbidden'}
  <Acl model="forbidden" backHref="/" class="p-5" />
{:else if acl}
  <Acl status={acl} backHref="/" class="p-5" />
{:else}
  <SeedUsersList onAcl={(fact) => (acl = fact)} class="p-5" />
{/if}
