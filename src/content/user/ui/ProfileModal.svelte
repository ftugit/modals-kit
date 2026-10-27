<script lang="ts">
  /**
   * Профиль в модалке (`?modal=user.profile&id=…`) — только носитель:
   * максимум ACL-гейт. Данные модалка не приносит и не кеширует: профиль
   * запрашивает и рисует сам компонент `Profile` (он же живёт на странице
   * `/user/[id]`), сюда он сообщает только отказ — его рисует носитель
   * экраном `Acl`, как страница.
   */
  import { useModal } from '#lib/modals/svelte/index.js'
  import Acl from './Acl.svelte'
  import Profile from './Profile.svelte'
  import type { AuthErrorCode } from '../error.js'

  const modal = useModal<{ id: string }>()
  const uid = $derived(modal.params?.id ?? '')
  let acl = $state<AuthErrorCode | 'not_found' | null>(null)
</script>

{#if !uid || acl === 'not_found'}
  <Acl model="not_found" backHref="/" class="p-5" />
{:else if acl}
  <Acl status={acl} backHref="/" class="p-5" />
{:else}
  <Profile {uid} onAcl={(what) => (acl = what)} class="p-5" />
{/if}
